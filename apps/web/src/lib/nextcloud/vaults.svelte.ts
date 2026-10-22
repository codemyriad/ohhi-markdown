/**
 * The Nextcloud host's vault list and open flow (nextcloud-build decisions
 * 2–4): what `NextcloudVaults.svelte` shows instead of the standard manager.
 *
 * There is no new vault kind and no pasted link: opening a vault is the
 * manager's JOIN path (`joinTargetEntry`, an OPFS peer of the vault's room)
 * with a target the server grants — `POST /api/session` → a short-lived,
 * user-bound token. The token lives in memory only: the entry is booted, never
 * registered (`upsertVault` would write it into `localStorage`), and a
 * reconnect asks for one through `RelayConfig.refreshToken` — ONE grant per
 * vault, shared by every doc's provider until a minute before it expires, so
 * a reconnect of a thousand docs costs one `POST /api/session`, not a
 * thousand (nextcloud-build R1 #3).
 */
import { getLL } from '@ohhi/i18n'
import type { RelayConfig } from '@ohhi/workspace'
import { joinTargetEntry } from '../manager.svelte.js'
import type { Session } from '../session.svelte.js'
import { ncErrorText, type NcApi, type NcSessionGrant, type NcVaultRow } from './api.js'
import type { NcLaunch } from './host-boot.js'

/** What the controller needs from the shell. */
export interface NcVaultsHost {
  api: NcApi
  session: Session
  /** Whether this room's store namespace already exists on this device (a reopen, not a first join). */
  storeExists(room: string): Promise<boolean>
  /** Select a note in the open vault (`?open=`). */
  openNote(path: string): void
  /** Drop the launch parameters from the address once they were acted on. */
  cleanUrl(): void
  /** Where the browser reaches the relay (`detectHost().relayUrl`: the page's own origin, `/exapps/ohhi/ws`). */
  relayUrl: string
  /** Epoch ms, for the grant cache (`Date.now` by default; tests inject one). */
  now?: () => number
}

/** A cached grant is handed out until this long before it expires; then a fresh one is asked for. */
export const GRANT_REUSE_MARGIN_MS = 60_000

/** The vault open right now, as the server granted it. */
export interface NcOpenVault {
  vaultId: string
  room: string
  name: string
  readOnly: boolean
}

export interface NcVaults {
  readonly own: NcVaultRow[]
  readonly recent: NcVaultRow[]
  /** True until the first list answered (or failed). */
  readonly loading: boolean
  /** The list could not be read, in words. */
  readonly listError: string | null
  /** A Files-menu folder that is not one of this user's vaults yet: the one-line confirm. */
  readonly confirmFileId: number | null
  /** The vault *Remove from Oh Hi* is asking about (the confirm dialog). */
  readonly confirmRemove: NcVaultRow | null
  /** The last removal's failure, in words. */
  readonly removeError: string | null
  readonly current: NcOpenVault | null
  load(): Promise<void>
  open(row: NcVaultRow): Promise<void>
  /** *Open a folder from Files*: enrol the folder (by its file id), then open it. */
  enrolAndOpen(fileId: number): Promise<void>
  /** Act on the launch parameters once (`?fileIds=`, `?open=`). */
  launch(launch: NcLaunch): Promise<void>
  confirmEnrol(): Promise<void>
  cancelEnrol(): void
  /** *Remove from Oh Hi* (owner only): ask first. */
  askRemove(row: NcVaultRow): void
  /** Unenrol the vault asked about; the list is re-read, and an open copy of it is closed. */
  confirmRemoval(): Promise<void>
  cancelRemove(): void
}

/** A vault's name: its folder's last path segment. */
export function vaultName(row: Pick<NcVaultRow, 'ownerPath'> | null | undefined): string {
  const last = row?.ownerPath
    ?.split('/')
    .filter((s) => s.trim() !== '')
    .pop()
  return last || getLL().web.nextcloud.manager.unnamed()
}

export function createNcVaults(host: NcVaultsHost): NcVaults {
  let own = $state.raw<NcVaultRow[]>([])
  let recent = $state.raw<NcVaultRow[]>([])
  let loading = $state(true)
  let listError = $state<string | null>(null)
  let confirmFileId = $state<number | null>(null)
  let confirmRemove = $state.raw<NcVaultRow | null>(null)
  let removeError = $state<string | null>(null)
  let current = $state.raw<NcOpenVault | null>(null)
  /** `?open=` waits here until a vault opens. */
  let pendingNote: string | null = null

  const { api, session } = host
  const now = host.now ?? (() => Date.now())

  /**
   * One grant per vault: the request in flight, or the last answer while it
   * has more than a minute to live. A failed request is not kept.
   */
  const grants = new Map<string, { promise: Promise<NcSessionGrant>; reuseUntil: number }>()
  function remember(grant: NcSessionGrant): void {
    grants.set(grant.vaultId, { promise: Promise.resolve(grant), reuseUntil: grant.expiresAt - GRANT_REUSE_MARGIN_MS })
  }
  function grantFor(vaultId: string): Promise<NcSessionGrant> {
    const hit = grants.get(vaultId)
    if (hit && now() < hit.reuseUntil) return hit.promise
    const promise = api.grant({ vaultId })
    const entry = { promise, reuseUntil: Number.POSITIVE_INFINITY }
    grants.set(vaultId, entry)
    promise.then(
      (g) => {
        if (grants.get(vaultId) === entry) entry.reuseUntil = g.expiresAt - GRANT_REUSE_MARGIN_MS
        noteReadOnly(g)
      },
      () => {
        if (grants.get(vaultId) === entry) grants.delete(vaultId)
      }
    )
    return promise
  }

  async function load(): Promise<void> {
    try {
      const list = await api.vaults()
      own = Array.isArray(list?.own) ? list.own : []
      // A vault you own and opened before is listed once, under yours.
      const ownIds = new Set(own.map((r) => r.id))
      recent = (Array.isArray(list?.recent) ? list.recent : []).filter((r) => !ownIds.has(r.id))
      listError = null
    } catch (err) {
      listError = ncErrorText(err)
    } finally {
      loading = false
    }
  }

  const known = (pred: (r: NcVaultRow) => boolean): NcVaultRow | undefined => own.find(pred) ?? recent.find(pred)

  function fail(err: unknown): void {
    session.failure = { room: null, message: ncErrorText(err) }
    session.busy = false
  }

  /**
   * A fresh grant for the open vault may say read-only where the last said
   * writable (the share was narrowed; the relay closed the socket and the
   * reconnect asked again), or the other way: the editors follow it live.
   */
  function noteReadOnly(g: NcSessionGrant): void {
    const readOnly = g.readOnly === true
    if (current?.vaultId !== g.vaultId || current.readOnly === readOnly) return
    current = { ...current, readOnly }
    const ui = session.workspace?.room === g.room ? session.workspace.ui : null
    if (ui) ui.readOnly = readOnly
  }

  /** Boot the granted room as a join: an OPFS peer, its token in memory only. */
  async function bootGrant(grant: NcSessionGrant, name: string): Promise<void> {
    const vaultId = grant.vaultId
    remember(grant)
    const relay: RelayConfig = {
      url: host.relayUrl,
      token: grant.token,
      refreshToken: () => grantFor(vaultId).then((g) => g.token),
    }
    const firstJoin = !(await host.storeExists(grant.room))
    // A read-only grant opens every editor read-only (libs/editor `readOnly`):
    // nothing is typed that the relay would drop, so nothing waits to be sent.
    const entry = joinTargetEntry({ name, room: grant.room, relay, firstJoin, readOnly: grant.readOnly === true })
    current = { vaultId, room: grant.room, name, readOnly: grant.readOnly === true }
    if (firstJoin) session.joining = { entry, destination: getLL().web.manager.browser_vault(), kind: 'folder' }
    await session.boot(entry)
    if (session.view === 'workspace' && session.workspace?.room === grant.room) {
      const note = pendingNote
      pendingNote = null
      if (note) host.openNote(note)
    }
  }

  async function open(row: NcVaultRow): Promise<void> {
    session.failure = null
    session.busy = true
    let grant: NcSessionGrant
    try {
      grant = await api.grant({ vaultId: row.id })
    } catch (err) {
      fail(err)
      return
    }
    await bootGrant(grant, vaultName(row))
  }

  async function openByFileId(fileId: number): Promise<void> {
    session.failure = null
    session.busy = true
    let grant: NcSessionGrant
    try {
      grant = await api.grant({ fileId })
    } catch (err) {
      fail(err)
      return
    }
    // The grant names the vault; the list (re-read: an enrol just added a row) names its folder.
    await load()
    const row = known((r) => r.id === grant.vaultId)
    await bootGrant(grant, vaultName(row))
  }

  async function enrolAndOpen(fileId: number): Promise<void> {
    session.failure = null
    session.busy = true
    let row: NcVaultRow
    try {
      row = await api.enrol(fileId)
    } catch (err) {
      fail(err)
      return
    }
    await load()
    await open(row)
  }

  async function launch(l: NcLaunch): Promise<void> {
    pendingNote = l.open
    if (l.fileId === null) return
    host.cleanUrl()
    const row = known((r) => r.fileId === l.fileId)
    if (row) await open(row)
    else confirmFileId = l.fileId
  }

  return {
    get own() {
      return own
    },
    get recent() {
      return recent
    },
    get loading() {
      return loading
    },
    get listError() {
      return listError
    },
    get confirmFileId() {
      return confirmFileId
    },
    get current() {
      return current
    },
    get confirmRemove() {
      return confirmRemove
    },
    get removeError() {
      return removeError
    },
    askRemove(row) {
      removeError = null
      confirmRemove = row
    },
    cancelRemove() {
      confirmRemove = null
    },
    async confirmRemoval() {
      const row = confirmRemove
      confirmRemove = null
      if (!row) return
      removeError = null
      try {
        await api.remove(row.id)
      } catch (err) {
        removeError = ncErrorText(err)
        return
      }
      grants.delete(row.id)
      if (current?.vaultId === row.id) {
        // Its room is gone on the server: close the copy here rather than leave a vault that can never sync.
        current = null
        session.close()
      }
      await load()
    },
    load,
    open,
    enrolAndOpen,
    launch,
    async confirmEnrol() {
      const id = confirmFileId
      confirmFileId = null
      if (id !== null) await openByFileId(id)
    },
    cancelEnrol() {
      confirmFileId = null
      pendingNote = null
    },
  }
}
