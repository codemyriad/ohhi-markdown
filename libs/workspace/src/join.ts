/**
 * The join-as-mount state machine (spike S8 Q4, slice M5): attach a shared
 * room as a subtree of an open vault. The V1 "this vault is itself shared"
 * refusal is gone (N1, device-link-shaping A5): the root may be relay-attached,
 * and the destination detach announces the mount to its peers. The status is written to
 * mounts.json FIRST ('joining'), so an interrupted join is recovered at the
 * next boot by rollback (recoverMounts drops the derived namespace and the
 * entry — nothing touches disk under the destination before the mount is
 * 'active'; a crash mid-materialize leaves an 'active' mount whose boot
 * reconcile pass simply finishes writing files). A LIVE failure (auth
 * rejected, sync timeout) runs the same rollback immediately so a retry
 * starts clean.
 *
 * The pull itself is MountSession's firstJoin boot (the same machine every
 * join has used since M1) — the caller supplies `buildSession` so the host
 * keeps ownership of stores/records/events wiring; on success that session
 * has already upserted its desc as 'active'.
 */
import type { MountsFile, StoreDir, VaultAdapter } from '@editor/vault'
import type { MountSession } from './mount-session.js'

export interface JoinMountOptions {
  /** The vault store dir (holds mounts.json + per-room namespaces). */
  vaultDir: StoreDir
  mountsFile: MountsFile
  /**
   * The live root mount (destination parent). May be relay-attached (N1):
   * when it is, the destination detach ALSO announces the mount to the root's
   * peers, so a foreign share joined here follows to this person's other
   * devices (S10 Q7).
   */
  root: MountSession
  /** The UNwrapped vault adapter — destination-emptiness is checked on it. */
  baseAdapter: VaultAdapter
  /** Current mount roots (nesting/overlap guard). */
  existingMountPaths: string[]
  /** Workspace-relative destination dir — absent or empty (spike Q4 guard). */
  mountPath: string
  room: string
  /**
   * The relay carrying the JOINED room — someone else's relay, not this
   * vault's. It rides in the announced mount entry so a peer of the root can
   * tell where the nested share lives; the token never travels (D4).
   */
  relayUrl?: string
  addIgnore: (prefix: string) => void
  removeIgnore: (prefix: string) => void
  /** Builds the mount's MountSession with firstJoin: true (the awaited pull). */
  buildSession: () => Promise<MountSession>
}

export async function joinMount(opts: JoinMountOptions): Promise<MountSession> {
  const path = opts.mountPath
  if (!path) throw new Error('choose a destination folder for the shared content')
  for (const existing of opts.existingMountPaths) {
    if (existing === path || existing.startsWith(`${path}/`) || path.startsWith(`${existing}/`)) {
      throw new Error(`'${path}' overlaps the shared folder '${existing}'`)
    }
  }
  // Destination must be absent or an empty dir: local files must never be
  // adopted into a room they were never part of (spike Q4).
  const pre = `${path}/`
  const files = await opts.baseAdapter.list()
  if (files.some((s) => s.path === path || s.path.startsWith(pre))) {
    throw new Error(`'${path}' is not empty — pick a new or empty folder`)
  }

  await opts.mountsFile.upsert({
    room: opts.room,
    path,
    provenance: 'joined',
    status: 'joining',
  })
  opts.addIgnore(path)
  const announce = opts.root.isShared()
  try {
    // Drop the destination's dir entry (and empty sub-dir entries) from the
    // root map — the subtree belongs to the mount now. If the dir never
    // existed this is a no-op; after a crash the dir on disk re-enrolls via
    // the root's delta scan, so removal here is always safe.
    //
    // Inside a relay-attached root the SAME transaction announces the mount
    // (N1, S10 Q7's "a required N1 change surfaces here"): without it a
    // foreign share is invisible on this person's other devices, and this
    // device's root map holds nothing at `path` while its disk does. The
    // entry's relay is the FOREIGN one.
    await opts.root.detachSubtree(
      path,
      announce ? { room: opts.room, relay: opts.relayUrl } : undefined
    )
    return await opts.buildSession() // firstJoin pull; upserts 'active' itself
  } catch (err) {
    // Live rollback — the exact surgery recoverMounts would run at next boot,
    // plus (N1) the retraction of the announcement: a mount entry left behind
    // for a mount that never came up would make every peer of the root adopt
    // an empty subtree and sit in 'needs-token' forever. Hard-delete, never a
    // tombstone — the destination was empty by the guard above, and a dir that
    // exists on disk re-enrolls through the root's delta scan.
    if (announce) await opts.root.hardDeletePaths([path])
    opts.removeIgnore(path)
    for (const name of await opts.vaultDir.list(`${opts.room}/`)) await opts.vaultDir.remove(name)
    await opts.mountsFile.removeMount(opts.room)
    throw err
  }
}
