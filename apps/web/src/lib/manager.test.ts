// @vitest-environment jsdom
/**
 * The vault manager's controller (`manager.svelte.ts`): what gets written to
 * the registry on each way in, which errors it renders itself and which it
 * hands to the dialog, and that removing the OPEN vault closes it first.
 * The session is a stand-in — its own transitions are `session.test.ts`'s.
 */
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
    expect(session.joining).toEqual({ entry, destination: '/home/chris/vault' })
  })

  it('joinShare in the browser needs no picker: a private OPFS vault keyed by the room', async () => {
    host.isTauri = () => false
    await manager.joinShare('chris', FOLDER_LINK)
    expect(session.booted[0]!.vault).toEqual({ kind: 'opfs', id: ROOM })
    expect(session.joining?.destination).not.toBe('')
  })

  it('a device link pasted into Join takes the device path', async () => {
    await manager.joinShare('chris', DEVICE_LINK)
    expect(session.booted[0]!.room).toBe(ROOM)
    expect(roomTokenKind(ROOM)).toBe('device')
    expect(linked).toBe(1)
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
