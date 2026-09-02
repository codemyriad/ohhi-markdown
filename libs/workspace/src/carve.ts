/**
 * The carve state machine (spike S8 Q1, slice M4): convert a subtree of an
 * UNSHARED mount into its own shared mount. Every transition writes its
 * status to mounts.json FIRST, so an interrupted carve is recovered at the
 * next boot (recoverMounts): a crash during seeding rolls back (the target
 * namespace is derived state; the parent was never touched), a crash during
 * detaching rolls forward (store surgery re-runs the detach). The carve
 * moves no file bytes and copies no content — same doc guids, new room
 * prefix — so disk is never at risk at any step.
 *
 * Token minting happens BEFORE this runs (caller-side): a mint failure is a
 * clean abort with nothing persisted anywhere.
 */
import { scopedStoreDir, type MountsFile, type StoreDir } from '@editor/vault'
import type { MountSession } from './mount-session.js'

export interface CarveOptions {
  /** The parent mount being carved — must be unshared (V1 guard). */
  root: MountSession
  /** The VAULT store dir (holds mounts.json + per-room namespaces). */
  vaultDir: StoreDir
  mountsFile: MountsFile
  /** Workspace-relative dir becoming the mount root. */
  mountPath: string
  /** Freshly minted room GUID (its token already exists on the relay). */
  room: string
  relayUrl: string
  /**
   * Add `mountPath` to the live ignore set backing the root's
   * ignoringAdapter — called just before detach so the restarted watcher
   * never sees the subtree again.
   */
  addIgnore: (prefix: string) => void
}

export async function carveFolder(opts: CarveOptions): Promise<void> {
  if (opts.root.isShared()) {
    // Carving inside a shared room would sync the map deletions to peers,
    // whose sessions would delete local files (spike S8 "The mount model").
    throw new Error(
      'this vault is itself shared — sharing a folder inside a shared vault is not supported yet'
    )
  }
  await opts.mountsFile.upsert({
    room: opts.room,
    path: opts.mountPath,
    provenance: 'carved',
    relay: { url: opts.relayUrl },
    status: 'carving:seeding',
  })
  await opts.root.seedCarveStores(opts.mountPath, scopedStoreDir(opts.vaultDir, `${opts.room}/`))
  await opts.mountsFile.setStatus(opts.room, 'carving:detaching')
  opts.addIgnore(opts.mountPath)
  await opts.root.detachSubtree(opts.mountPath)
  await opts.mountsFile.setStatus(opts.room, 'active')
}
