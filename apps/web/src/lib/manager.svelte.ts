/**
 * The vault manager's controller: the registry as the manager shows it, and
 * the four ways a vault gets into it — open a folder, create a browser vault,
 * join a share, link this device — plus the one way out, and the way back in
 * for a desktop vault whose folder access was lost (DEL-89).
 *
 * Every path ends in `session.boot(entry)`; what this module adds is the
 * registry write, the URL clean-up and the manager's own error rendering
 * (`session.failure`). The platform pieces it needs — the folder picker,
 * the "is this folder empty" check, the store wipe — arrive through
 * `ManagerHost`, so a test can drive a join without a Tauri window.
 */
import { getLL } from '@ohhi/i18n'
import { relayHost } from '@ohhi/workspace'
import {
  addShare,
  defaultRelay,
  deriveVaultName,
  getVault,
  listVaults,
  loadShares,
  loadUser,
  mergeGrants,
  operatorSecret,
  purgeRooms,
  relayKnown,
  removeShare,
  removeVault as removeVaultEntry,
  saveUser,
  setDefaultRelay,
  setOperatorSecret,
  setRoomToken,
  upsertVault,
  type StoredShare,
  type VaultEntry,
  type VaultSourceDesc,
} from './config.js'
import { newFolderGuid } from './boot.js'
import { samePath } from './fs-access.js'
import type { Session } from './session.svelte.js'
import { decodeShareLink, folderNameOfLabel, shareLinkErrorText } from './share-link.js'
import { OHHI_HOST_MARKER, parseHostMarker, type MountDesc, type VaultAdapter } from '@ohhi/vault'
import type { RelayConfig } from '@ohhi/workspace'
import { readVaultFacts, type VaultFacts } from './vault-facts.js'

/** What the manager needs from the platform. */
export interface ManagerHost {
  isTauri(): boolean
  /**
   * The Tauri app on a phone (docs/mobile-android.md): no folder picker, so
   * a joined or linked vault lives in the webview's storage, as in a
   * browser. Absent → false.
   */
  isMobile?(): boolean
  /**
   * The native folder picker; null when cancelled. On desktop the folder the
   * user picks is what the webview may read and write (DEL-89).
   */
  pickFolder(defaultPath?: string): Promise<string | null>
  /** Empty AS THE VAULT ADAPTER SEES IT — `.git` and `.obsidian` do not count. */
  folderIsEmpty(path: string): Promise<boolean>
  /** Wipe a vault's durable stores; answers with the rooms whose config residue to purge. */
  forgetVaultState(entry: VaultEntry): Promise<string[]>
  /** Drop bootstrap query params after onboarding (R5). */
  cleanUrl(): void
  /** A device link was accepted: the paste dialog can close. */
  onDeviceLinked(): void
  /**
   * Read a vault's mount table (`vault-facts.readMountTable`) for the row
   * facts (first-run B1). Absent → no facts: every row says "—".
   */
  readMounts?(entry: VaultEntry): Promise<MountDesc[]>
  /**
   * The vault adapter over a picked desktop folder, for the host-marker check
   * (nextcloud-build decision 13). Absent → no check (a browser host).
   */
  adapterFor?(path: string): Promise<VaultAdapter>
}

/**
 * The room named by a folder's Nextcloud host marker (`ohhi-host.md` at its
 * root, decision 13), '' for a marker without one, null when there is no
 * marker. Read with `adapter.read`, which — unlike `list` — does not filter
 * the reserved name.
 */
export async function hostMarkerRoom(adapter: Pick<VaultAdapter, 'read'>): Promise<string | null> {
  const bytes = await adapter.read(OHHI_HOST_MARKER)
  return bytes === null ? null : (parseHostMarker(bytes)?.room ?? '')
}

/**
 * A browser vault that joins a room (the join path's shape): an OPFS peer
 * keyed by the room, connected to `relay`. The share-link join and the
 * Nextcloud host's server-granted open (`nextcloud/vaults.svelte.ts`) both
 * build their entry here.
 */
export function joinTargetEntry(target: {
  name: string
  room: string
  relay: RelayConfig
  firstJoin: boolean
  /** A host's read-only grant (Nextcloud): every editor of the vault opens read-only. */
  readOnly?: boolean
}): VaultEntry {
  return {
    name: target.name,
    vault: { kind: 'opfs', id: target.room },
    room: target.room,
    relay: target.relay,
    firstJoin: target.firstJoin,
    ...(target.readOnly === true ? { readOnly: true } : {}),
  }
}

export interface Manager {
  readonly vaults: VaultEntry[]
  readonly shares: StoredShare[]
  readonly relayDefault: string
  /** A relay saved in Settings or given by the build — not the dev fallback (`config.relayKnown`). */
  readonly relayKnown: boolean
  readonly opSecret: string
  /** The name shown to people you share with ('' = never set; peers see "Anonymous"). */
  readonly user: string
  /**
   * Row facts per room, as far as each vault's mount table could be read
   * (`null` = unreadable, absent = not read yet). The open vault's are the
   * workspace's live ones — the manager screen prefers those.
   */
  readonly facts: Readonly<Record<string, VaultFacts | null>>
  /** Re-read every registered vault's mount table except `skipRoom`'s (the open one). */
  loadFacts(skipRoom?: string | null): Promise<void>
  /** Re-read the registry after anything wrote to it. */
  refresh(): void
  /** Rename a vault IN THIS LIST: the registry entry's name, never the folder. */
  renameVault(room: string, name: string): void
  /**
   * The share sheet's first run (sharing E4, R4): remember the relay and the
   * operator secret in Settings › Sync. The relay is stored only when it
   * differs from the one shown, as Settings does — saving just the secret
   * must never pin this build's default.
   */
  rememberRelay(relay: string, secret: string): void
  openFolder(name: string): Promise<void>
  createBrowserVault(name: string, vaultName: string): Promise<void>
  /**
   * Open a folder share as its own vault. Resolves with the failure's words
   * (also on `session.failure`, for the manager screen) or null — so a dialog
   * opened from INSIDE a workspace, where the manager is not on screen, can
   * show why it did not happen.
   */
  joinShare(name: string, link: string): Promise<string | null>
  /**
   * `joinShare` for a dialog that must tell a cancelled desktop folder
   * picker (nothing happened: keep the paste) from a failure (say why) and
   * from a join that went ahead.
   */
  join(name: string, link: string): Promise<JoinOutcome>
  /** Rejects with the reason — the dialog keeps the paste and shows it. */
  linkThisDevice(link: string): Promise<void>
  removeVault(room: string): Promise<void>
  /** Forget a remembered share link on this device (settings-shaping Fork 3: moved here from Settings). */
  forgetShare(room: string): void
  /**
   * A desktop vault refused by the fs scope (`failure.access`): reopen the
   * picker on its folder. Only that same folder is accepted; anything else is
   * said and leaves the vault as it was. A cancel changes nothing.
   */
  allowAccessAgain(room: string): Promise<void>
  /** What the progress panel calls the place a vault is being written. */
  destinationOf(vault: VaultSourceDesc): string
}

/** How a join from the manager ended: it went ahead, the folder picker was cancelled, or it failed. */
export type JoinOutcome = { kind: 'started' } | { kind: 'cancelled' } | { kind: 'failed'; message: string }

export function createManager(session: Session, host: ManagerHost): Manager {
  let vaults = $state(listVaults())
  let shares = $state(loadShares())
  let relayDefault = $state(defaultRelay())
  let isRelayKnown = $state(relayKnown())
  let opSecret = $state(operatorSecret())
  let user = $state(loadUser() ?? '')
  let facts = $state<Record<string, VaultFacts | null>>({})

  /** The desktop app: a joined or linked vault goes into a folder the user picks. */
  const foldersOnDisk = (): boolean => host.isTauri() && !host.isMobile?.()

  function refresh(): void {
    vaults = listVaults()
    shares = loadShares()
    relayDefault = defaultRelay()
    isRelayKnown = relayKnown()
    opSecret = operatorSecret()
    user = loadUser() ?? ''
  }

  async function loadFacts(skipRoom: string | null = null): Promise<void> {
    const read = host.readMounts
    if (!read) return
    const entries = listVaults().filter((v) => v.room !== skipRoom)
    const pairs = await Promise.all(entries.map(async (e) => [e.room, await readVaultFacts(e, read)] as const))
    // Rows removed while the reads were in flight are not brought back.
    const known = new Set(listVaults().map((v) => v.room))
    facts = Object.fromEntries(pairs.filter(([room]) => known.has(room)))
  }

  function renameVault(room: string, name: string): void {
    const entry = getVault(room)
    const trimmed = name.trim()
    if (!entry || !trimmed) return
    upsertVault({ ...entry, name: trimmed })
    refresh()
  }

  function rememberRelay(relay: string, secret: string): void {
    if (relay.trim() !== defaultRelay()) setDefaultRelay(relay)
    setOperatorSecret(secret)
    refresh()
  }

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  function destinationOf(vault: VaultSourceDesc): string {
    return vault.kind === 'tauri' ? vault.path : getLL().web.manager.browser_vault()
  }

  /**
   * A desktop folder held by Oh Hi in Nextcloud is refused (decision 13): its
   * custodian is the writer there, and a second CRDT here would duplicate
   * every edit. Resolves with the refusal's words, or null to go ahead.
   */
  async function refuseMarked(path: string): Promise<string | null> {
    if (!host.adapterFor) return null
    const room = await hostMarkerRoom(await host.adapterFor(path))
    if (room === null) return null
    return getLL().web.nextcloud.host.marked_folder({ room: room || '?' })
  }

  async function openFolder(name: string): Promise<void> {
    saveUser(name)
    session.failure = null
    session.busy = true
    try {
      const path = await host.pickFolder()
      if (!path) {
        session.busy = false
        return
      }
      const refused = await refuseMarked(path)
      if (refused) {
        session.failure = { room: null, message: refused }
        session.busy = false
        return
      }
      // Reopening a known folder resumes its entry (same room/stores) instead
      // of minting a second identity for the same bytes.
      const existing = listVaults().find((v) => v.vault.kind === 'tauri' && v.vault.path === path)
      const entry: VaultEntry = existing ?? {
        name: deriveVaultName({ kind: 'tauri', path }),
        vault: { kind: 'tauri', path },
        room: newFolderGuid(),
      }
      upsertVault(entry)
      refresh()
      host.cleanUrl()
      await session.boot(entry)
    } catch (err) {
      session.failure = { room: null, message: message(err) }
      session.busy = false
    }
  }

  async function createBrowserVault(name: string, vaultName: string): Promise<void> {
    saveUser(name)
    session.failure = null
    const entry: VaultEntry = {
      name: vaultName,
      vault: { kind: 'opfs', id: crypto.randomUUID() },
      room: newFolderGuid(),
    }
    upsertVault(entry)
    refresh()
    host.cleanUrl()
    await session.boot(entry)
  }

  async function joinShare(name: string, link: string): Promise<string | null> {
    await joinShareInto(name, link)
    return session.failure?.message ?? null
  }

  async function join(name: string, link: string): Promise<JoinOutcome> {
    const outcome = await joinShareInto(name, link)
    if (outcome === 'cancelled') return { kind: 'cancelled' }
    const failure = session.failure?.message
    return failure ? { kind: 'failed', message: failure } : { kind: 'started' }
  }

  /**
   * A browser vault opened from a folder share is named after the folder
   * (first-run F1): the link's label when it carries one — the sharer's path,
   * so its last segment — else the relay's host, never a literal "Shared
   * vault" that every such vault would share.
   */
  function joinedVaultName(target: { relay: string; label?: string | undefined }): string {
    const folder = folderNameOfLabel(target.label)
    if (folder) return folder
    return getLL().web.manager.joined_vault_name({ host: relayHost(target.relay) ?? target.relay })
  }

  /** 'cancelled' = the desktop folder picker was closed: nothing happened. */
  async function joinShareInto(name: string, link: string): Promise<'done' | 'cancelled'> {
    saveUser(name)
    session.failure = null
    session.busy = true
    let target: ReturnType<typeof decodeShareLink>
    try {
      target = decodeShareLink(link)
    } catch (err) {
      // The codec throws a code; the manager is a rendering site, so it says
      // WHICH way the link is unusable rather than "invalid link".
      session.failure = { room: null, message: shareLinkErrorText(err) }
      session.busy = false
      return 'done'
    }
    // A device link pasted here is not a folder share — it is this vault, and
    // it wants the device path (grants merged before boot, the destination
    // checked, the token stored as a device key).
    if (target.kind === 'device') {
      try {
        if (!(await linkDevice(link))) {
          session.busy = false
          return 'cancelled'
        }
      } catch (err) {
        session.failure = { room: null, message: shareLinkErrorText(err) }
        session.busy = false
      }
      return 'done'
    }
    try {
      let entry: VaultEntry
      if (foldersOnDisk()) {
        const path = await host.pickFolder()
        if (!path) {
          session.busy = false
          return 'cancelled'
        }
        const refused = await refuseMarked(path)
        if (refused) {
          session.failure = { room: null, message: refused }
          session.busy = false
          return 'done'
        }
        entry = {
          name: deriveVaultName({ kind: 'tauri', path }),
          vault: { kind: 'tauri', path },
          room: target.room,
          relay: { url: target.relay, token: target.token },
          firstJoin: true,
        }
      } else {
        entry = joinTargetEntry({
          name: joinedVaultName(target),
          room: target.room,
          relay: { url: target.relay, token: target.token },
          firstJoin: true,
        })
      }
      upsertVault(entry)
      // The root's token is a FOLDER share's: what tells the shell, on every
      // later open, that this vault is a share someone opened as a vault —
      // "Shared with you", never "on your devices" (`rootShareKind`).
      setRoomToken(target.room, target.token, target.relay, 'folder')
      // Label the remembered share by the vault it opens as — not the joiner's
      // own name (the "Recent shares show my name" bug).
      addShare({ link, room: target.room, label: entry.name })
      refresh()
      host.cleanUrl()
      // A whole-vault pull gets the panel too: it is the same minute of
      // waiting whichever affordance started it.
      session.joining = { entry, destination: destinationOf(entry.vault), kind: 'folder' }
      await session.boot(entry)
    } catch (err) {
      session.failure = { room: null, message: message(err) }
      session.busy = false
    }
    return 'done'
  }

  /**
   * Link THIS device (device-link-shaping A1/A4-B, slice N2): the whole vault
   * arrives here from the master copy.
   *
   * Order matters: the link's grants are merged BEFORE the boot, so the root's
   * firstJoin pull and every adopt that follows find their tokens already in
   * place rather than flashing `needs-token` and repairing themselves
   * (spike S10 Q7).
   */
  async function linkThisDevice(link: string): Promise<void> {
    await linkDevice(link)
  }

  /** `linkThisDevice`, resolving false when the desktop folder picker was cancelled. */
  async function linkDevice(link: string): Promise<boolean> {
    const t = getLL().web.device_link
    const target = decodeShareLink(link)
    if (target.kind !== 'device') throw new Error(t.join_not_device())
    const existing = getVault(target.room)
    if (existing) throw new Error(t.already_linked({ name: existing.name }))
    let vault: VaultSourceDesc
    if (foldersOnDisk()) {
      const path = await host.pickFolder()
      if (!path) return false // the picker was cancelled; nothing has happened yet
      if (!(await host.folderIsEmpty(path))) throw new Error(t.not_empty({ path }))
      vault = { kind: 'tauri', path }
    } else {
      // A fresh private vault, not one keyed by the room: linking twice into
      // the same browser must not land in a half-written directory.
      vault = { kind: 'opfs', id: crypto.randomUUID() }
    }
    if (target.grants.length > 0) mergeGrants(target.grants)
    setRoomToken(target.room, target.token, target.relay, 'device')
    const entry: VaultEntry = {
      name: deriveVaultName(vault),
      vault,
      room: target.room,
      relay: { url: target.relay, token: target.token },
      firstJoin: true,
    }
    upsertVault(entry)
    refresh()
    host.cleanUrl()
    host.onDeviceLinked()
    session.joining = { entry, destination: destinationOf(vault), kind: 'device' }
    await session.boot(entry)
    return true
  }

  async function removeVault(room: string): Promise<void> {
    const entry = getVault(room)
    // Removing the vault that is OPEN right now: dispose the workspace first
    // so its debounced flushes can't write into a half-wiped namespace. Any
    // flush already in flight may still land after the wipe — the remnant is
    // inert, since a reopen mints a new room and never reads the old one.
    if (session.workspace?.room === room) session.close()
    // Config entry goes first and unconditionally (never strand the registry
    // on a store-wipe failure — leftover stores are inert for the same
    // new-room reason).
    removeVaultEntry(room)
    if (session.failure?.room === room) session.failure = null
    refresh()
    if (entry) {
      try {
        purgeRooms(await host.forgetVaultState(entry))
      } catch (err) {
        session.failure = {
          room: null,
          message: getLL().web.manager.errors.forget_partial({ message: message(err) }),
        }
      }
      refresh()
    }
  }

  async function allowAccessAgain(room: string): Promise<void> {
    const entry = getVault(room)
    if (!entry || entry.vault.kind !== 'tauri') return
    const saved = entry.vault.path
    session.busy = true
    let picked: string | null
    try {
      picked = await host.pickFolder(saved)
    } catch (err) {
      session.failure = { room, message: message(err), access: true }
      session.busy = false
      return
    }
    if (!picked) {
      session.busy = false
      return
    }
    if (!samePath(picked, saved)) {
      session.failure = {
        room,
        message: getLL().web.manager.access_wrong_folder({ picked, path: saved }),
        access: true,
      }
      session.busy = false
      return
    }
    await session.boot(entry)
  }

  return {
    get vaults() {
      return vaults
    },
    get shares() {
      return shares
    },
    get relayDefault() {
      return relayDefault
    },
    get relayKnown() {
      return isRelayKnown
    },
    get opSecret() {
      return opSecret
    },
    get user() {
      return user
    },
    get facts() {
      return facts
    },
    loadFacts,
    refresh,
    renameVault,
    rememberRelay,
    openFolder,
    createBrowserVault,
    joinShare,
    join,
    linkThisDevice,
    removeVault,
    forgetShare: (room: string) => {
      removeShare(room)
      refresh()
    },
    allowAccessAgain,
    destinationOf,
  }
}
