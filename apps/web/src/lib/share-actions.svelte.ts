/**
 * In-workspace sharing (M4, M5, device-link N1/N2): which share dialog or
 * confirm is open, and what happens when it is answered.
 *
 * The FOLDER is the unit of sharing (dogfood-shaping R3), reached from the
 * tree's context menu. Promoting the whole vault from the UI was removed on
 * 2026-09-07: it made every folder share silently impossible afterwards (the
 * V1 no-nested-shares guard, spike S8 "The mount model") with no visible
 * rule. Vaults that are ALREADY root-shared — joined from a whole-vault link,
 * or relay-attached by the memory URL contract — still boot, sync and read
 * "shared"; they simply have no share-management UI, and the tree says why
 * their folders cannot be shared.
 *
 * The shim (`workspace.svelte.ts`) does the carving, mounting and moving;
 * this layer owns the dialogs' state, the registry side-effects (remembered
 * shares, room tokens) and the confirm-first rule for anything that changes
 * who can see content (spike S8 Q5). The components under `components/`
 * render it and nothing else.
 */
import { getLL } from '@ohhi/i18n'
import { relayHost } from '@ohhi/workspace'
import { addShare, getVault, removeShare, setRoomToken } from './config.js'
import { ShareLinkError } from './share-link.js'
import type { MountInfo, Workspace } from './workspace.svelte.js'

/** What sharing needs from the rest of the shell. */
export interface ShareHost {
  /** The open vault, or null between vaults. Read reactively — a getter, not a value. */
  workspace(): Workspace | null
  /** The registry changed (a share remembered or forgotten): re-read what the manager and settings show. */
  refresh(): void
  /** A folder is leaving the vault: its tabs go with it, now (B6). */
  closeUnder(path: string): void
  /**
   * Revoke every token the room's relay holds for it — the unshare checkbox
   * (needs the operator secret). `relay` is the ROOM's (`MountInfo.relay`),
   * never the current default: after a relay change in Settings the links
   * still live where the room was minted.
   */
  revokeRoom(room: string, relay: string): Promise<void>
}

export interface ShareActions {
  // ---- folder share (M4) ----
  /** Folder being shared/managed via the tree's share action, else null. */
  folderSharePath: string | null
  readonly folderShareMount: MountInfo | null
  /** Carve the folder into its own room; answers with the link. */
  carveFolderShare(): Promise<string>
  /** Mint a device link and promote the root mount (device-link N2, A1). */
  createDeviceLink(label: string): Promise<string>
  /** Bumped when a share dialog closes so the note section refetches its access list. */
  readonly revision: number
  /** A share dialog closed: whatever lists access should look again. */
  touch(): void

  // ---- add-share, add-link (M5, N1) ----
  /** Join-a-share dialog, with the folder it was asked from ('' = vault root). */
  addShareOpen: { dir: string } | null
  /** Add-link dialog for a `needs-token` mount: the mount is already here, only its key is missing. */
  addLinkPath: string | null
  readonly addLinkMount: MountInfo | null
  /** Activate a needs-token mount in place. Rethrows so the dialog keeps the paste. */
  addMountLink(path: string, link: string): Promise<void>

  // ---- the three confirms ----
  unshareConfirm: { path: string; provenance: string } | null
  unmountConfirm: string | null
  moveConfirm: { from: string; to: string; leavingShared: boolean } | null
  askUnshare(path: string): void
  askUnmount(path: string): void
  confirmUnshare(revokeTokens: boolean): Promise<void>
  confirmUnmount(): Promise<void>
  confirmCrossMove(): Promise<void>
  /**
   * Move `from` to `to`, asking first when it crosses a share boundary —
   * that changes who can see the content, so it is never silent (spike S8 Q5).
   */
  move(from: string, to: string): Promise<void>
}

export function createShareActions(host: ShareHost): ShareActions {
  let folderSharePath = $state<string | null>(null)
  let revision = $state(0)
  let addShareOpen = $state<{ dir: string } | null>(null)
  let addLinkPath = $state<string | null>(null)
  let unshareConfirm = $state<{ path: string; provenance: string } | null>(null)
  let unmountConfirm = $state<string | null>(null)
  let moveConfirm = $state<{ from: string; to: string; leavingShared: boolean } | null>(null)

  const mountAt = (path: string | null): MountInfo | null => {
    const ws = host.workspace()
    return path && ws ? (ws.ui.mounts.find((m) => m.path === path) ?? null) : null
  }
  const folderShareMount = $derived(mountAt(folderSharePath))
  const addLinkMount = $derived(mountAt(addLinkPath))

  const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

  async function carveFolderShare(): Promise<string> {
    const ws = host.workspace()
    if (!ws || !folderSharePath) throw new Error('no folder selected')
    const path = folderSharePath
    const link = await ws.carveFolder(path)
    const room = ws.ui.mounts.find((m) => m.path === path)?.room
    if (room) {
      addShare({ link, room, label: `${getVault(ws.room)?.name ?? 'vault'}/${path}` })
    }
    host.refresh()
    return link
  }

  /**
   * The shim does the work; this only refreshes what the manager and settings
   * show, because a linked vault now carries a relay in its registry entry.
   */
  async function createDeviceLink(label: string): Promise<string> {
    const ws = host.workspace()
    if (!ws) throw new Error(getLL().web.device_link.needs_vault())
    const link = await ws.linkDevice(label)
    host.refresh()
    revision++
    return link
  }

  /**
   * The failure is logged (so it is in the Log view, like every other workspace
   * error, chrome U5) and rethrown so the dialog keeps the paste and shows the
   * reason where the user is looking. It does not ALSO toast: its code,
   * `add_link_failed`, is marked as shown by its own surface (spike S22 Q3).
   */
  async function addMountLink(path: string, link: string): Promise<void> {
    const ws = host.workspace()
    if (!ws) return
    try {
      await ws.addMountLink(path, link)
      host.refresh()
    } catch (err) {
      const room = ws.ui.mounts.find((m) => m.path === path)?.room
      ws.notify({
        level: 'error',
        code: 'add_link_failed',
        params: err instanceof ShareLinkError ? { link_error: err.code } : { message: message(err) },
        path,
        mount: path,
        ...(room ? { room } : {}),
      })
      throw err
    }
  }

  async function confirmUnshare(revokeTokens: boolean): Promise<void> {
    const target = unshareConfirm
    unshareConfirm = null
    const ws = host.workspace()
    if (!target || !ws) return
    const mount = ws.ui.mounts.find((m) => m.path === target.path)
    const room = mount?.room
    try {
      await ws.unshare(target.path)
      if (room) {
        removeShare(room)
        setRoomToken(room, '')
      }
      host.refresh()
    } catch (err) {
      ws.notify({
        level: 'error',
        code: 'unshare_failed',
        params: { message: message(err) },
        path: target.path,
        mount: target.path,
        ...(room ? { room } : {}),
      })
      return
    }
    // The folder IS unshared now; a revoke that fails says so on its own,
    // never as "unshare failed".
    if (!revokeTokens || !room || !mount) return
    try {
      await host.revokeRoom(room, mount.relay)
    } catch (err) {
      ws.notify({
        level: 'error',
        code: 'revoke_failed',
        params: { host: relayHost(mount.relay) ?? mount.relay, message: message(err) },
        path: target.path,
        mount: target.path,
        room,
      })
    }
  }

  async function confirmUnmount(): Promise<void> {
    const path = unmountConfirm
    unmountConfirm = null
    const ws = host.workspace()
    if (!path || !ws) return
    // The folder leaves the vault: its tabs go with it, now rather than when
    // the file list settles (B6).
    host.closeUnder(path)
    const room = ws.ui.mounts.find((m) => m.path === path)?.room
    try {
      await ws.unmount(path)
      if (room) {
        removeShare(room)
        setRoomToken(room, '')
      }
      host.refresh()
    } catch (err) {
      ws.notify({
        level: 'error',
        code: 'unmount_failed',
        params: { message: message(err) },
        path,
        mount: path,
        ...(room ? { room } : {}),
      })
    }
  }

  async function confirmCrossMove(): Promise<void> {
    const mv = moveConfirm
    moveConfirm = null
    const ws = host.workspace()
    if (!mv || !ws) return
    try {
      await ws.movePath(mv.from, mv.to)
    } catch (err) {
      ws.notify({ level: 'error', code: 'move_failed', params: { message: message(err) }, path: mv.from })
    }
  }

  async function move(from: string, to: string): Promise<void> {
    const ws = host.workspace()
    if (!ws) return
    if (ws.isCrossMount(from, to)) {
      const leavingShared = ws.ui.mounts.some((m) => from === m.path || from.startsWith(`${m.path}/`))
      moveConfirm = { from, to, leavingShared }
    } else {
      await ws.movePath(from, to)
    }
  }

  return {
    get folderSharePath() {
      return folderSharePath
    },
    set folderSharePath(next) {
      folderSharePath = next
    },
    get folderShareMount() {
      return folderShareMount
    },
    carveFolderShare,
    createDeviceLink,
    get revision() {
      return revision
    },
    touch: () => {
      revision++
    },
    get addShareOpen() {
      return addShareOpen
    },
    set addShareOpen(next) {
      addShareOpen = next
    },
    get addLinkPath() {
      return addLinkPath
    },
    set addLinkPath(next) {
      addLinkPath = next
    },
    get addLinkMount() {
      return addLinkMount
    },
    addMountLink,
    get unshareConfirm() {
      return unshareConfirm
    },
    set unshareConfirm(next) {
      unshareConfirm = next
    },
    get unmountConfirm() {
      return unmountConfirm
    },
    set unmountConfirm(next) {
      unmountConfirm = next
    },
    get moveConfirm() {
      return moveConfirm
    },
    set moveConfirm(next) {
      moveConfirm = next
    },
    askUnshare: (path) => {
      const provenance = mountAt(path)?.provenance ?? 'carved'
      unshareConfirm = { path, provenance }
    },
    askUnmount: (path) => {
      unmountConfirm = path
    },
    confirmUnshare,
    confirmUnmount,
    confirmCrossMove,
    move,
  }
}
