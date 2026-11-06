// @vitest-environment jsdom
/**
 * The Nextcloud open flow (decisions 2–4): a server grant booted as a join,
 * the token in memory only, a fresh token on every reconnect, the Files-menu
 * launch confirmed once, `?open=` selected after the boot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listVaults, type VaultEntry } from '../config.js'
import type { Session } from '../session.svelte.js'
import { dropStorage, useMemStorage, type MemStorage } from '../storage.fixture.js'
import type { Workspace } from '../workspace.svelte.js'
import type { NcApi, NcSessionGrant, NcVaultRow } from './api.js'
import { NcApiError } from './api.js'
import { createNcVaults, vaultName, type NcVaults } from './vaults.svelte.js'

const ROW: NcVaultRow = {
  id: '11111111-1111-4111-8111-111111111111',
  fileId: 42,
  ownerUid: 'alice',
  ownerPath: 'Documents/Notes',
  room: 'room-1',
  epoch: 1,
  createdAt: '2026-10-11T00:00:00Z',
  status: 'active',
}
const SHARED: NcVaultRow = { ...ROW, id: '22222222-2222-4222-8222-222222222222', fileId: 77, ownerUid: 'bob', ownerPath: 'Team', room: 'room-2' }

let tokenSeq = 0
const grantFor = (row: NcVaultRow): NcSessionGrant => ({
  token: `tok-${++tokenSeq}`,
  expiresAt: 0,
  readOnly: row.ownerUid !== 'alice',
  room: row.room,
  vaultId: row.id,
})

interface FakeSession extends Session {
  workspace: Workspace | null
  view: Session['view']
  booted: VaultEntry[]
  closed: number
}

function fakeSession(): FakeSession {
  const s = {
    view: 'manager',
    workspace: null,
    failure: null,
    busy: false,
    joining: null,
    pull: null,
    booted: [] as VaultEntry[],
    start: () => {},
    boot: async (entry: VaultEntry) => {
      s.booted.push(entry)
      s.view = 'workspace'
      s.workspace = { room: entry.room, ui: { readOnly: entry.readOnly === true } } as unknown as Workspace
      s.busy = false
    },
    cancel: () => {},
    showManager: () => {},
    showWorkspace: () => {},
    close: () => {
      s.workspace = null
      s.closed++
    },
    closed: 0,
  } as FakeSession
  return s
}

let storage: MemStorage
let session: FakeSession
let api: NcApi
let rows: { own: NcVaultRow[]; recent: NcVaultRow[] }
let existing: Set<string>
let opened: string[]
let cleaned: number
let nc: NcVaults

beforeEach(() => {
  storage = useMemStorage()
  tokenSeq = 0
  session = fakeSession()
  rows = { own: [ROW], recent: [SHARED, ROW] }
  existing = new Set()
  opened = []
  cleaned = 0
  api = {
    me: vi.fn(),
    vaults: vi.fn(async () => rows),
    enrol: vi.fn(async (fileId: number) => {
      const row = { ...ROW, id: '33333333-3333-4333-8333-333333333333', fileId, ownerPath: 'New', room: 'room-3' }
      rows = { ...rows, own: [...rows.own, row] }
      return row
    }),
    grant: vi.fn(async (target: { vaultId: string } | { fileId: number }) => {
      const all = [...rows.own, ...rows.recent]
      const row = 'vaultId' in target ? all.find((r) => r.id === target.vaultId) : all.find((r) => r.fileId === target.fileId)
      if (!row) throw new NcApiError(404, 'not found')
      return grantFor(row)
    }),
    status: vi.fn(),
    resolveHold: vi.fn(),
    remove: vi.fn(async (vaultId: string) => {
      rows = { own: rows.own.filter((r) => r.id !== vaultId), recent: rows.recent.filter((r) => r.id !== vaultId) }
    }),
  }
  nc = createNcVaults({
    api,
    session,
    storeExists: async (room) => existing.has(room),
    openNote: (path) => opened.push(path),
    cleanUrl: () => cleaned++,
    relayUrl: 'ws://nc.test/exapps/ohhi/ws',
  })
})

afterEach(() => dropStorage())

describe('createNcVaults', () => {
  it('lists own vaults, and recent ones not already listed as yours', async () => {
    await nc.load()
    expect(nc.loading).toBe(false)
    expect(nc.own.map((r) => r.id)).toEqual([ROW.id])
    expect(nc.recent.map((r) => r.id)).toEqual([SHARED.id])
  })

  it('a failed list is said, not thrown', async () => {
    vi.mocked(api.vaults).mockRejectedValueOnce(new NcApiError(500, 'boom'))
    await nc.load()
    expect(nc.listError).toBeTruthy()
    expect(nc.loading).toBe(false)
  })

  it('opens a vault as a join of its room, the token in memory only', async () => {
    await nc.load()
    await nc.open(ROW)
    expect(api.grant).toHaveBeenCalledWith({ vaultId: ROW.id })
    const entry = session.booted[0]!
    expect(entry).toMatchObject({
      name: 'Notes',
      vault: { kind: 'opfs', id: 'room-1' },
      room: 'room-1',
      firstJoin: true,
      relay: { url: 'ws://nc.test/exapps/ohhi/ws', token: 'tok-1' },
    })
    expect(session.joining?.kind).toBe('folder')
    // Never registered: nothing in localStorage carries the token.
    expect(listVaults()).toEqual([])
    for (const k of storage.keys()) expect(storage.getItem(k)).not.toContain('tok-')
    expect(nc.current).toEqual({ vaultId: ROW.id, room: 'room-1', name: 'Notes', readOnly: false })
  })

  it('fetches a fresh token on reconnect once the last one is near expiry', async () => {
    await nc.open(ROW)
    const relay = session.booted[0]!.relay as { refreshToken?: () => Promise<string> }
    expect(typeof relay.refreshToken).toBe('function')
    // grantFor() answers expiresAt 0: already inside the reuse margin.
    expect(await relay.refreshToken!()).toBe('tok-2')
    expect(await relay.refreshToken!()).toBe('tok-3')
    expect(api.grant).toHaveBeenLastCalledWith({ vaultId: ROW.id })
  })

  it('one grant per vault: a reconnect of 1,000 docs costs one POST /api/session (nextcloud-build R1 #3)', async () => {
    let t = 1_000_000
    const TTL = 10 * 60_000
    vi.mocked(api.grant).mockImplementation(async () => ({ ...grantFor(ROW), expiresAt: t + TTL }))
    nc = createNcVaults({
      api,
      session,
      storeExists: async () => false,
      openNote: () => {},
      cleanUrl: () => {},
      relayUrl: 'ws://nc.test/exapps/ohhi/ws',
      now: () => t,
    })
    await nc.open(ROW)
    expect(api.grant).toHaveBeenCalledTimes(1)
    const relay = session.booted[0]!.relay as unknown as { refreshToken: () => Promise<string> }
    // The open's own grant is reused while it has more than a minute left.
    const first = await Promise.all(Array.from({ length: 1_000 }, () => relay.refreshToken()))
    expect(new Set(first)).toEqual(new Set(['tok-1']))
    expect(api.grant).toHaveBeenCalledTimes(1)
    // A minute before expiry: the next burst shares ONE request in flight.
    t += TTL - 60_000
    const second = await Promise.all(Array.from({ length: 1_000 }, () => relay.refreshToken()))
    expect(new Set(second)).toEqual(new Set(['tok-2']))
    expect(api.grant).toHaveBeenCalledTimes(2)
    // A refused request is not kept: the next reconnect asks again.
    t += TTL
    vi.mocked(api.grant).mockRejectedValueOnce(new NcApiError(0, 'offline'))
    await expect(relay.refreshToken()).rejects.toBeInstanceOf(NcApiError)
    expect(await relay.refreshToken()).toBe('tok-3')
    expect(api.grant).toHaveBeenCalledTimes(4)
  })

  it('reopens without a pull when the room’s stores are already on this device', async () => {
    existing.add('room-1')
    await nc.open(ROW)
    expect(session.booted[0]!.firstJoin).toBe(false)
    expect(session.joining).toBeNull()
  })

  it('a refused session lands on the manager in words', async () => {
    vi.mocked(api.grant).mockRejectedValueOnce(new NcApiError(403, 'forbidden'))
    await nc.open(SHARED)
    expect(session.booted).toEqual([])
    expect(session.failure?.message).toBeTruthy()
    expect(session.busy).toBe(false)
  })

  it('Open a folder from Files enrols by file id, then opens the new vault', async () => {
    await nc.load()
    await nc.enrolAndOpen(99)
    expect(api.enrol).toHaveBeenCalledWith(99)
    expect(session.booted[0]!.room).toBe('room-3')
    expect(nc.own.map((r) => r.fileId)).toContain(99)
  })

  it('a Files-menu folder already known opens at once and selects ?open=', async () => {
    await nc.load()
    await nc.launch({ fileId: 77, open: 'Plans/q4.md' })
    expect(nc.confirmFileId).toBeNull()
    expect(session.booted[0]!.room).toBe('room-2')
    expect(opened).toEqual(['Plans/q4.md'])
    expect(cleaned).toBe(1)
    expect(nc.current?.readOnly).toBe(true)
  })

  it('an unknown Files-menu folder asks once, then opens through POST /api/session {fileId}', async () => {
    await nc.load()
    await nc.launch({ fileId: 500, open: null })
    expect(nc.confirmFileId).toBe(500)
    expect(session.booted).toEqual([])
    // The server enrols on the session call; the list re-read names it.
    vi.mocked(api.grant).mockImplementationOnce(async () => {
      const row = { ...ROW, id: '44444444-4444-4444-8444-444444444444', fileId: 500, ownerPath: 'Fresh', room: 'room-5' }
      rows = { ...rows, own: [...rows.own, row] }
      return grantFor(row)
    })
    await nc.confirmEnrol()
    expect(api.grant).toHaveBeenCalledWith({ fileId: 500 })
    expect(session.booted[0]!).toMatchObject({ name: 'Fresh', room: 'room-5' })
  })

  it('a read-only grant opens every editor read-only (the entry carries it), and a re-grant flips it live', async () => {
    await nc.load()
    await nc.open(ROW)
    expect(session.booted[0]!.readOnly).toBeUndefined()
    await nc.open(SHARED)
    expect(session.booted[1]!.readOnly).toBe(true)
    expect(session.workspace!.ui.readOnly).toBe(true)
    // The share widened: the reconnect's fresh grant is writable, and the open vault follows it.
    vi.mocked(api.grant).mockImplementationOnce(async () => ({ ...grantFor(SHARED), readOnly: false }))
    const relay = session.booted[1]!.relay as unknown as { refreshToken: () => Promise<string> }
    await relay.refreshToken()
    expect(nc.current?.readOnly).toBe(false)
    expect(session.workspace!.ui.readOnly).toBe(false)
  })

  it('Remove from Oh Hi asks first, unenrols, re-reads the list and closes the vault if it is open', async () => {
    await nc.load()
    await nc.open(ROW)
    nc.askRemove(ROW)
    expect(nc.confirmRemove).toEqual(ROW)
    nc.cancelRemove()
    expect(nc.confirmRemove).toBeNull()
    expect(api.remove).not.toHaveBeenCalled()

    nc.askRemove(ROW)
    await nc.confirmRemoval()
    expect(api.remove).toHaveBeenCalledWith(ROW.id)
    expect(nc.own).toEqual([])
    expect(nc.current).toBeNull()
    expect(session.closed).toBe(1)

    vi.mocked(api.remove).mockRejectedValueOnce(new NcApiError(403, 'forbidden', 'not-owner'))
    nc.askRemove(SHARED)
    await nc.confirmRemoval()
    expect(nc.removeError).toBeTruthy()
    expect(session.closed).toBe(1)
  })

  it('cancelling the confirm opens nothing', async () => {
    await nc.load()
    await nc.launch({ fileId: 500, open: 'x.md' })
    nc.cancelEnrol()
    expect(nc.confirmFileId).toBeNull()
    expect(session.booted).toEqual([])
  })
})

describe('helpers', () => {
  it('names a vault after its folder', () => {
    expect(vaultName({ ownerPath: 'Documents/Notes/' })).toBe('Notes')
    expect(vaultName({ ownerPath: '' })).toBeTruthy()
  })
})
