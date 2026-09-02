import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addShare,
  DEFAULT_RELAY,
  defaultRelay,
  deriveVaultName,
  lastVault,
  listVaults,
  loadConfig,
  loadShares,
  loadUser,
  operatorSecret,
  removeShare,
  removeVault,
  saveUser,
  setDefaultRelay,
  setOperatorSecret,
  setVaultRelay,
  touchVault,
  upsertVault,
  type VaultEntry,
} from './config.js'

/** Minimal Storage over a Map — config.ts only needs get/set/removeItem. */
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string): string | null {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v))
  }
  removeItem(k: string): void {
    this.m.delete(k)
  }
}

const g = globalThis as { localStorage?: unknown }

beforeEach(() => {
  g.localStorage = new MemStorage()
})
afterEach(() => {
  delete g.localStorage
})

function seed(key: string, value: unknown): void {
  ;(g.localStorage as MemStorage).setItem(
    key,
    typeof value === 'string' ? value : JSON.stringify(value)
  )
}

const tauriEntry: VaultEntry = {
  name: 'notes',
  room: 'room-a',
  vault: { kind: 'tauri', path: '/home/x/notes' },
}

describe('v1 → v2 migration', () => {
  it('fresh install: empty registry, defaults persisted once', () => {
    const cfg = loadConfig()
    expect(cfg.vaults).toEqual([])
    expect(cfg.lastRoom).toBeNull()
    expect(cfg.defaultRelay).toBe(DEFAULT_RELAY)
    // Persisted: a later corrupted v1 key must not resurrect anything.
    seed('editor:lastSession', { vault: { kind: 'opfs', id: 'x' }, room: 'ghost' })
    expect(listVaults()).toEqual([])
  })

  it('migrates a v1 lastSession + shares into the registry', () => {
    seed('editor:lastSession', {
      vault: { kind: 'tauri', path: '/home/chris/Documents/Test Vault' },
      room: 'room-1',
      relay: { url: 'ws://relay:8787', token: 't0k' },
      firstJoin: false,
    })
    seed('editor:shares', [{ link: 'editor1:abc', room: 'room-1', label: 'Chris' }])

    const cfg = loadConfig()
    expect(cfg.vaults).toHaveLength(1)
    expect(cfg.vaults[0]).toMatchObject({
      name: 'Test Vault', // basename, not the joiner's name
      room: 'room-1',
      relay: { url: 'ws://relay:8787', token: 't0k' },
    })
    expect(cfg.lastRoom).toBe('room-1')
    expect(cfg.defaultRelay).toBe('ws://relay:8787') // adopted from the session
    expect(loadShares()).toEqual([{ link: 'editor1:abc', room: 'room-1', label: 'Chris' }])
  })

  it('corrupted v1 JSON degrades to empty, never throws', () => {
    seed('editor:lastSession', '{not json')
    seed('editor:shares', '[[[')
    const cfg = loadConfig()
    expect(cfg.vaults).toEqual([])
    expect(cfg.shares).toEqual([])
  })

  it('corrupted v2 blob falls back to v1 migration', () => {
    seed('editor:config', '{"version":2,') // invalid JSON
    seed('editor:lastSession', { vault: { kind: 'opfs', id: 'v' }, room: 'r2' })
    expect(lastVault()?.room).toBe('r2')
  })

  it('drops malformed vault rows on load instead of crashing the manager', () => {
    seed('editor:config', {
      version: 2,
      vaults: [tauriEntry, null, { name: 'no room' }],
      lastRoom: 'room-a',
      defaultRelay: DEFAULT_RELAY,
      operatorSecret: '',
      shares: [],
    })
    expect(listVaults()).toHaveLength(1)
  })
})

describe('vault registry round-trips', () => {
  it('upsert/list/touch/lastVault/remove', () => {
    upsertVault(tauriEntry)
    upsertVault({ name: 'browser', room: 'room-b', vault: { kind: 'opfs', id: 'b' } })
    touchVault('room-b', 1000)
    touchVault('room-a', 2000)

    expect(listVaults().map((v) => v.room)).toEqual(['room-a', 'room-b']) // most recent first
    expect(lastVault()?.room).toBe('room-a')

    removeVault('room-a')
    expect(lastVault()).toBeNull() // removing the last vault clears auto-reopen
    expect(listVaults().map((v) => v.room)).toEqual(['room-b'])
  })

  it('touch clears pending firstJoin and upsert replaces by room', () => {
    upsertVault({ ...tauriEntry, firstJoin: true, relay: { url: 'ws://r', token: 't' } })
    touchVault('room-a', 5)
    expect(lastVault()?.firstJoin).toBe(false)

    upsertVault({ ...tauriEntry, name: 'renamed' })
    expect(listVaults().filter((v) => v.room === 'room-a')).toHaveLength(1)
    expect(getName('room-a')).toBe('renamed')

    setVaultRelay('room-a', { url: 'ws://new', token: 'n' })
    expect(listVaults()[0]?.relay?.url).toBe('ws://new')
  })
})

function getName(room: string): string | undefined {
  return listVaults().find((v) => v.room === room)?.name
}

describe('settings + shares', () => {
  it('default relay and operator secret round-trip; blank relay restores default', () => {
    setDefaultRelay('ws://my-relay:9000')
    setOperatorSecret('  s3cret  ')
    expect(defaultRelay()).toBe('ws://my-relay:9000')
    expect(operatorSecret()).toBe('s3cret')
    setDefaultRelay('   ')
    expect(defaultRelay()).toBe(DEFAULT_RELAY)
  })

  it('shares dedupe by room and forget works', () => {
    addShare({ link: 'editor1:a', room: 'r', label: 'one' })
    addShare({ link: 'editor1:b', room: 'r', label: 'two' })
    expect(loadShares()).toEqual([{ link: 'editor1:b', room: 'r', label: 'two' }])
    removeShare('r')
    expect(loadShares()).toEqual([])
  })
})

describe('user name healing (regression)', () => {
  it('unwraps layered JSON quoting from earlier builds', () => {
    seed('editor:user', '"\\"Chris\\""')
    expect(loadUser()).toBe('Chris')
    saveUser('Chris')
    expect((g.localStorage as MemStorage).getItem('editor:user')).toBe('Chris')
  })
})

describe('deriveVaultName', () => {
  it('uses the folder basename, with fallbacks', () => {
    expect(deriveVaultName({ kind: 'tauri', path: '/a/b/Notes/' })).toBe('Notes')
    expect(deriveVaultName({ kind: 'tauri', path: '/' })).toBe('My vault')
    expect(deriveVaultName({ kind: 'opfs', id: 'x' })).toBe('Browser vault')
  })
})
