// @vitest-environment jsdom
/**
 * The vault manager's controller (`manager.svelte.ts`): what gets written to
 * the registry on each way in, which errors it renders itself and which it
 * hands to the dialog, and that removing the OPEN vault closes it first.
 * The session is a stand-in — its own transitions are `session.test.ts`'s.
 */
import { getLL } from '@ohhi/i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultRelay,
  getVault,
  listVaults,
  loadConfig,
  loadShares,
  loadUser,
  operatorSecret,
  roomToken,
  roomTokenKind,
  saveUser,
  upsertVault,
  type VaultEntry,
} from './config.js'
import { createManager, type Manager, type ManagerHost } from './manager.svelte.js'
import type { Session } from './session.svelte.js'
import { encodeDeviceLink, encodeShareLink } from './share-link.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import type { Workspace } from './workspace.svelte.js'

const RELAY = 'wss://relay.example.com'
const ROOM = '6f3c1e2a-0000-4a1b-9c3d-abcdef012345'
const FOLDER_LINK = encodeShareLink({ relay: RELAY, room: ROOM, token: 'deadbeefcafef00d' })
const DEVICE_LINK = encodeDeviceLink({
  relay: RELAY,
  room: ROOM,
  token: 'deadbeefcafef00d',
  grants: [{ room: 'mount-1', relay: RELAY, token: 'feedface' }],
})

interface FakeSession extends Session {
  /** Writable here: the remove test needs a vault to be open. */
  workspace: Workspace | null
  booted: VaultEntry[]
  closed: number
}

function fakeSession(workspace: Workspace | null = null): FakeSession {
  const s: FakeSession = {
    view: 'manager',
    workspace,
    failure: null,
    busy: false,
    joining: null,
    pull: null,
    booted: [],
    closed: 0,
    start: () => {},
    boot: async (entry) => {
      s.booted.push(entry)
    },
    cancel: () => {},
    showManager: () => {},
    showWorkspace: () => {},
    close: () => {
      s.closed++
    },
  }
  return s
}

let session: FakeSession
let host: ManagerHost
let manager: Manager
let picked: string | null
let empty: boolean
let forgotten: VaultEntry[]
let linked: number

beforeEach(() => {
  useMemStorage()
  picked = '/home/chris/vault'
  empty = true
  forgotten = []
  linked = 0
  session = fakeSession()
  host = {
    isTauri: () => true,
    pickFolder: async () => picked,
    folderIsEmpty: async () => empty,
    forgetVaultState: async (entry) => {
      forgotten.push(entry)
      return [entry.room, 'mount-1']
    },
    cleanUrl: vi.fn(),
    onDeviceLinked: () => {
      linked++
    },
  }
  manager = createManager(session, host)
})

afterEach(() => {
  dropStorage()
})

describe('createManager', () => {
  it('openFolder registers the folder once, and a reopen resumes the same entry', async () => {
    await manager.openFolder('chris')
    expect(loadUser()).toBe('chris')
    expect(session.booted).toHaveLength(1)
    const first = session.booted[0]!
    expect(first.vault).toEqual({ kind: 'tauri', path: '/home/chris/vault' })
    expect(manager.vaults.map((v) => v.room)).toEqual([first.room])

    await manager.openFolder('chris')
    expect(session.booted[1]!.room).toBe(first.room)
    expect(listVaults()).toHaveLength(1)
    expect(host.cleanUrl).toHaveBeenCalledTimes(2)
  })

  it('a cancelled picker leaves nothing behind and is not busy', async () => {
    picked = null
    await manager.openFolder('chris')
    expect(session.booted).toEqual([])
    expect(listVaults()).toEqual([])
    expect(session.busy).toBe(false)
  })

  it('joinShare says which way a link is unusable, on the manager and to its caller', async () => {
    const failed = await manager.joinShare('chris', 'not a link')
    expect(session.failure?.room).toBeNull()
    expect(session.failure?.message).toBeTruthy()
    expect(failed).toBe(session.failure?.message)
    expect(session.busy).toBe(false)
    expect(session.booted).toEqual([])
  })

  it('joinShare on desktop: a first-join entry into the picked folder, the share remembered by vault name, the panel armed', async () => {
    await manager.joinShare('chris', FOLDER_LINK)
    const entry = session.booted[0]!
    expect(entry).toMatchObject({
      room: ROOM,
      firstJoin: true,
      relay: { url: RELAY, token: 'deadbeefcafef00d' },
      vault: { kind: 'tauri', path: '/home/chris/vault' },
    })
    expect(loadShares()).toEqual([{ link: FOLDER_LINK, room: ROOM, label: entry.name }])
    // Titled as a folder arriving, not as a device being linked (first-run F1).
    expect(session.joining).toEqual({ entry, destination: '/home/chris/vault', kind: 'folder' })
  })

  it('joinShare in the browser needs no picker: a private OPFS vault keyed by the room', async () => {
    host.isTauri = () => false
    await manager.joinShare('chris', FOLDER_LINK)
    expect(session.booted[0]!.vault).toEqual({ kind: 'opfs', id: ROOM })
    expect(session.joining?.destination).not.toBe('')
    expect(session.joining?.kind).toBe('folder')
    // Named after where it came from, never the literal "Shared vault" (first-run F1).
    expect(session.booted[0]!.name).toBe(getLL().web.manager.joined_vault_name({ host: 'relay.example.com' }))
  })

  it('joinShare in the browser names the vault after the folder when the link carries its label', async () => {
    host.isTauri = () => false
    const labelled = encodeShareLink({ relay: RELAY, room: ROOM, token: 'deadbeefcafef00d', label: 'clients/Team notes' })
    await manager.joinShare('chris', labelled)
    expect(session.booted[0]!.name).toBe('Team notes')
  })

  it('joinShare on a phone (Tauri, mobile): no picker, an OPFS vault keyed by the room, as in a browser', async () => {
    host.isMobile = () => true
    const pick = vi.fn(host.pickFolder)
    host.pickFolder = pick
    await manager.joinShare('chris', FOLDER_LINK)
    expect(pick).not.toHaveBeenCalled()
    expect(session.booted[0]!.vault).toEqual({ kind: 'opfs', id: ROOM })
    expect(session.joining?.kind).toBe('folder')
  })

  it('linkThisDevice on a phone: no picker and no empty-folder check, a fresh private OPFS vault', async () => {
    host.isMobile = () => true
    const pick = vi.fn(host.pickFolder)
    host.pickFolder = pick
    empty = false // there is no folder to be non-empty
    await manager.linkThisDevice(DEVICE_LINK)
    expect(pick).not.toHaveBeenCalled()
    const vault = getVault(ROOM)?.vault
    expect(vault?.kind).toBe('opfs')
    expect(vault?.kind === 'opfs' && vault.id).not.toBe(ROOM)
    expect(roomTokenKind(ROOM)).toBe('device')
    expect(linked).toBe(1)
  })

  it('a device link pasted into Join takes the device path', async () => {
    await manager.joinShare('chris', DEVICE_LINK)
    expect(session.booted[0]!.room).toBe(ROOM)
    expect(roomTokenKind(ROOM)).toBe('device')
    expect(linked).toBe(1)
    // A device link keeps "Linking this device".
    expect(session.joining?.kind).toBe('device')
  })

  it('join tells a cancelled folder picker from a failure and from a join that went ahead', async () => {
    picked = null
    expect(await manager.join('chris', FOLDER_LINK)).toEqual({ kind: 'cancelled' })
    expect(await manager.join('chris', DEVICE_LINK)).toEqual({ kind: 'cancelled' })
    expect(session.booted).toEqual([])
    expect(session.failure).toBeNull()
    expect(session.busy).toBe(false)

    const failed = await manager.join('chris', 'not a link')
    expect(failed).toEqual({ kind: 'failed', message: session.failure?.message })

    picked = '/home/chris/vault'
    expect(await manager.join('chris', FOLDER_LINK)).toEqual({ kind: 'started' })
    expect(session.booted[0]!.room).toBe(ROOM)
  })

  it('linkThisDevice merges the grants and stores the device key BEFORE the boot', async () => {
    let tokensAtBoot: [string, string] | null = null
    session.boot = async () => {
      tokensAtBoot = [roomToken(ROOM), roomToken('mount-1')]
    }
    await manager.linkThisDevice(DEVICE_LINK)
    expect(tokensAtBoot).toEqual(['deadbeefcafef00d', 'feedface'])
    expect(getVault(ROOM)?.firstJoin).toBe(true)
    expect(host.cleanUrl).toHaveBeenCalled()
  })

  it('linkThisDevice rejects — dialog-side — a folder link, a vault already linked, and a folder that is not empty', async () => {
    await expect(manager.linkThisDevice(FOLDER_LINK)).rejects.toThrow()

    empty = false
    await expect(manager.linkThisDevice(DEVICE_LINK)).rejects.toThrow('/home/chris/vault')
    expect(getVault(ROOM)).toBeNull()

    empty = true
    upsertVault({ name: 'Here already', room: ROOM, vault: { kind: 'opfs', id: 'x' } })
    await expect(manager.linkThisDevice(DEVICE_LINK)).rejects.toThrow('Here already')
  })

  it('linkThisDevice with the picker cancelled has done nothing', async () => {
    picked = null
    await manager.linkThisDevice(DEVICE_LINK)
    expect(getVault(ROOM)).toBeNull()
    expect(roomToken(ROOM)).toBe('')
    expect(linked).toBe(0)
  })

  it('rememberRelay: the share sheet\'s first run lands in Settings › Sync, the default relay only when changed', () => {
    const shown = manager.relayDefault
    manager.rememberRelay(shown, ' op-secret ')
    expect(operatorSecret()).toBe('op-secret')
    expect(manager.opSecret).toBe('op-secret')
    // The relay as shown is not stored: the build default keeps following the build.
    expect(loadConfig().defaultRelay).toBe('')

    manager.rememberRelay('wss://team.example', 'op-secret')
    expect(defaultRelay()).toBe('wss://team.example')
    expect(manager.relayDefault).toBe('wss://team.example')
  })

  it('removeVault: registry first, then the stores; the OPEN vault is closed before either', async () => {
    const entry: VaultEntry = { name: 'A', room: 'room-a', vault: { kind: 'opfs', id: 'a' } }
    upsertVault(entry)
    manager.refresh()
    session.workspace = { room: 'room-a' } as Workspace
    session.failure = { room: 'room-a', message: 'old' }

    await manager.removeVault('room-a')
    expect(session.closed).toBe(1)
    expect(getVault('room-a')).toBeNull()
    expect(manager.vaults).toEqual([])
    expect(session.failure).toBeNull()
    expect(forgotten.map((e) => e.room)).toEqual(['room-a'])
  })

  it('removeVault keeps the registry clean when the store wipe fails, and says so', async () => {
    upsertVault({ name: 'A', room: 'room-a', vault: { kind: 'opfs', id: 'a' } })
    host.forgetVaultState = async () => {
      throw new Error('opfs locked')
    }
    await manager.removeVault('room-a')
    expect(getVault('room-a')).toBeNull()
    expect(session.failure?.message).toContain('opfs locked')
  })

  it('openFolder with no saved name saves none: the welcome no longer asks for one (Fork 5-A)', async () => {
    await manager.openFolder('')
    expect(loadUser()).toBeNull()
    expect(manager.user).toBe('')
    expect(session.booted).toHaveLength(1)
  })

  it('user mirrors the saved name, re-read on refresh (Settings › General writes it)', () => {
    expect(manager.user).toBe('')
    saveUser('Cynthia')
    manager.refresh()
    expect(manager.user).toBe('Cynthia')
  })

  it('renameVault renames the registry entry only — the folder path stays', () => {
    upsertVault({ name: 'vault', room: 'room-a', vault: { kind: 'tauri', path: '/home/chris/vault' } })
    manager.refresh()
    manager.renameVault('room-a', '  Work notes ')
    expect(getVault('room-a')).toMatchObject({ name: 'Work notes', vault: { kind: 'tauri', path: '/home/chris/vault' } })
    expect(manager.vaults[0]!.name).toBe('Work notes')

    manager.renameVault('room-a', '   ')
    expect(getVault('room-a')!.name).toBe('Work notes')
    manager.renameVault('no-such-room', 'x')
    expect(listVaults()).toHaveLength(1)
  })

  it('loadFacts counts each vault\'s mount table, skips the open vault, and says null for an unreadable one', async () => {
    upsertVault({ name: 'A', room: 'room-a', vault: { kind: 'tauri', path: '/a' } })
    upsertVault({ name: 'B', room: 'room-b', vault: { kind: 'opfs', id: 'b' } })
    upsertVault({ name: 'Open', room: 'room-open', vault: { kind: 'opfs', id: 'o' } })
    const read = vi.fn(async (entry: VaultEntry) => {
      if (entry.room === 'room-b') throw new Error('unreadable')
      return [
        { room: 'room-a', path: '', provenance: 'local' as const, status: 'active' as const },
        { room: 'm1', path: 'clients', provenance: 'carved' as const, status: 'active' as const },
        { room: 'm2', path: 'team', provenance: 'joined' as const, status: 'active' as const, relay: { url: RELAY } },
        { room: 'm3', path: 'more', provenance: 'joined' as const, status: 'needs-token' as const },
      ]
    })
    host.readMounts = read
    await manager.loadFacts('room-open')
    expect(read.mock.calls.map(([e]) => e.room).sort()).toEqual(['room-a', 'room-b'])
    expect(manager.facts).toEqual({ 'room-a': { sharedByYou: 1, sharedWithYou: 2 }, 'room-b': null })
  })

  it('loadFacts without a mount reader leaves every row without facts', async () => {
    upsertVault({ name: 'A', room: 'room-a', vault: { kind: 'tauri', path: '/a' } })
    await manager.loadFacts()
    expect(manager.facts).toEqual({})
  })

  describe('allowAccessAgain (DEL-89)', () => {
    const SAVED = '/home/chris/vault'
    const REFUSED = { room: 'room-t', message: 'needs permission', access: true } as const
    let asked: (string | undefined)[]

    beforeEach(() => {
      upsertVault({ name: 'vault', room: 'room-t', vault: { kind: 'tauri', path: SAVED } })
      asked = []
      host.pickFolder = async (defaultPath) => {
        asked.push(defaultPath)
        return picked
      }
      session.failure = { ...REFUSED }
    })

    it('opens the picker on the saved folder; the same folder boots the vault', async () => {
      picked = `${SAVED}/`
      await manager.allowAccessAgain('room-t')
      expect(asked).toEqual([SAVED])
      expect(session.booted.map((e) => e.room)).toEqual(['room-t'])
    })

    it('a different folder is refused, said, and leaves the vault as it was', async () => {
      picked = '/home/chris/elsewhere'
      await manager.allowAccessAgain('room-t')
      expect(session.booted).toEqual([])
      expect(session.failure?.room).toBe('room-t')
      expect(session.failure?.access).toBe(true)
      expect(session.failure?.message).toContain('/home/chris/elsewhere')
      expect(session.failure?.message).toContain(SAVED)
      expect(getVault('room-t')?.vault).toEqual({ kind: 'tauri', path: SAVED })
      expect(session.busy).toBe(false)
    })

    it('a cancelled picker changes nothing', async () => {
      picked = null
      await manager.allowAccessAgain('room-t')
      expect(session.booted).toEqual([])
      expect(session.failure).toEqual(REFUSED)
      expect(session.busy).toBe(false)
    })
  })
})
