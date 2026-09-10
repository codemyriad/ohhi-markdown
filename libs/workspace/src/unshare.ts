/**
 * Unshare and unmount machines (spike S8 Q6, slice M5).
 *
 * unshareMount folds a shared mount (carved OR joined) back into the root
 * vault: 'unsharing:absorbing' → (inside a SHARED root, N1) one live map
 * transaction putting the subtree back and replacing the mount entry with a
 * dir entry → store surgery copying the mount's map entries (same guids),
 * LCAs, and doc blobs into the root namespace →
 * 'unsharing:disconnecting' → drop the mount namespace + entry. Both live
 * sessions are SHUT DOWN before the surgery — a live session's debounced
 * blob flush would clobber it — so the caller rebuilds the root session from
 * its updated stores afterwards. Crash recovery rolls forward from either
 * status (recoverMounts re-runs the idempotent absorb, then disconnects).
 *
 * unmountMount drops a joined mount without absorbing: providers die, the
 * namespace and entry go, and the files STAY on disk — the root's rescan
 * re-enrolls them as plain local notes. ("Also delete the files" is just a
 * normal tree delete afterwards, once the folder is local — journaled, and
 * with no peer-visible tombstones, which an in-mount delete would sync.)
 */
import type { MountsFile, StoreDir } from '@editor/vault'
import type { SyncEngine } from '@editor/sync'
import { absorbMount } from './vault-boot.js'
import type { MountSession } from './mount-session.js'

export interface UnshareOptions {
  vaultDir: StoreDir
  mountsFile: MountsFile
  engine: SyncEngine
  rootRoom: string
  /** The mount being folded back / dropped. */
  desc: { room: string; path: string }
  mount: MountSession
  removeIgnore: (prefix: string) => void
}

/** Fold `desc` back into the root. The caller rebuilds the root session after. */
export async function unshareMount(opts: UnshareOptions & { root: MountSession }): Promise<void> {
  await opts.mountsFile.setStatus(opts.desc.room, 'unsharing:absorbing')
  // Inside a relay-attached root the reverse transaction is the announcement
  // (N1, S10 Q1(b)): the mount entry at P flips back to a dir and every
  // subtree entry reappears with its ORIGINAL guid, in one 'local' txn on the
  // LIVE map — that is what the peers' absorb keys off. It must run while the
  // root's folder provider is still alive, and the membership must be read
  // from the mount's live map before the mount shuts down.
  const announce = opts.root.isShared()
  const entries = announce ? opts.mount.mapEntries() : []
  await opts.mount.shutdown()
  if (announce) await opts.root.announceAbsorb(opts.desc.path, entries)
  // Both sessions down before the store surgery: a live root would find guids
  // it has no doc for, adopt them with an empty doc + NEVER_ON_DISK LCA, and
  // ingest the file into a SECOND history for the same guid (duplicated text
  // on merge). The caller rebuilds the root from the copied blobs afterwards.
  await opts.root.shutdown()
  // The map half is already durable when we announced (announceAbsorb flushed
  // the folder blob), so the surgery only copies stores — re-running the blob
  // transaction could only resurrect keys the live map has since moved on from.
  await absorbMount(opts.vaultDir, opts.engine, opts.rootRoom, opts.desc, { writeMap: !announce })
  await opts.mountsFile.setStatus(opts.desc.room, 'unsharing:disconnecting')
  for (const name of await opts.vaultDir.list(`${opts.desc.room}/`)) {
    await opts.vaultDir.remove(name)
  }
  await opts.mountsFile.removeMount(opts.desc.room)
  opts.removeIgnore(opts.desc.path)
}

/** Drop a joined mount; files stay and become local via the root's rescan. */
export async function unmountMount(opts: UnshareOptions): Promise<void> {
  await opts.mountsFile.setStatus(opts.desc.room, 'unsharing:disconnecting')
  await opts.mount.shutdown()
  for (const name of await opts.vaultDir.list(`${opts.desc.room}/`)) {
    await opts.vaultDir.remove(name)
  }
  await opts.mountsFile.removeMount(opts.desc.room)
  opts.removeIgnore(opts.desc.path)
}
