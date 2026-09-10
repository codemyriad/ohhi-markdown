import { describe, expect, it } from 'vitest'
import type { SyncRecordSnapshot } from './pill-status.js'
import { inRelayMount, mountRollup, rowStatus } from './tree-status.js'

const rec = (over: Partial<SyncRecordSnapshot>): SyncRecordSnapshot => ({
  connected: true,
  synced: true,
  pendingLocal: false,
  diskMatchesCrdt: true,
  diverged: false,
  ...over,
})

describe('inRelayMount', () => {
  it('is true inside a mount root or its subtree, and everywhere in a root-shared vault', () => {
    expect(inRelayMount('team/a.md', ['team'], false)).toBe(true)
    expect(inRelayMount('team', ['team'], false)).toBe(true)
    expect(inRelayMount('teamwork/a.md', ['team'], false)).toBe(false)
    expect(inRelayMount('notes/a.md', ['team'], false)).toBe(false)
    expect(inRelayMount('notes/a.md', [], true)).toBe(true)
  })
})

describe('rowStatus — quiet when good, loud when not', () => {
  it('hides green inside a shared folder and shows every other state', () => {
    expect(rowStatus('green', true)).toBeNull()
    expect(rowStatus('yellow', true)).toBe('yellow')
    expect(rowStatus('offline', true)).toBe('offline')
    expect(rowStatus('red', true)).toBe('red')
  })

  it('shows nothing for a local file except a divergence', () => {
    // A local record never connects: "offline" would be the absence of a relay, not a state.
    expect(rowStatus('offline', false)).toBeNull()
    expect(rowStatus('yellow', false)).toBeNull()
    expect(rowStatus('green', false)).toBeNull()
    expect(rowStatus('red', false)).toBe('red')
  })
})

describe('mountRollup', () => {
  const files = [
    { path: 'team/a.md', kind: 'text', guid: 'a' },
    { path: 'team/b.md', kind: 'text', guid: 'b' },
    { path: 'team/pic.png', kind: 'binary', guid: 'p' },
    { path: 'notes/c.md', kind: 'text', guid: 'c' },
  ]

  it('is the worst of the mount’s docs, ignoring files outside it and binaries', () => {
    const records = { a: rec({}), b: rec({ pendingLocal: true }), c: rec({ diverged: true }) }
    expect(mountRollup(files, records, 'team', 'room-1')).toBe('yellow')
  })

  it('counts the folder doc, so an empty shared folder still reports its connection', () => {
    expect(mountRollup([], { '//folder:room-1': rec({ connected: false }) }, 'team', 'room-1')).toBe(
      'offline'
    )
    expect(mountRollup([], { '//folder:room-1': rec({}) }, 'team', 'room-1')).toBe('green')
  })

  it('claims less, not more, with nothing to report', () => {
    expect(mountRollup([], {}, 'team', 'room-1')).toBe('offline')
  })
})
