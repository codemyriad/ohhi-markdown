/**
 * The peer-side adopt / absorb machine (slice N1, device-link-shaping A3;
 * spike S10 Q1 + Q5) — the mirror of the carve machine, run by every peer of
 * a room in which someone else carved or unshared a subtree.
 *
 * The parent map is the announcement channel, so there is no new transport: a
 * `kind:'mount'` entry appearing at `P` says "the subtree at P moved to room
 * R", and the same key flipping back to a `dir` (never merely disappearing —
 * a missing key is a rename race) says "R was dissolved". `reconcileMountEntries`
 * joins that map against `mounts.json` and executes one row of the decision
 * table (adopt / steady / re-key / re-point / absorb / repair / depth-1
 * violation), then sweeps ghosts.
 *
 * Three properties this file exists to keep:
 *
 *  - **No content moves.** An adopt seeds the new mount's namespace from THIS
 *    device's own parent namespace — same doc guids, keys rebased — so the
 *    CRDT merges with the carver's seed instead of importing a second copy.
 *  - **Every step is a durable status first.** `adopting:seeding` rolls back
 *    (drop the derived namespace; the boot pass re-adopts, because the mount
 *    entry is still a fact in a room we are a peer of), `adopting:detaching`
 *    and `absorbing` roll forward. See `recoverMounts`.
 *  - **A tombstone is never written under a mount root.** A peer that has not
 *    yet adopted applies a tombstone by removing the file from disk, so the
 *    ghost rule hard-deletes parent keys instead (S10 Q5).
 *
 * Host-neutral: like `carveFolder` and `joinMount`, everything host-shaped
 * (building sessions, the registry, the live ignore set, notices) arrives as a
 * callback.
 */
import {
  isRecoverable,
  mountRootsFrom,
  scopedStoreDir,
  wipeStoreDir,
  type MountDesc,
  type MountProvenance,
  type MountsFile,
  type StoreDir,
} from '@editor/vault'
import type { FileEntry, SyncEngine } from '@editor/sync'
import { absorbMount } from './vault-boot.js'
import type { MountSession } from './mount-session.js'
import type { MountEntryInfo, RelayConfig } from './types.js'

/** What the host must build for a mount this machine decided to run. */
export interface AdoptedMountOptions {
  room: string
  path: string
  provenance: MountProvenance
  /** Absent ⇒ a provider-less mount: a fully functional LOCAL mount that
   * knows where its room lives (`needs-token`, spike S10 Q2). */
  relay?: RelayConfig
  /** True only when there was nothing to seed AND a token is held — the mount
   * must PULL its room rather than merge with a namespace it built itself. */
  firstJoin?: boolean
}

/** Why the host is being told something happened (it owns the wording). */
export type AdoptNoticeKind =
  /** A peer's carve was adopted and is connected. */
  | 'adopted'
  /** Adopted, but this device holds no token for the room — files kept, marked. */
  | 'needs-token'
  /** The owner unshared: the mount was folded back into the parent. */
  | 'absorbed'
  /** The owner unshared while this device was mid-adopt (S10 Q5 row 13). */
  | 'adopt-cancelled'
  /** The mount root moved in the parent map (a peer renamed it). */
  | 'mount-moved'
  /** Two devices carved the same folder; the map's room won (row 10). */
  | 'room-repointed'
  /** A mount inside a mount (row 11) — depth 1 is the rule; the outer wins. */
  | 'depth-limit'
  /** A mass delete arrived from the parent and is held for confirmation. */
  | 'ghosts-held'

export interface AdoptNotice {
  kind: AdoptNoticeKind
  /** Workspace-relative mount root the notice is about. */
  path: string
  room: string
}

export interface AdoptContext {
  /** The vault store dir (mounts.json + per-room namespaces). */
  vaultDir: StoreDir
  mountsFile: MountsFile
  engine: SyncEngine
  /**
   * The LIVE root mount. A function, not a value: an absorb shuts the root
   * down and rebuilds it, and every later step must see the new session.
   */
  root: () => MountSession
  rootRoom: string
  /** Live non-root mounts by workspace-relative root (the host's registry). */
  mounts: () => Map<string, MountSession>
  /**
   * The credential for a mount's room, or null when this device holds none
   * (⇒ `needs-token`). The lookup order lives in the host, which owns config:
   * exact token for the room → the root's token when it is a DEVICE token and
   * the room was carved out of this vault → none (spike S10 Q2).
   */
  relayFor: (mount: {
    room: string
    path: string
    relay?: string
    provenance: MountProvenance
  }) => RelayConfig | null
  buildSession: (opts: AdoptedMountOptions) => Promise<MountSession>
  /** Register a live mount (the host's MountRegistry + view state). */
  attachMount: (path: string, session: MountSession) => void
  /** Unregister the mount at `path`, returning its session if it was running. */
  detachMount: (path: string) => MountSession | null
  /**
   * Shut the root session down, run `fn` (store surgery on the root
   * namespace), then rebuild the root from its updated stores. A live root
   * would adopt guids it has no doc for, invent an empty doc plus a
   * NEVER_ON_DISK LCA, and ingest the file into a SECOND history for the same
   * guid — duplicated text on merge (spike S10 Q1(b)).
   */
  withRootDown: (fn: () => Promise<void>) => Promise<void>
  /** Recompute the live ignore set (mounts.json ∪ the map's mount entries). */
  refreshIgnore: () => void | Promise<void>
  notify?: (notice: AdoptNotice) => void
}

/**
 * One pass of the decision table (spike S10 Q1). Both entry points call it:
 * the LIVE one (`MountEvents.onMountEntries`, which the session queues on its
 * map-work chain ahead of the map scan) and the BOOT one (after
 * `recoverMounts` and after the root has restored its folder blob) — the
 * latter being what gives a device that was closed during a peer's carve its
 * trigger on reopen, and what makes an `adopting:seeding` rollback re-adopt
 * rather than strand a subtree.
 *
 * Serialize it: the caller is either the map-work chain or the boot sequence,
 * and this function assumes no second copy of itself is running.
 */
export async function reconcileMountEntries(ctx: AdoptContext): Promise<void> {
  const entries = ctx.root().mountEntries()
  const descs = (await ctx.mountsFile.load()).filter((d) => d.path !== '')
  // A desc in a lifecycle status belongs to a machine that is running RIGHT
  // NOW — a carve mid-seed, a join mid-pull, an absorb mid-copy. This pass can
  // be queued from the map observer at any moment, and acting on one of those
  // would absorb a mount being carved or wipe a namespace being seeded. Leave
  // them; whichever machine owns them settles them, and the next pass sees the
  // result.
  const busyRooms = new Set<string>()
  const busyPaths = new Set<string>()
  const stable: MountDesc[] = []
  for (const desc of descs) {
    if (isRecoverable(desc.status)) {
      busyRooms.add(desc.room)
      busyPaths.add(desc.path)
    } else {
      stable.push(desc)
    }
  }
  const byRoom = new Map(stable.map((d) => [d.room, d]))
  const shared = ctx.root().isShared()

  // Depth 1 is the rule (device-link-shaping A5): only the root mount may
  // contain mounts. A mount entry UNDER another mount entry is unrepresentable
  // on every device — MountRegistry.add refuses it — so the outer one wins and
  // the inner key is hard-deleted here, before anything tries to adopt it.
  const nested = entries.filter((e) => entries.some((o) => e.path.startsWith(`${o.path}/`)))
  if (nested.length > 0) {
    await ctx.root().hardDeletePaths(nested.map((e) => e.path))
    for (const e of nested) ctx.notify?.({ kind: 'depth-limit', path: e.path, room: e.room })
  }
  const announced = entries.filter((e) => !nested.includes(e))

  // ---- map-driven rows ----
  for (const entry of announced) {
    if (busyRooms.has(entry.room) || busyPaths.has(entry.path)) continue
    const desc = byRoom.get(entry.room)
    const atPath = stable.find((d) => d.path === entry.path)
    if (desc && desc.path === entry.path) {
      ctx.root().clearMountPreImage(entry.path) // steady: nothing to seed from
      continue
    }
    if (desc) {
      await rekeyMount(ctx, desc, entry) // same room, new path
      continue
    }
    if (atPath) {
      // Same path, DIFFERENT room: two devices carved the same folder and
      // Yjs's LWW picked one. The map wins — it is the statement everyone
      // converges on — so this device re-points its (guid-identical)
      // namespace at the winner instead of re-seeding (S10 Q5 row 10).
      await repointMount(ctx, atPath, entry)
      continue
    }
    await adoptMount(ctx, entry)
  }

  // ---- desc-driven rows ----
  for (const desc of stable) {
    if (announced.some((e) => e.room === desc.room)) continue
    // Re-read per desc: an absorb rebuilds the root session, so a snapshot
    // taken before the loop would be a dead doc's by the second iteration.
    const at = ctx.root().mapEntries(true).find(([p]) => p === desc.path)?.[1]
    if (at && !at.deleted && at.kind !== 'mount') {
      // The entry at P became a dir: the owner unshared. NEVER key off "the
      // key is gone" — that is a rename race, and treating it as an unshare
      // would dissolve a live mount (S10 Q5 rows 3 and 11).
      await absorbAdopted(ctx, desc)
      continue
    }
    if (!at && shared) {
      // Key absent where we hold a mount: a concurrent rename or delete raced
      // the announcement. mounts.json is the authority on WHETHER a mount
      // exists; re-state it in the map.
      await repairEntry(ctx, desc)
    }
  }

  await sweepGhosts(ctx)
}

// ---------------------------------------------------------------- the adopt

/**
 * The seven-step adopt (spike S10 Q1(a)). Every step's durable effect is
 * written before the step it enables, so the recovery table has a row for
 * every interruption point.
 */
async function adoptMount(ctx: AdoptContext, entry: MountEntryInfo): Promise<void> {
  const { path, room } = entry
  const members = await membershipFor(ctx, entry)
  const targetDir = scopedStoreDir(ctx.vaultDir, `${room}/`)

  // 2. The desc first: a crash from here on is recoverable, and the ignore
  //    set now has a mounts.json term as well as its map term.
  await ctx.mountsFile.upsert({
    room,
    path,
    provenance: 'adopted',
    ...(entry.relay ? { relay: { url: entry.relay } } : {}),
    status: 'adopting:seeding',
  })
  await ctx.refreshIgnore()

  // 3. Seed the mount namespace from OUR OWN parent namespace: same doc guids,
  //    keys rebased subtree-relative, LCAs rebased, blobs flushed. No content
  //    is copied between rooms and none is fetched.
  await ctx.root().seedCarveStores(path, targetDir, members)
  await ctx.mountsFile.setStatus(room, 'adopting:detaching')

  // 5a. Precondition re-check (S10 Q5 row 13, the worst race): if the owner
  //     unshared while we were seeding, the detach below would hard-delete the
  //     very entries their absorb just restored — stripping the subtree from
  //     the room for everyone. Step 5 is the first step that touches the
  //     parent, so cancelling before it is a clean rollback.
  const still = ctx.root().mountEntries().find((e) => e.path === path && e.room === room)
  if (!still) {
    await wipeStoreDir(ctx.vaultDir, `${room}/`)
    await ctx.mountsFile.removeMount(room)
    ctx.root().clearMountPreImage(path)
    await ctx.refreshIgnore()
    ctx.notify?.({ kind: 'adopt-cancelled', path, room })
    return
  }

  // 5b. Depth 1: a mount of ours sitting INSIDE the one arriving is folded
  //     into it before the outer mount exists (S10 Q5 row 11, "outer wins").
  await dissolveNested(ctx, path, room)

  // 5c. The parent teardown. `writeMap:false` — the carver already announced;
  //     `targetDir` re-flushes each doc's CURRENT state first, closing the
  //     seed→detach window (row 2).
  await ctx.root().detachSubtree(path, undefined, { entries: members, writeMap: false, targetDir })

  // 6. Token? Active. No token? A fully functional local mount that knows
  //    where its room lives — files kept on disk, marked, never a lie about
  //    being "offline" (S10 Q2).
  const relay = ctx.relayFor({ room, path, relay: entry.relay, provenance: 'adopted' })
  await ctx.mountsFile.setStatus(room, relay ? 'active' : 'needs-token')
  const session = await ctx.buildSession({
    room,
    path,
    provenance: 'adopted',
    ...(relay ? { relay } : {}),
    // Nothing to seed AND a credential to pull with ⇒ this device never held
    // the subtree (a foreign share that arrived as a mount entry, or a wiped
    // device): the mount must pull its own room (S10 Q1 "firstJoin rule").
    firstJoin: members.length === 0 && !!relay,
  })
  ctx.attachMount(path, session)
  ctx.root().clearMountPreImage(path)
  await ctx.refreshIgnore()
  ctx.notify?.({ kind: relay ? 'adopted' : 'needs-token', path, room })
}

/**
 * `M(P)` = (the map entries at/under P, as they were BEFORE the carve
 * transaction) ∪ (parent-namespace LCA records whose path is at/under `P/`).
 *
 * The union is what makes the adopt idempotent across every crash point. The
 * map term is empty on the live path — the deletions and the mount entry
 * arrive in one transaction and no observer sees the pre-image — so the
 * session captures it synchronously in its observer. The LCA term is the
 * durable half: after a crash, the orphaned records in the parent namespace
 * reconstruct membership with no in-memory state at all. It is text-only
 * (binaries and dirs have no LCA); those entries then arrive from the mount
 * room when it connects, and a needs-token mount recovered that way holds a
 * text-only namespace over untouched files. Nothing is lost, nothing lies.
 */
async function membershipFor(
  ctx: AdoptContext,
  entry: MountEntryInfo
): Promise<[string, FileEntry][]> {
  const prefix = `${entry.path}/`
  const out = new Map<string, FileEntry>()
  /**
   * Paths the pre-image knew were DELETED. A delete tombstones the map entry
   * and removes the file, but it leaves the LCA record behind — and the
   * carve's transaction hard-deletes the tombstone from the map, so by the
   * time this runs there is nothing left saying "gone". Without this set the
   * orphan-LCA term below reads that record as membership and RESURRECTS the
   * note into the new mount: alive in the room's map, materialized back onto
   * the carver's disk, and a `vanished` review on every other device.
   */
  const buried = new Set<string>()
  for (const [path, e] of ctx.root().mountPreImage(entry.path) ?? []) {
    if (e.deleted) buried.add(path)
    else out.set(path, e)
  }
  const live = new Map(ctx.root().mapEntries())
  for (const rec of await ctx.root().lcaRecords()) {
    if (rec.path !== entry.path && !rec.path.startsWith(prefix)) continue
    if (out.has(rec.path) || buried.has(rec.path)) continue
    const inMap = live.get(rec.path)
    if (inMap && inMap.kind !== 'mount') continue // still the parent's file
    out.set(rec.path, { guid: rec.guid, kind: 'text' })
  }
  return [...out.entries()]
}

/**
 * Depth-1 enforcement on the stores (S10 Q5 row 11): a mount this device holds
 * UNDER the newly-announced root is folded into it — `absorbMount` already
 * takes the destination room as a parameter, and the outer namespace has just
 * been seeded, so this is the same idempotent surgery with a different target.
 */
async function dissolveNested(ctx: AdoptContext, path: string, room: string): Promise<void> {
  const prefix = `${path}/`
  const inner = (await ctx.mountsFile.load()).filter(
    (d) => d.path !== '' && d.path !== path && d.path.startsWith(prefix)
  )
  for (const desc of inner) {
    const session = ctx.detachMount(desc.path)
    await session?.shutdown()
    await ctx.mountsFile.setStatus(desc.room, 'absorbing')
    // The outer mount has no live session yet, so its folder blob is ours to
    // rewrite — writeMap:true is safe and necessary here.
    await absorbMount(ctx.vaultDir, ctx.engine, room, {
      room: desc.room,
      path: desc.path.slice(prefix.length),
    })
    await wipeStoreDir(ctx.vaultDir, `${desc.room}/`)
    await ctx.mountsFile.removeMount(desc.room)
    ctx.notify?.({ kind: 'depth-limit', path: desc.path, room: desc.room })
  }
  if (inner.length > 0) await ctx.refreshIgnore()
}

// -------------------------------------------------------------- the reverse

/**
 * The owner unshared (spike S10 Q1(b)): fold the mount's stores back into the
 * parent namespace and drop the room. `writeMap:false` throughout — on a peer
 * the map is the owner's and only the stores are ours; the entries are already
 * back in the map, which is how we found out.
 */
async function absorbAdopted(ctx: AdoptContext, desc: MountDesc): Promise<void> {
  await ctx.mountsFile.setStatus(desc.room, 'absorbing')
  const session = ctx.detachMount(desc.path)
  await session?.shutdown()
  await ctx.withRootDown(async () => {
    await absorbMount(
      ctx.vaultDir,
      ctx.engine,
      ctx.rootRoom,
      { room: desc.room, path: desc.path },
      { writeMap: false }
    )
    await ctx.mountsFile.setStatus(desc.room, 'unsharing:disconnecting')
    await wipeStoreDir(ctx.vaultDir, `${desc.room}/`)
    await ctx.mountsFile.removeMount(desc.room)
    // The derived ignore set stops covering P on its own now: no mount entry,
    // no desc. Refresh BEFORE the root is rebuilt, or its adapter would still
    // hide the files it is about to take back.
    await ctx.refreshIgnore()
  })
  ctx.notify?.({ kind: 'absorbed', path: desc.path, room: desc.room })
}

/** The mount root moved in the parent map: move the desc, rebuild in place. */
async function rekeyMount(
  ctx: AdoptContext,
  desc: MountDesc,
  entry: MountEntryInfo
): Promise<void> {
  const session = ctx.detachMount(desc.path)
  await session?.shutdown()
  await ctx.mountsFile.upsert({
    ...desc,
    path: entry.path,
    ...(entry.relay ? { relay: { url: entry.relay } } : {}),
  })
  await ctx.refreshIgnore()
  // No re-seed: the namespace is unchanged and the guids are the same. The
  // session is rebuilt only because its adapter is scoped to the mount root,
  // and that root just moved.
  const relay = ctx.relayFor({
    room: desc.room,
    path: entry.path,
    relay: entry.relay ?? desc.relay?.url,
    provenance: desc.provenance,
  })
  if (!relay) await ctx.mountsFile.setStatus(desc.room, 'needs-token')
  const next = await ctx.buildSession({
    room: desc.room,
    path: entry.path,
    provenance: desc.provenance,
    ...(relay ? { relay } : {}),
  })
  ctx.attachMount(entry.path, next)
  ctx.notify?.({ kind: 'mount-moved', path: entry.path, room: desc.room })
}

/**
 * Two devices carved the same folder (S10 Q5 row 10). The map's room wins;
 * this device re-points its namespace at it. The two namespaces are
 * guid-identical — both were seeded from the same parent state — so the
 * copied blobs carry this device's edits into the winner and the CRDT merges
 * them. The loser's room is an orphan (relay GC, Later).
 *
 * Ordered so no crash can lose the namespace: copy first, then swap the descs.
 * A crash between the two writes leaves both descs at one path, which the
 * boot pass resolves in favour of the room the map names.
 */
async function repointMount(
  ctx: AdoptContext,
  loser: MountDesc,
  entry: MountEntryInfo
): Promise<void> {
  const session = ctx.detachMount(loser.path)
  await session?.shutdown()
  await wipeStoreDir(ctx.vaultDir, `${entry.room}/`)
  // `StoreDir.list(prefix)` returns FULL names (that is what makes
  // `wipeStoreDir`'s `remove(name)` correct), so the copy goes through scoped
  // views rather than re-prefixing by hand. Getting that wrong copied NOTHING,
  // and the mount then rebuilt itself from an empty namespace: fresh guids for
  // files the winner's room already had, i.e. every note twice on merge, with
  // this device's edits stranded in the orphan room.
  const from = scopedStoreDir(ctx.vaultDir, `${loser.room}/`)
  const to = scopedStoreDir(ctx.vaultDir, `${entry.room}/`)
  for (const name of await from.list()) {
    const bytes = await from.io(name).read()
    if (bytes) await to.io(name).writeAtomic(bytes)
  }
  const relay = ctx.relayFor({
    room: entry.room,
    path: entry.path,
    relay: entry.relay,
    provenance: 'adopted',
  })
  await ctx.mountsFile.upsert({
    room: entry.room,
    path: entry.path,
    provenance: 'adopted',
    ...(entry.relay ? { relay: { url: entry.relay } } : {}),
    status: relay ? 'active' : 'needs-token',
  })
  await ctx.mountsFile.removeMount(loser.room)
  await wipeStoreDir(ctx.vaultDir, `${loser.room}/`)
  await ctx.refreshIgnore()
  const next = await ctx.buildSession({
    room: entry.room,
    path: entry.path,
    provenance: 'adopted',
    ...(relay ? { relay } : {}),
  })
  ctx.attachMount(entry.path, next)
  ctx.notify?.({ kind: 'room-repointed', path: entry.path, room: entry.room })
}

/** Re-state a mount entry a concurrent rename/delete removed from the map. */
async function repairEntry(ctx: AdoptContext, desc: MountDesc): Promise<void> {
  await ctx.root().setMountEntry(desc.path, desc.room, desc.relay?.url)
}

// --------------------------------------------------------- the ghost sweep

/**
 * The ghost-entry rule (spike S10 Q5), the single policy every race row is an
 * application of:
 *
 *   A non-deleted parent-map entry at or under a mount root P is a GHOST.
 *   Resolve it by guid — rename inside the mount, import with a fresh guid,
 *   or replay the delete — then HARD-DELETE the parent key. Never a tombstone:
 *   a peer that has not yet adopted applies a tombstone by removing the file
 *   from disk, which is real data loss on a device that still legitimately
 *   owns those bytes. Hard deletion is safe there precisely because the
 *   subtree's authority has moved, which is why deletes everywhere else stay
 *   tombstones.
 *
 * And symmetrically, an entry OUTSIDE P whose guid a mount owns is a
 * cross-boundary move out: re-enrol it at its new path with a fresh guid in
 * the parent (content identity never crosses rooms) and delete it inside the
 * mount.
 *
 * Runs at the end of every adopt and on every later parent-map change while
 * the mount exists.
 */
export async function sweepGhosts(ctx: AdoptContext): Promise<void> {
  const mounts = ctx.mounts()
  if (mounts.size === 0) return
  const roots = [...mounts.keys()].filter((p) => p !== '')
  if (roots.length === 0) return

  /** Parent keys to hard-delete, collected and removed in one transaction. */
  const doomed: string[] = []
  /** Deletes to replay inside each mount (breaker-held when large). */
  const deletes = new Map<string, string[]>()

  for (const [path, entry] of ctx.root().mapEntries(true)) {
    const root = roots.find((r) => path === r || path.startsWith(`${r}/`))
    if (!root) {
      // Outside every mount root: only interesting if a mount owns the guid.
      if (entry.deleted || entry.kind === 'mount') continue
      const session = [...mounts.entries()].find(
        ([p, s]) => p !== '' && s.pathOfGuid(entry.guid) !== null
      )?.[1]
      if (!session) continue
      const rel = session.pathOfGuid(entry.guid)!
      // Re-enrol here with a fresh guid, tombstone there. On the device that
      // MADE the move the bytes are already at the destination, so nothing is
      // copied. On a peer that merely LEARNED about it they are still under
      // the mount root and the re-enrol is a no-op, which leaves the mount's
      // guid live in the parent map (tombstoned in the room, so no invariant
      // fires) over a doc this device can only fill from the mover — see the
      // skipped `fuzz-crashers/0001-move-out-on-a-peer.spec.ts`, which is a
      // design question for S10 Q5 row 5, not a local fix.
      await ctx.root().reenrollPath(path)
      await session.deletePath(rel)
      ctx.notify?.({ kind: 'mount-moved', path, room: session.room })
      continue
    }
    if (path === root) continue // the boundary itself
    const session = mounts.get(root)!
    const rel = path.slice(root.length + 1)
    doomed.push(path)
    if (entry.kind === 'mount') {
      // Depth-1 violation under a live mount: the outer wins, the key goes.
      ctx.notify?.({ kind: 'depth-limit', path, room: entry.guid })
      continue
    }
    const owned = session.pathOfGuid(entry.guid)
    if (entry.deleted) {
      // A tombstone for a guid the mount owns: replay the delete inside the
      // mount, which tombstones it for the mount's OWN peers — where a
      // tombstone is the correct, journaled thing.
      if (owned) {
        const list = deletes.get(root) ?? []
        list.push(owned)
        deletes.set(root, list)
      }
      continue
    }
    if (owned === rel) continue // same guid, same place: nothing to replay
    if (owned) {
      await session.renamePath(owned, rel) // a peer renamed it inside the mount
      continue
    }
    if (entry.kind !== 'text' && entry.kind !== 'binary') continue // a stray dir key
    const bytes = await session.readFileBytes(rel)
    // Unknown guid with bytes on disk: import into the mount with a FRESH guid
    // — content identity never crosses rooms (spike S8 Q5).
    if (bytes) await session.importFile(rel, bytes)
  }

  for (const [root, rels] of deletes) {
    const session = mounts.get(root)
    if (!session || rels.length === 0) continue
    ctx.notify?.({ kind: 'ghosts-held', path: root, room: session.room })
    await session.replayDeletes(rels)
  }
  await ctx.root().hardDeletePaths(doomed)
}

/**
 * The executable form of A6's invariant, for tests and diagnostics: every guid
 * in exactly one mount namespace, every path in exactly one map, nothing under
 * a mount boundary, and mounts.json ⟷ registry ⟷ ignore set naming the same
 * roots. Returns the violations rather than asserting, so callers phrase their
 * own failures.
 */
export function mountInvariants(input: {
  descs: readonly MountDesc[]
  ignore: ReadonlySet<string>
  mounts: readonly { mountPath: string; session: MountSession }[]
}): string[] {
  const problems: string[] = []
  const owners = new Map<string, string[]>()
  const paths = new Map<string, string[]>()
  /** Which mount root each workspace path was claimed by. */
  const claimedBy = new Map<string, string>()
  const boundaries = new Set<string>()
  const push = (m: Map<string, string[]>, k: string, v: string): void => {
    const list = m.get(k)
    if (list) list.push(v)
    else m.set(k, [v])
  }
  let rootEntries: readonly (readonly [string, FileEntry])[] = []
  for (const { mountPath, session } of input.mounts) {
    if (mountPath === '') rootEntries = session.mapEntries()
    for (const [rel, e] of session.mapEntries()) {
      const full = mountPath === '' ? rel : `${mountPath}/${rel}`
      if (e.kind === 'mount') {
        boundaries.add(full)
        continue
      }
      push(owners, e.guid, session.room)
      push(paths, full, session.room)
      claimedBy.set(full, mountPath)
    }
  }
  for (const [guid, rooms] of owners) {
    if (rooms.length > 1) problems.push(`guid ${guid} in rooms ${rooms.join(', ')}`)
  }
  for (const [path, rooms] of paths) {
    if (rooms.length > 1) problems.push(`path ${path} in rooms ${rooms.join(', ')}`)
    for (const b of boundaries) {
      // A mount's OWN files live under its own root by construction; the
      // violation is another map claiming a path inside someone's boundary.
      if (claimedBy.get(path) === b) continue
      if (path === b || path.startsWith(`${b}/`)) problems.push(`path ${path} under mount root ${b}`)
    }
  }
  const descPaths = new Set(input.descs.filter((d) => d.path !== '').map((d) => d.path))
  const registryPaths = new Set(input.mounts.map((m) => m.mountPath).filter((p) => p !== ''))
  for (const p of descPaths) {
    if (!registryPaths.has(p)) problems.push(`desc at '${p}' has no live mount`)
  }
  for (const p of registryPaths) {
    if (!descPaths.has(p)) problems.push(`live mount at '${p}' has no desc`)
  }
  const expected = mountRootsFrom(input.descs, rootEntries)
  for (const p of expected) if (!input.ignore.has(p)) problems.push(`ignore set is missing '${p}'`)
  for (const p of input.ignore) if (!expected.has(p)) problems.push(`ignore set has stale '${p}'`)
  return problems
}
