import { describe, expect, it } from 'vitest'
import {
  pillLabel,
  pillStatus,
  pillTitle,
  vaultLabel,
  vaultTitle,
  worstStatus,
  type SyncRecordSnapshot,
} from './pill-status.js'

function rec(overrides: Partial<SyncRecordSnapshot> = {}): SyncRecordSnapshot {
  return {
    connected: true,
    synced: true,
    pendingLocal: false,
    diskMatchesCrdt: true,
    diverged: false,
    ...overrides,
  }
}

describe('pillStatus', () => {
  it('is green only when connected, synced, nothing pending, disk matches, not diverged', () => {
    expect(pillStatus(rec())).toBe('green')
  })

  it('is offline when disconnected without divergence (edits safe locally)', () => {
    expect(pillStatus(rec({ connected: false, synced: false }))).toBe('offline')
  })

  it('is red when diverged, even while offline — divergence dominates everything (sync.md)', () => {
    expect(pillStatus(rec({ connected: false, synced: false, diverged: true }))).toBe('red')
  })

  it('is red when diverged while otherwise green', () => {
    expect(pillStatus(rec({ diverged: true }))).toBe('red')
  })

  it('is yellow while connected but the handshake has not completed', () => {
    expect(pillStatus(rec({ synced: false }))).toBe('yellow')
  })

  it('is yellow while local ops are pending relay ack', () => {
    expect(pillStatus(rec({ pendingLocal: true }))).toBe('yellow')
  })

  it('is yellow while a disk flush/materialization is pending', () => {
    expect(pillStatus(rec({ diskMatchesCrdt: false }))).toBe('yellow')
  })

  it('is yellow when both unsynced and disk-stale (still just working, not red)', () => {
    expect(pillStatus(rec({ synced: false, diskMatchesCrdt: false, pendingLocal: true }))).toBe(
      'yellow'
    )
  })

  it('never claims green for a disconnected doc even if everything else looks settled', () => {
    expect(pillStatus(rec({ connected: false }))).toBe('offline')
  })
})

describe('worstStatus (global rollup)', () => {
  it('claims less, not more, with no docs', () => {
    expect(worstStatus([])).toBe('offline')
  })

  it('is green only when every doc is green', () => {
    expect(worstStatus(['green', 'green'])).toBe('green')
  })

  it('lets yellow beat green', () => {
    expect(worstStatus(['green', 'yellow', 'green'])).toBe('yellow')
  })

  it('lets offline beat yellow', () => {
    expect(worstStatus(['yellow', 'offline', 'green'])).toBe('offline')
  })

  it('lets red beat everything', () => {
    expect(worstStatus(['green', 'offline', 'red', 'yellow'])).toBe('red')
  })
})

describe('pill titles', () => {
  it('labels green as relay receipt, not durability (V1-plan honesty caveat)', () => {
    expect(pillTitle('green')).toBe('synced (relay)')
  })

  it('reads every status from the dictionary — no status is ever unlabeled', () => {
    for (const status of ['green', 'yellow', 'red', 'offline'] as const) {
      expect(pillLabel(status)).not.toBe('')
      expect(pillTitle(status)).not.toBe('')
    }
    expect(pillLabel('offline')).toBe('offline')
  })
})

describe('the vault pill (P3)', () => {
  it('says a word, in Title case — never the status key', () => {
    expect(vaultLabel('green')).toBe('Synced')
    expect(vaultLabel('yellow')).toBe('Syncing')
    expect(vaultLabel('red')).toBe('Diverged')
    expect(vaultLabel('offline')).toBe('Offline')
  })

  it('names whose state it is, so the dot beside the vault name explains itself', () => {
    for (const status of ['green', 'yellow', 'red', 'offline'] as const) {
      expect(vaultTitle(status)).toMatch(/^This vault: /)
    }
  })
})
