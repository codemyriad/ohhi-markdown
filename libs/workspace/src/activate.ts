/**
 * The activate machine (slice N3, spike S10 Q2 "What activates it on paste"):
 * a mount this device holds but has no credential for gets one.
 *
 * It is a lifecycle machine like `carveFolder` / `joinMount` / `unshareMount`,
 * not a shim helper — it writes a durable status first, has a rollback, and is
 * driven identically by the web shell and by the device-link harness. It lived
 * in the shim until the N3 harness found the defect below, at which point
 * "the rule exists in one place" stopped being a tidiness argument.
 *
 * ONE rule, two existing machines:
 *
 *  - a mount whose namespace this device SEEDED activates in place through
 *    `enableSharing`: same guids as the room's, so providers connect and the
 *    CRDT merges whatever was edited while token-less. Nothing is re-read from
 *    disk, no doc is destroyed, no content is fetched twice.
 *  - a mount this device has NEVER held (`MountDesc.neverHeld`) is rebuilt as
 *    a `firstJoin` and PULLS its room through the awaited machinery, with a
 *    progress line.
 *
 * The discriminator used to be `session.files().length > 0`, and it was wrong
 * in the direction that loses data. An adopt with an empty membership still
 * wrote an empty folder blob, so at the next boot `tryDurableReopen` won over
 * `firstJoin`, the awaited pull never ran (measured: the paste returned in 1 ms
 * with 0 rows), and — worse — the boot delta scan enrolled the on-disk files
 * under the mount root with FRESH guids, which the paste then `enableSharing`d
 * into the room to LWW-clobber the owner's entries. `neverHeld` is recorded by
 * the adopt, survives every reopen, and is cleared only by a pull.
 */
import { wipeStoreDir, type MountDesc, type MountsFile, type StoreDir } from '@editor/vault'
import type { AdoptedMountOptions } from './adopt.js'
import type { MountSession } from './mount-session.js'
import type { PullProgress, RelayConfig } from './types.js'

export interface ActivateMountOptions {
  /** The vault store dir (per-room namespaces). */
  vaultDir: StoreDir
  mountsFile: MountsFile
  /** The mount being activated, as mounts.json holds it. */
  desc: MountDesc
  /** Its live (provider-less) session. */
  session: MountSession
  /** The credential the pasted link decoded to. Its room must be `desc.room`. */
  relay: RelayConfig
  /** Build the replacement session (the host owns stores/records/events). */
  buildSession: (opts: AdoptedMountOptions) => Promise<MountSession>
  /** Unregister the mount at `path` (host registry + view state). */
  detachMount: (path: string) => void
  /** Register the mount at `path`. */
  attachMount: (path: string, session: MountSession) => void
  /** Two-phase progress for the pull branch; never called for a merge. */
  onPullProgress?: (progress: PullProgress) => void
}

/**
 * One activation per room at a time.
 *
 * The pull branch is a long awaited operation that starts by writing a
 * recoverable status and WIPING the namespace. A second call arriving while
 * the first is in flight — an impatient second paste, an "Add link…" dialog
 * still open behind a retry, two rows of the tree wired to the same room —
 * would re-enter `joining` and wipe the namespace the first pull is filling,
 * then attach a second session at the same path. The first caller's
 * `attachMount` would then overwrite the second's, leaving a live session
 * nobody holds a handle to.
 */
const inFlight = new Map<string, Promise<MountSession>>()

/**
 * Give a `needs-token` mount its credential. Returns the session that is live
 * afterwards — the same one for a merge, a fresh one for a pull.
 *
 * Idempotent per room: a call that arrives while another is running joins it,
 * and a mount that is already active with this credential is left alone.
 */
export function activateMount(opts: ActivateMountOptions): Promise<MountSession> {
  const running = inFlight.get(opts.desc.room)
  if (running) return running
  const run = activateOnce(opts).finally(() => inFlight.delete(opts.desc.room))
  inFlight.set(opts.desc.room, run)
  return run
}

async function activateOnce(opts: ActivateMountOptions): Promise<MountSession> {
  const { desc, mountsFile } = opts
  if (opts.relay.token === '') throw new Error('that link carries no token')

  // Already done. A settled, connected mount holding a namespace does not
  // need re-keying, and running the merge branch again would re-tear-down and
  // re-attach every provider for nothing.
  if (desc.status === 'active' && desc.neverHeld !== true && opts.session.isShared()) {
    return opts.session
  }

  if (desc.neverHeld !== true) {
    // The seeded case. `enableSharing` sets the relay, connects the folder
    // provider and attaches one per doc already in the session — a true CRDT
    // merge, because the guids ARE the room's. State the status here rather
    // than waiting for the session's own fire-and-forget desc write, so the
    // tree stops reading "link needed" the moment the paste lands.
    opts.session.enableSharing(opts.relay)
    await mountsFile.upsertWith(desc.room, (existing) => ({
      ...(existing ?? desc),
      relay: { url: opts.relay.url },
      status: 'active',
    }))
    return opts.session
  }

  // The empty case: this device holds none of the room's state, so there is
  // nothing to merge and the mount must pull. 'joining' first — its recovery
  // row is a rollback (drop the derived namespace and the desc), which is
  // exactly right here: the mount entry is still a fact of the parent room, so
  // the next boot's adopt pass re-adopts and we are back to `needs-token`.
  await mountsFile.setStatus(desc.room, 'joining')
  opts.detachMount(desc.path)
  await opts.session.shutdown()
  // Drop whatever the adopt left behind. It is at most the seeded MAP — the
  // room's structure with none of its content — and a folder blob makes
  // `tryDurableReopen` win over `firstJoin`, which is precisely how the
  // awaited pull came to be skipped. 'joining' rolls back to exactly this.
  await wipeStoreDir(opts.vaultDir, `${desc.room}/`)
  try {
    const next = await opts.buildSession({
      room: desc.room,
      path: desc.path,
      provenance: desc.provenance,
      relay: opts.relay,
      firstJoin: true,
      ...(opts.onPullProgress ? { onPullProgress: opts.onPullProgress } : {}),
    })
    opts.attachMount(desc.path, next)
    // The pull happened: `neverHeld` is spent. The session's own
    // `writeMountDesc` already dropped it (a firstJoin boot is the only thing
    // that can), and this states the settled status without racing its flush.
    await mountsFile.upsertWith(desc.room, (existing) => {
      const { neverHeld: _spent, ...rest } = existing ?? desc
      return { ...rest, relay: { url: opts.relay.url }, status: 'active' }
    })
    return next
  } catch (err) {
    // Live rollback, the same surgery the next boot would run: back to a
    // provider-less mount marked "link needed", with its files still on disk
    // and still unmanaged. A failed paste must never leave the folder
    // sessionless — that is the state spike S10 Q2 rejected outright.
    await mountsFile.upsertWith(desc.room, (existing) => ({
      ...(existing ?? desc),
      status: 'needs-token',
      neverHeld: true,
    }))
    const back = await opts.buildSession({
      room: desc.room,
      path: desc.path,
      provenance: desc.provenance,
      neverHeld: true,
    })
    opts.attachMount(desc.path, back)
    throw err
  }
}
