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
  grantsForBundle,
  mergeGrants,
  operatorSecret,
  purgeRooms,
  removeShare,
  removeVault,
  roomRelay,
  roomToken,
  roomTokenKind,
  saveUser,
  setDefaultRelay,
  setOperatorSecret,
  setRoomToken,
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

  it('purgeRooms drops tokens and remembered shares for exactly those rooms', () => {
    setRoomToken('root-r', 't1', 'ws://relay-1')
    setRoomToken('mount-r', 't2')
    setRoomToken('other-r', 't3')
    addShare({ link: 'editor1:m', room: 'mount-r', label: 'team' })
    addShare({ link: 'editor1:o', room: 'other-r', label: 'keep' })
    purgeRooms(['root-r', 'mount-r'])
    expect(roomToken('root-r')).toBe('')
    expect(roomToken('mount-r')).toBe('')
    expect(roomToken('other-r')).toBe('t3')
    expect(roomRelay('root-r')).toBe('') // the relay URL goes with the token
    expect(loadShares()).toEqual([{ link: 'editor1:o', room: 'other-r', label: 'keep' }])
  })
})

describe('device-link grants (device-link-shaping A4-B)', () => {
  it('remembers a relay alongside a token, and bundles the triples', () => {
    setRoomToken('team-r', 'team-token', 'wss://relay.example.com')
    setRoomToken('foreign-r', 'foreign-token', ' wss://other.example.com ') // trimmed
    expect(roomRelay('team-r')).toBe('wss://relay.example.com')
    expect(grantsForBundle()).toEqual([
      { room: 'team-r', relay: 'wss://relay.example.com', token: 'team-token' },
      { room: 'foreign-r', relay: 'wss://other.example.com', token: 'foreign-token' },
    ])
  })

  it('falls back to the vault entry’s relay, then the default, for tokens stored before N2', () => {
    seed('editor:config', {
      version: 2,
      vaults: [{ ...tauriEntry, relay: { url: 'ws://vault-relay:8787', token: 'x' } }],
      lastRoom: 'room-a',
      defaultRelay: 'ws://settings-relay:8787',
      operatorSecret: '',
      shares: [],
      tokensByRoom: { 'room-a': 'root-token', 'mount-r': 'mount-token' },
    })
    // Loads without the new field and never throws (the blob stays v2).
    expect(loadConfig().relayByRoom).toEqual({})
    expect(roomToken('room-a')).toBe('root-token')
    expect(grantsForBundle()).toEqual([
      { room: 'room-a', relay: 'ws://vault-relay:8787', token: 'root-token' },
      { room: 'mount-r', relay: 'ws://settings-relay:8787', token: 'mount-token' },
    ])
  })

  it('mergeGrants stores new tokens and never clobbers a local one', () => {
    setRoomToken('known-r', 'local-token', 'ws://local-relay')
    const stored = mergeGrants([
      { room: 'known-r', relay: 'ws://bundle-relay', token: 'stale-bundle-token' },
      { room: 'new-r', relay: 'ws://bundle-relay', token: 'bundle-token' },
      { room: '', relay: 'ws://bundle-relay', token: 'no-room' },
    ])
    expect(stored).toEqual(['new-r'])
    expect(roomToken('known-r')).toBe('local-token') // the local one may be newer
    expect(roomRelay('known-r')).toBe('ws://local-relay')
    expect(roomToken('new-r')).toBe('bundle-token')
    expect(roomRelay('new-r')).toBe('ws://bundle-relay')
  })

  it('merged grants are folder tokens; only the vault link itself is a device key', () => {
    setRoomToken('root-r', 'device-token', 'ws://relay', 'device')
    mergeGrants([{ room: 'team-r', relay: 'ws://relay', token: 'team-token' }])
    expect(roomTokenKind('root-r')).toBe('device')
    expect(roomTokenKind('team-r')).toBe('folder')
    expect(roomTokenKind('never-seen')).toBe('')
  })

  it('a token stored before N1 reads as a FOLDER token (the safe default)', () => {
    seed('editor:config', {
      version: 2,
      vaults: [],
      lastRoom: null,
      defaultRelay: 'ws://relay',
      operatorSecret: '',
      shares: [],
      tokensByRoom: { 'legacy-r': 'legacy-token' },
    })
    expect(roomToken('legacy-r')).toBe('legacy-token')
    // Never 'device': a folder token that reached the vault would be exactly
    // the leak R5 forbids, and no pre-N1 build ever minted a device token.
    expect(roomTokenKind('legacy-r')).toBe('folder')
  })

  it('a kind survives a reload, and setRoomToken keeps it when not restated', () => {
    setRoomToken('root-r', 'device-token', 'ws://relay', 'device')
    setRoomToken('root-r', 'rotated-token') // a re-mint, same credential kind
    expect(roomToken('root-r')).toBe('rotated-token')
    expect(roomTokenKind('root-r')).toBe('device')
  })

  it('a merged bundle survives a reload and re-bundles unchanged', () => {
    const grants = [
      { room: 'a-r', relay: 'ws://relay-a', token: 'a-token' },
      { room: 'b-r', relay: 'ws://relay-b', token: 'b-token' },
    ]
    expect(mergeGrants(grants)).toEqual(['a-r', 'b-r'])
    expect(grantsForBundle()).toEqual(grants)
    // Merging the same bundle twice stores nothing new (idempotent paste).
    expect(mergeGrants(grants)).toEqual([])
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
