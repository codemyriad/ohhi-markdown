import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aiConfig,
  aiEnabled,
  providerView,
  setAiConfig,
  addShare,
  DEFAULT_RELAY,
  defaultRelay,
  FALLBACK_RELAY,
  buildText,
  DEFAULT_RELAY_CONFIGURED,
  isDefaultRelayConfigured,
  resolveTeamHost,
  relayKnown,
  resolveDefaultRelay,
  TEAM_NETWORK_NOTE,
  TEAM_SECRET_HINT,
  setStorageNoticeDismissed,
  storageNoticeDismissed,
  deriveVaultName,
  lastVault,
  listVaults,
  loadConfig,
  loadShares,
  loadUser,
  grantsForBundle,
  ignoredSavedRelay,
  clearHotkeys,
  drawerSeenAt,
  hotkeys,
  layoutPins,
  layoutPrefs,
  setDrawerSeenAt,
  setLayoutPins,
  layoutOverrides,
  setLayoutOverrides,
  setLayoutPrefs,
  mergeGrants,
  operatorSecret,
  paneHints,
  PANE_HINTS_DEFAULT,
  purgeRooms,
  readPrefs,
  removeShare,
  removeVault,
  roomRelay,
  roomToken,
  roomTokenKind,
  saveUser,
  setDefaultRelay,
  setOperatorSecret,
  setPaneHints,
  setReadPrefs,
  setRoomToken,
  touchVault,
  upsertVault,
  type VaultEntry,
} from './config.js'
import { dropStorage, seedStored as seed, useMemStorage } from './storage.fixture.js'

let store = useMemStorage()

beforeEach(() => {
  store = useMemStorage()
})
afterEach(dropStorage)

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
    // The relay is NOT pinned: '' follows whatever default the running build has.
    expect(cfg.defaultRelay).toBe('')
    expect(defaultRelay()).toBe(DEFAULT_RELAY)
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

  it('the storage note’s dismissal is remembered per device', () => {
    expect(storageNoticeDismissed()).toBe(false)
    setStorageNoticeDismissed(true)
    expect(storageNoticeDismissed()).toBe(true)
    const stored = JSON.parse(store.getItem('editor:config')!)
    expect(stored.storageNoticeDismissed).toBe(true)
    setStorageNoticeDismissed(false) // Settings › "Remind me about this"
    expect(storageNoticeDismissed()).toBe(false)
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

describe('reading preferences (read-shaping B3)', () => {
  it('defaults to Live, which is what 36 of 36 measured leaves are', () => {
    expect(readPrefs()).toEqual({ defaultMode: 'live' })
  })

  it('round-trips through the blob, additively — nothing else is disturbed', () => {
    setDefaultRelay('ws://my-relay:9000')
    setReadPrefs({ defaultMode: 'reading' })
    expect(readPrefs().defaultMode).toBe('reading')
    expect(defaultRelay()).toBe('ws://my-relay:9000')
    // A config written before this shipped simply has no `read` key.
    expect(loadConfig().version).toBe(2)
  })

  it('a stored mode that is not a mode reads as the default, never as a crash', () => {
    seed('editor:config', { ...loadConfig(), read: { defaultMode: 'preview' } })
    expect(readPrefs().defaultMode).toBe('live')
  })
})

describe('AI providers (writing-harness-shaping B1)', () => {
  const anthropic = {
    id: 'p1',
    name: 'Claude',
    kind: 'anthropic' as const,
    baseUrl: '',
    apiKey: 'sk-secret',
    model: 'claude-x',
  }

  it('is off with no provider — the quiet default (R1)', () => {
    expect(aiConfig()).toEqual({ providers: [] })
    expect(aiEnabled()).toBe(false)
  })

  it('round-trips through the blob, additively, and turns AI on', () => {
    setDefaultRelay('ws://my-relay:9000')
    setAiConfig({ providers: [anthropic], defaultProvider: 'p1' })
    expect(aiConfig()).toEqual({ providers: [anthropic], defaultProvider: 'p1' })
    expect(aiEnabled()).toBe(true)
    expect(defaultRelay()).toBe('ws://my-relay:9000')
    setAiConfig({ providers: [] })
    expect(aiEnabled()).toBe(false)
  })

  it('a garbage entry is dropped without costing the others; a dangling default is dropped', () => {
    seed('editor:config', {
      ...loadConfig(),
      ai: { providers: [anthropic, { id: 'x', name: 'X', kind: 'gemini' }, 'nope'], defaultProvider: 'gone' },
    })
    expect(aiConfig()).toEqual({ providers: [anthropic] })
  })

  it('providerView strips the key and says only whether one is set', () => {
    const view = providerView(anthropic)
    expect(view).not.toHaveProperty('apiKey')
    expect(view.apiKeyConfigured).toBe(true)
    expect(JSON.stringify(view)).not.toContain('sk-secret')
    const { apiKey: _key, ...keyless } = anthropic
    expect(providerView(keyless).apiKeyConfigured).toBe(false)
  })
})

describe('the build’s default relay (VITE_DEFAULT_RELAY)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  /** config.ts as a build made with `VITE_DEFAULT_RELAY=value` loads it. */
  async function build(value: string): Promise<typeof import('./config.js')> {
    vi.stubEnv('VITE_DEFAULT_RELAY', value)
    vi.resetModules()
    return import('./config.js')
  }

  it('takes a ws(s):// URL from the build, else falls back to local dev', () => {
    expect(resolveDefaultRelay(undefined)).toBe(FALLBACK_RELAY)
    expect(resolveDefaultRelay('')).toBe(FALLBACK_RELAY)
    expect(resolveDefaultRelay('wss://relay.example.test')).toBe('wss://relay.example.test')
    expect(resolveDefaultRelay('  ws://10.0.0.2:8787  ')).toBe('ws://10.0.0.2:8787')
    // Malformed values are ignored, never shipped.
    expect(resolveDefaultRelay('https://relay.example.test')).toBe(FALLBACK_RELAY)
    expect(resolveDefaultRelay('wss://')).toBe(FALLBACK_RELAY)
    expect(resolveDefaultRelay('wss://relay example')).toBe(FALLBACK_RELAY)
    // The test build sets none.
    expect(DEFAULT_RELAY).toBe(FALLBACK_RELAY)
  })

  it('a fresh install follows the build’s default — and the next build’s', async () => {
    const a = await build('wss://relay-a.example')
    expect(a.defaultRelay()).toBe('wss://relay-a.example')
    expect(a.loadConfig().defaultRelay).toBe('') // nothing pinned at creation
    const b = await build('wss://relay-b.example')
    expect(b.defaultRelay()).toBe('wss://relay-b.example')
  })

  it('a relay the user saved is never overridden by a rebuild', async () => {
    const a = await build('wss://relay-a.example')
    a.setDefaultRelay('ws://mine:9000')
    const b = await build('wss://relay-b.example')
    expect(b.defaultRelay()).toBe('ws://mine:9000')
    b.setDefaultRelay('   ') // cleared: follow the build again
    expect(b.defaultRelay()).toBe('wss://relay-b.example')
  })

  it('a value stored by an older build is kept as it is (not migrated)', async () => {
    seed('editor:config', {
      version: 2,
      vaults: [],
      lastRoom: null,
      defaultRelay: 'ws://localhost:8787', // what pre-VITE_DEFAULT_RELAY builds pinned
      operatorSecret: '',
      shares: [],
    })
    const b = await build('wss://relay-b.example')
    expect(b.defaultRelay()).toBe('ws://localhost:8787')
  })

  it('a malformed build value falls back rather than shipping', async () => {
    const c = await build('relay.example.com')
    expect(c.DEFAULT_RELAY).toBe(FALLBACK_RELAY)
    expect(c.defaultRelay()).toBe(FALLBACK_RELAY)
  })

  it('knows whether the build was given a relay — the local-dev fallback is not one', async () => {
    expect(isDefaultRelayConfigured(undefined)).toBe(false)
    expect(isDefaultRelayConfigured('')).toBe(false)
    expect(isDefaultRelayConfigured('relay.example.com')).toBe(false)
    expect(isDefaultRelayConfigured('  wss://relay.example.test ')).toBe(true)
    // Given explicitly, even the dev URL is a choice the build made.
    expect(isDefaultRelayConfigured('ws://localhost:8787')).toBe(true)
    // The test build sets none.
    expect(DEFAULT_RELAY_CONFIGURED).toBe(false)
    expect((await build('wss://relay-a.example')).DEFAULT_RELAY_CONFIGURED).toBe(true)
    expect((await build('nonsense')).DEFAULT_RELAY_CONFIGURED).toBe(false)
  })

  it('a relay is known when Settings saved one or the build was given one', async () => {
    expect(relayKnown()).toBe(false) // fresh install, no variable: only the fallback
    setDefaultRelay('ws://mine:9000')
    expect(relayKnown()).toBe(true)
    setDefaultRelay('')
    expect(relayKnown()).toBe(false)
    const b = await build('wss://relay-b.example')
    expect(b.relayKnown()).toBe(true)
  })
})

describe('a pinned build ignores a relay saved before the pin (VITE_TEAM_HOST)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  const TEAM = 'wss://ohhi.example.ts.net/relay'

  /** config.ts as a pinned build loads it: team host + the team's relay baked in. */
  async function pinned(): Promise<typeof import('./config.js')> {
    vi.stubEnv('VITE_TEAM_HOST', 'ohhi.example.ts.net')
    vi.stubEnv('VITE_DEFAULT_RELAY', TEAM)
    vi.resetModules()
    return import('./config.js')
  }

  it('every reader falls back to the build’s relay — defaultRelay, relayKnown, the grants’ fallback — and names the ignored one', async () => {
    setDefaultRelay('wss://old.example/relay') // saved by an unpinned build
    setRoomToken('orphan-r', 'tok') // no relay recorded: falls back
    const c = await pinned()
    expect(c.TEAM_HOST).toBe('ohhi.example.ts.net')
    expect(c.defaultRelay()).toBe(TEAM)
    expect(c.relayKnown()).toBe(true) // the build's own relay
    expect(c.grantsForBundle()).toEqual([{ room: 'orphan-r', relay: TEAM, token: 'tok' }])
    expect(c.ignoredSavedRelay()).toBe('wss://old.example/relay')
    // Nothing is rewritten: the saved value stays as it was (files and config are not ours to reserialize).
    expect(c.loadConfig().defaultRelay).toBe('wss://old.example/relay')
  })

  it('a saved relay ON the pinned host is used, case-insensitively, and nothing is ignored', async () => {
    setDefaultRelay('wss://OHHI.example.ts.net/relay/')
    const c = await pinned()
    expect(c.defaultRelay()).toBe('wss://OHHI.example.ts.net/relay/')
    expect(c.ignoredSavedRelay()).toBe('')
  })

  it('a generic build keeps whatever was saved', () => {
    setDefaultRelay('wss://old.example/relay')
    expect(defaultRelay()).toBe('wss://old.example/relay')
    expect(relayKnown()).toBe(true)
    expect(ignoredSavedRelay()).toBe('')
    // The pinned host can also be passed (Settings passes its own).
    expect(defaultRelay('ohhi.example.ts.net')).toBe(DEFAULT_RELAY)
    expect(relayKnown('ohhi.example.ts.net')).toBe(false) // the test build was given no relay
    expect(ignoredSavedRelay('ohhi.example.ts.net')).toBe('wss://old.example/relay')
  })
})

describe('the build’s team sentences (VITE_TEAM_SECRET_HINT, VITE_TEAM_NETWORK_NOTE)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('reads a sentence trimmed, and nothing as empty', () => {
    expect(buildText(undefined)).toBe('')
    expect(buildText(42)).toBe('')
    expect(buildText('   ')).toBe('')
    expect(buildText('  the team password manager, under ohhi relay ')).toBe('the team password manager, under ohhi relay')
    // The test build sets neither.
    expect(TEAM_SECRET_HINT).toBe('')
    expect(TEAM_NETWORK_NOTE).toBe('')
  })

  it('exposes what the build was given', async () => {
    vi.stubEnv('VITE_TEAM_SECRET_HINT', ' the team password manager, under ohhi relay ')
    vi.stubEnv('VITE_TEAM_NETWORK_NOTE', 'Shares work only while you are on the company tailnet.')
    vi.resetModules()
    const c = await import('./config.js')
    expect(c.TEAM_SECRET_HINT).toBe('the team password manager, under ohhi relay')
    expect(c.TEAM_NETWORK_NOTE).toBe('Shares work only while you are on the company tailnet.')
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

  it('the N2 link round-trip: bundle here, merge there, re-bundle from there', () => {
    // Device A holds the vault's device key and two folder tokens.
    setRoomToken('vault-r', 'device-token', 'wss://relay.example', 'device')
    setRoomToken('team-r', 'team-token', 'wss://relay.example', 'folder')
    setRoomToken('design-r', 'design-token', 'wss://cynthia.example', 'folder')
    const bundle = grantsForBundle().filter((g) => g.room !== 'vault-r')
    expect(bundle).toEqual([
      { room: 'team-r', relay: 'wss://relay.example', token: 'team-token' },
      { room: 'design-r', relay: 'wss://cynthia.example', token: 'design-token' },
    ])

    // Device B: the link's grants merge BEFORE the boot, then the link's own
    // token is stored as the DEVICE key for the root room (App.linkThisDevice).
    seed('editor:config', {
      version: 2,
      vaults: [],
      lastRoom: null,
      defaultRelay: 'ws://localhost:8787',
      operatorSecret: '',
      shares: [],
      tokensByRoom: {},
    })
    expect(mergeGrants(bundle)).toEqual(['team-r', 'design-r'])
    setRoomToken('vault-r', 'device-token', 'wss://relay.example', 'device')

    expect(roomTokenKind('vault-r')).toBe('device')
    expect(roomTokenKind('team-r')).toBe('folder')
    expect(roomTokenKind('design-r')).toBe('folder')
    expect(roomRelay('design-r')).toBe('wss://cynthia.example')
    // B could now link a third device and hand on exactly what it holds.
    expect(grantsForBundle()).toEqual([
      { room: 'team-r', relay: 'wss://relay.example', token: 'team-token' },
      { room: 'design-r', relay: 'wss://cynthia.example', token: 'design-token' },
      { room: 'vault-r', relay: 'wss://relay.example', token: 'device-token' },
    ])
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

describe('legacy hotkey overrides (read once, by the keymap migration)', () => {
  it('reads a config written before hotkeys existed, and a garbage map; clearHotkeys forgets it', () => {
    expect(hotkeys()).toEqual({})
    const cfg = loadConfig() as unknown as Record<string, unknown>
    cfg.hotkeys = { good: 'Mod+g', bad: 'Nope+g', worse: 12, gone: null }
    seed('editor:config', cfg)
    expect(hotkeys()).toEqual({ good: 'Mod+g', gone: null })
    setDefaultRelay('wss://relay.example')
    expect(hotkeys()).toEqual({ good: 'Mod+g', gone: null })
    clearHotkeys()
    expect(hotkeys()).toEqual({})
    expect(defaultRelay()).toBe('wss://relay.example')
  })
})

describe('the drawer read state, per vault (quiet-shell F13)', () => {
  it('is null until set, kept per room, and tolerant of garbage', () => {
    expect(drawerSeenAt('r1')).toBeNull()
    setDrawerSeenAt('r1', 1_000)
    setDrawerSeenAt('r2', 2_000)
    expect(drawerSeenAt('r1')).toBe(1_000)
    expect(drawerSeenAt('r2')).toBe(2_000)
    const cfg = loadConfig() as unknown as Record<string, unknown>
    cfg.drawerSeen = { r1: 'yesterday' }
    seed('editor:config', cfg)
    expect(drawerSeenAt('r1')).toBeNull()
  })
})

describe('the pane-mode hints (E6, Settings › Layout › Pane keys)', () => {
  it('default to Subtle, persist per device, and read garbage as the default', () => {
    expect(PANE_HINTS_DEFAULT).toBe('subtle')
    expect(paneHints()).toBe('subtle')
    setPaneHints('full')
    expect(paneHints()).toBe('full')
    expect((loadConfig() as unknown as Record<string, unknown>).paneHints).toBe('full')
    setPaneHints('off')
    expect(paneHints()).toBe('off')
    const cfg = loadConfig() as unknown as Record<string, unknown>
    cfg.paneHints = 'loud'
    seed('editor:config', cfg)
    expect(paneHints()).toBe('subtle')
  })
})

describe('layout pins (Round 2, P7)', () => {
  it('are device config, kept per side, survive a layout-prefs write, and are tolerant of garbage', () => {
    expect(layoutPins()).toEqual({})
    setLayoutPins({ rail: 'column' })
    expect(layoutPins()).toEqual({ rail: 'column' })
    setLayoutPrefs({ active: 'custom:dense', treeWidth: 300 })
    expect(layoutPins()).toEqual({ rail: 'column' })
    expect(layoutPrefs().active).toBe('custom:dense')
    setLayoutPins({})
    expect(layoutPins()).toEqual({})
    expect(layoutPrefs().treeWidth).toBe(300)
    const cfg = loadConfig() as unknown as Record<string, unknown>
    cfg.layout = { pins: { navigator: 'yes', rail: 'column', extra: 'column' } }
    seed('editor:config', cfg)
    expect(layoutPins()).toEqual({ rail: 'column' })
  })
})

describe('layout overrides (round 3, Q6)', () => {
  it('are device config, survive a pins or prefs write, and read garbage as none', () => {
    expect(layoutOverrides()).toEqual({ $schema: 'ohhi.layout.v1' })
    setLayoutOverrides({ $schema: 'ohhi.layout.v1', toolbar: { position: 'bottom' } })
    setLayoutPins({ rail: 'column' })
    setLayoutPrefs({ treeWidth: 320 })
    expect(layoutOverrides()).toEqual({ $schema: 'ohhi.layout.v1', toolbar: { position: 'bottom' } })
    expect(layoutPins()).toEqual({ rail: 'column' })
    setLayoutOverrides({ $schema: 'ohhi.layout.v1' })
    expect(layoutOverrides()).toEqual({ $schema: 'ohhi.layout.v1' })
    expect(layoutPins()).toEqual({ rail: 'column' })
    const cfg = loadConfig() as unknown as Record<string, unknown>
    cfg.layout = { overrides: { toolbar: { position: 'sideways' } } }
    seed('editor:config', cfg)
    expect(layoutOverrides()).toEqual({ $schema: 'ohhi.layout.v1' })
  })
})

describe('user name healing (regression)', () => {
  it('unwraps layered JSON quoting from earlier builds', () => {
    seed('editor:user', '"\\"Chris\\""')
    expect(loadUser()).toBe('Chris')
    saveUser('Chris')
    expect(store.getItem('editor:user')).toBe('Chris')
  })
})

describe('deriveVaultName', () => {
  it('uses the folder basename, with fallbacks', () => {
    expect(deriveVaultName({ kind: 'tauri', path: '/a/b/Notes/' })).toBe('Notes')
    expect(deriveVaultName({ kind: 'tauri', path: '/' })).toBe('My vault')
    expect(deriveVaultName({ kind: 'opfs', id: 'x' })).toBe('Browser vault')
  })
})

describe('resolveTeamHost (VITE_TEAM_HOST, first-run R10)', () => {
  it('is the bare host the CSP is pinned to, lower-cased; anything else reads as unset', () => {
    expect(resolveTeamHost(undefined)).toBe('')
    expect(resolveTeamHost('')).toBe('')
    expect(resolveTeamHost('  Ohhi.Example.ts.net ')).toBe('ohhi.example.ts.net')
    expect(resolveTeamHost('relay.example.com:8443')).toBe('relay.example.com:8443')
    // A scheme or a path is not what the workflow's TEAM_HOST is.
    expect(resolveTeamHost('wss://ohhi.example.ts.net/relay')).toBe('')
    expect(resolveTeamHost('ohhi.example.ts.net/relay')).toBe('')
  })
})
