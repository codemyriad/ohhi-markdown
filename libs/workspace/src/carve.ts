/**
 * The carve state machine (spike S8 Q1, slice M4): convert a subtree of a
 * mount into its own shared mount. Every transition writes its status to
 * mounts.json FIRST, so an interrupted carve is recovered at the next boot
 * (recoverMounts): a crash during seeding rolls back (the target namespace is
 * derived state; the parent was never touched), a crash during detaching rolls
 * forward (store surgery re-runs the detach). The carve moves no file bytes
 * and copies no content — same doc guids, new room prefix — so disk is never
 * at risk at any step.
 *
 * Nested shares, depth 1 (slice N1, device-link-shaping A2/A5): the parent may
 * now be relay-attached. When it is, the detach transaction ALSO writes a
 * `kind:'mount'` entry at the mount root, so every peer of the parent room
 * learns where the subtree went in the same transaction that removes it —
 * that entry is the peer-side adopt machine's trigger. The V1 "this vault is
 * itself shared" refusal is gone with it. Still refused elsewhere and
 * unchanged: a carve whose subtree contains or sits inside another mount
 * (MountRegistry.nests + the tree's eligibility rules) — that is the depth-1
 * rule.
 *
 * Token minting happens BEFORE this runs (caller-side): a mint failure is a
 * clean abort with nothing persisted anywhere.
 */
import { scopedStoreDir, type MountsFile, type StoreDir } from '@editor/vault'
import type { MountSession } from './mount-session.js'

export interface CarveOptions {
  /**
   * The parent mount being carved. May be relay-attached (N1): when it is, the
   * detach announces the new mount to its peers via a map entry.
   */
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
  const targetDir = scopedStoreDir(opts.vaultDir, `${opts.room}/`)
  await opts.mountsFile.upsert({
    room: opts.room,
    path: opts.mountPath,
    provenance: 'carved',
    relay: { url: opts.relayUrl },
    status: 'carving:seeding',
  })
  await opts.root.seedCarveStores(opts.mountPath, targetDir)
  await opts.mountsFile.setStatus(opts.room, 'carving:detaching')
  opts.addIgnore(opts.mountPath)
  // Relay-attached parent → announce the mount to its peers in the same
  // transaction as the deletion (A2). A private vault has no peers to tell.
  //
  // `targetDir` closes the seed→detach window (S10 Q5 row 2): carveFolder
  // pauses nothing, so between the seed above and the detach below a remote
  // update or a keystroke can land in a doc whose state was already copied.
  // The detach re-flushes each doc's CURRENT state before destroying it.
  await opts.root.detachSubtree(
    opts.mountPath,
    opts.root.isShared() ? { room: opts.room, relay: opts.relayUrl } : undefined,
    { targetDir }
  )
  await opts.mountsFile.setStatus(opts.room, 'active')
}
