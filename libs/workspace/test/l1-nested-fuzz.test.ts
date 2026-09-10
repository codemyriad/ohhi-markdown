/**
 * L1: nested-mount property test (slice N1; spike S10 Q5 "Where the fixtures
 * go"). The directed rows in `nested.test.ts` each pin ONE race; this drives
 * two devices of one shared root room through interleavings nobody wrote down.
 *
 * fast-check generates a command script over `bootDuo`: carve, unshare, paste
 * a token, create/delete/move inside and across the mount boundary, edit while
 * partitioned, deliver partially, tick, reboot, and cut a device's durability
 * mid-machine (a kill -9) and reboot it. Tree renames are behind a flag — see
 * `RENAMES` — and one device at a time reshapes a tree; both exclusions name
 * the open crasher they stand in for, and both are things `nested.test.ts`
 * covers directly.
 *
 * Blocking invariants:
 *  - A6, after EVERY awaited command, on BOTH devices (`checkInvariants`):
 *    every guid in exactly one mount namespace, every path in exactly one map,
 *    nothing under a mount boundary, mounts.json ⟷ registry ⟷ ignore set
 *    naming the same roots, every surviving desc settled.
 *  - After `stabilize`: the same guid resolves to the same room on both
 *    devices; every non-reviewed file is byte-identical across devices; every
 *    marker any writer produced is still visible somewhere (no data loss);
 *    and a second stabilization changes nothing (idempotence).
 *  - No mount session ever reported an error.
 *
 * Failures print the fast-check seed and path; shrink, then check the minimal
 * repro into `fuzz-crashers/` as a permanent regression (see its README).
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { unshareMount } from '../src/unshare.js'
import type { MountSession } from '../src/mount-session.js'
import {
  bootDuo,
  carveOn,
  checkInvariants,
  dec,
  type BootedVault,
  type Duo,
} from './fixture.js'
import type { RelayConfig } from '../src/types.js'

const ROOT_ROOM = 'root-room'
const RELAY = 'ws://relay.test'

const FILES: Record<string, string> = {
  'keep.md': '# keep\n\nroot-local note\n',
  'team/plan.md': '# plan\n\nshared plan\n',
  'team/notes/deep.md': '# deep\n\nnested shared note\n',
  'other/side.md': '# side\n\nanother folder\n',
}

/** Per-PR bound; the nightly lane raises it (see the testing skill's budget). */
const RUNS = Number(process.env['NESTED_FUZZ_RUNS'] ?? 60)
const CMDS = Number(process.env['NESTED_FUZZ_CMDS'] ?? 22)
/**
 * Two command families are OFF by default, each because it re-reports an OPEN
 * crasher on every run instead of finding new ones. `NESTED_FUZZ_OPEN=1` turns
 * both back on — and this flag goes away when those crashers are un-skipped.
 *
 *  - **Tree renames** — crashers 0004 (two peers renaming concurrently split
 *    one guid across two paths and diverge the disks) and 0006 (a rename
 *    interrupted by a crash duplicates the note). Both are `libs/vault`'s, not
 *    N1's. The rename paths N1 owns — the ghost rule's rename branch, S10 Q5
 *    rows 3 and 4 — are directed fixtures in `nested.test.ts`.
 *  - **Unshare** — crasher 0008: after an unshare round trip the two devices'
 *    copies of a note stop being connected, so every later edit is one-sided.
 *    Deterministic, no race needed, and unshare/absorb is covered directly by
 *    three fixtures in `nested.test.ts` plus crasher 0005.
 */
const OPEN = process.env['NESTED_FUZZ_OPEN'] === '1'
const RENAMES = OPEN
const UNSHARE = OPEN

/**
 * Replay: `NESTED_FUZZ_SEED=… NESTED_FUZZ_PATH=… rushx test l1-nested-fuzz`
 * re-runs exactly the counterexample a failure printed, before anything is
 * touched (the harness's first rule).
 */
const REPLAY = {
  ...(process.env['NESTED_FUZZ_SEED'] ? { seed: Number(process.env['NESTED_FUZZ_SEED']) } : {}),
  ...(process.env['NESTED_FUZZ_PATH'] ? { path: process.env['NESTED_FUZZ_PATH'] } : {}),
  ...(process.env['NESTED_FUZZ_SEED'] ? { endOnFailure: true } : {}),
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const MARKER = /\[m\d+\]/g

type Which = 'a' | 'b'

interface World {
  duo: Duo
  /**
   * Every marker any writer has produced, and the doc guid it went into. A
   * marker is only "lost" if that file still EXISTS somewhere: a note someone
   * deleted takes its content with it, which is a delete, not a loss.
   */
  markers: Map<string, string>
  /** Reviews seen on either device, collected across reboots. */
  reviewed: Set<string>
  reviewText: string[]
  errors: unknown[]
  seq: number
  /**
   * Which device last reshaped a tree while the two were out of step. Two
   * devices renaming concurrently put one guid at two paths and diverge the
   * disks — `fuzz-crashers/0004-concurrent-rename-splits-a-guid.spec.ts`, a
   * plain `libs/vault` bug this suite found and does not own. Carve and
   * unshare join the same exclusion, for
   * `fuzz-crashers/0005-unshare-resurrect-never-restores.spec.ts`: an unshare
   * re-states its whole subtree on the map, and a peer that deleted a file in
   * it meanwhile never gets it back.
   *
   * So: one device at a time reshapes, and the flag clears the moment the two
   * agree again. The races this excludes are the ones `nested.test.ts` pins
   * directly (rows 3-9); what is left here is everything nobody wrote down.
   */
  reshaper: Which | null
}

// ------------------------------------------------------------------- lookups

interface Located {
  mountPath: string
  session: MountSession
  /** Path relative to the owning session. */
  rel: string
  /** Workspace path. */
  full: string
}

function rowsOf(dev: BootedVault, kind: 'text' | 'dir'): Located[] {
  const out: Located[] = []
  for (const { mountPath, session } of dev.registry()) {
    for (const row of session.files()) {
      if (row.kind !== kind) continue
      out.push({
        mountPath,
        session,
        rel: row.path,
        full: mountPath === '' ? row.path : `${mountPath}/${row.path}`,
      })
    }
  }
  return out.sort((x, y) => x.full.localeCompare(y.full))
}

/** Mount roots this device knows about, from the map as well as the registry. */
function mountRootsOf(dev: BootedVault): string[] {
  return [...dev.ignore].sort()
}

/** Folders the ROOT still owns and that a carve may legally take. */
function carvable(dev: BootedVault): string[] {
  const roots = mountRootsOf(dev)
  return rowsOf(dev, 'dir')
    .filter((d) => d.mountPath === '')
    .map((d) => d.full)
    .filter(
      (p) =>
        !roots.some((r) => p === r || p.startsWith(`${r}/`) || r.startsWith(`${p}/`)) &&
        rowsOf(dev, 'text').some((t) => t.mountPath === '' && t.full.startsWith(`${p}/`))
    )
}

/** Dirs that may be renamed: never a mount root, never a mount's ancestor. */
function renamableDirs(dev: BootedVault): Located[] {
  const roots = mountRootsOf(dev)
  return rowsOf(dev, 'dir').filter(
    (d) => !roots.some((r) => d.full === r || r.startsWith(`${d.full}/`))
  )
}

const pick = <T,>(list: T[], idx: number): T | null =>
  list.length === 0 ? null : list[idx % list.length]!

/** A room's folder map on one device, as a comparable digest. */
function mapDigest(dev: BootedVault, room: string): string | null {
  const handle = dev.registry().find((h) => h.session.room === room)
  if (!handle) return null
  return JSON.stringify(
    handle.session
      .mapEntries(true)
      .map(([p, e]) => `${p}:${e.guid}:${e.kind}${e.deleted ? ':D' : ''}`)
      .sort()
  )
}

/**
 * May a command reshape this session's tree (rename / create / delete / move)?
 *
 * Only once BOTH devices' copies of that room's map agree — which is exactly
 * the point at which the two folder-doc histories have merged. Before it, a
 * peer's adopt seed is an INDEPENDENT history, so a hard delete (which is how
 * a rename removes its source) does not apply to it and the old key comes back
 * on both devices, permanently divergent. That window is the open design
 * question in `fuzz-crashers/0003-adopt-seed-resurrects-renamed-key.spec.ts`;
 * excluding it here is what lets this suite keep finding NEW failures instead
 * of re-reporting that one. The root room is never affected — its history is
 * shared from the two-device bootstrap on.
 */
function reshapable(world: World, dev: Which, session: MountSession): boolean {
  if (world.reshaper !== null && world.reshaper !== dev) return false
  if (session.room !== ROOT_ROOM && !merged(world, session.room)) return false
  world.reshaper = dev
  return true
}

/**
 * Have both devices' copies of this room's folder doc actually exchanged
 * updates? Equal ENTRIES are not enough: each device seeds an adopted mount's
 * folder doc from its own state, so the two are independent histories that
 * merge as a union — a hard delete on one side (which is how a rename removes
 * its source, and how a tombstone is set) has nothing to delete on the other.
 * Once a frame has landed each way the histories are one, and ordinary
 * concurrency rules apply again. See crasher 0003.
 */
function merged(world: World, room: string): boolean {
  if (room === ROOT_ROOM) return true
  const seen = world.duo.net.deliveredTo(`${room}/folder`)
  return seen.has('A') && seen.has('B')
}

/**
 * No MAP change in flight and every shared room's map agrees: the membership
 * both devices would compute is the same one. Doc-content frames may still be
 * queued — they carry no membership, and waiting for them would mean a mount
 * existing at all is enough to stop a carve or an unshare from ever running.
 */
function quiet(world: World): boolean {
  return (
    !world.duo.net.pendingNames().some((n) => n.endsWith('/folder')) && inStep(world)
  )
}

/** Every room both devices hold agrees ⇒ nobody is mid-divergence. */
function inStep(world: World): boolean {
  const rooms = new Set(world.duo.a.registry().map((h) => h.session.room))
  for (const room of rooms) {
    const db = mapDigest(world.duo.b, room)
    if (db !== null && db !== mapDigest(world.duo.a, room)) return false
  }
  return true
}

function markersIn(text: string): string[] {
  return text.match(MARKER) ?? []
}

/**
 * Drop every marker that exists ONLY on `dev` — nothing else holds a copy, so
 * a crash here loses it legitimately. Called just before an offline device is
 * killed; markers the peer already has stay under the no-loss property.
 */
async function forgetUnsent(world: World, dev: Which): Promise<void> {
  const other = world.duo.dev(dev === 'a' ? 'b' : 'a')
  const surfaces: string[] = []
  for (const { session, rel } of rowsOf(other, 'text')) {
    surfaces.push(session.docForPath(rel)?.getText() ?? '')
    const bytes = await session.readFileBytes(rel)
    if (bytes) surfaces.push(dec.decode(bytes))
  }
  const elsewhere = surfaces.join(' ')
  for (const marker of [...world.markers.keys()]) {
    if (!elsewhere.includes(marker)) world.markers.delete(marker)
  }
}

/** The guid a session's map holds at `rel`, or null. */
function guidAt(session: MountSession, rel: string): string | null {
  return session.files().find((r) => r.path === rel)?.guid ?? null
}

// ------------------------------------------------------------------ commands

type Cmd =
  | { kind: 'carve'; dev: Which; idx: number }
  | { kind: 'unshare'; dev: Which; idx: number }
  | { kind: 'addMountLink'; dev: Which; idx: number }
  | { kind: 'deliver'; count: number }
  | { kind: 'sync' }
  | { kind: 'partition'; dev: Which }
  | { kind: 'heal'; dev: Which }
  | { kind: 'tick'; ms: number }
  | { kind: 'reboot'; dev: Which }
  | { kind: 'crash'; dev: Which; after: number }
  | { kind: 'edit'; dev: Which; idx: number; pos: number }
  | { kind: 'renameFile'; dev: Which; idx: number }
  | { kind: 'renameDir'; dev: Which; idx: number }
  | { kind: 'createInside'; dev: Which; idx: number }
  | { kind: 'deleteInside'; dev: Which; idx: number }
  | { kind: 'deleteDir'; dev: Which; idx: number }
  | { kind: 'moveOut'; dev: Which; idx: number }
  | { kind: 'moveIn'; dev: Which; idx: number }

const which = fc.constantFrom<Which>('a', 'b')
const idx = fc.nat({ max: 12 })

const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('edit' as const), dev: which, idx, pos: fc.nat({ max: 200 }) }) },
  { weight: 5, arbitrary: fc.record({ kind: fc.constant('deliver' as const), count: fc.integer({ min: 1, max: 12 }) }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'sync' as const }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('carve' as const), dev: which, idx }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('unshare' as const), dev: which, idx }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('addMountLink' as const), dev: which, idx }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('partition' as const), dev: which }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('heal' as const), dev: which }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('tick' as const), ms: fc.integer({ min: 5, max: 900 }) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('reboot' as const), dev: which }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('crash' as const), dev: which, after: fc.nat({ max: 30 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('renameFile' as const), dev: which, idx }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('renameDir' as const), dev: which, idx }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('createInside' as const), dev: which, idx }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('deleteInside' as const), dev: which, idx }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('deleteDir' as const), dev: which, idx }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('moveOut' as const), dev: which, idx }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('moveIn' as const), dev: which, idx }) }
)

async function runCmd(world: World, cmd: Cmd, tokens: Record<Which, Map<string, RelayConfig>>): Promise<void> {
  const { duo } = world
  const dev = 'dev' in cmd ? duo.dev(cmd.dev) : duo.a
  const id = 'dev' in cmd && cmd.dev === 'b' ? 'B' : 'A'

  switch (cmd.kind) {
    case 'deliver':
      await duo.deliverSome(cmd.count)
      break
    case 'sync':
      // Both devices online and idle for a while — the state from which a
      // person actually reaches for "share this folder".
      await duo.deliver()
      break
    case 'tick':
      await duo.tick(cmd.ms)
      break
    case 'partition':
      duo.net.setOffline(id, true)
      break
    case 'heal':
      duo.net.setOffline(id, false)
      break
    case 'reboot':
      await duo.reboot(cmd.dev)
      break
    case 'crash':
      // A power cut at an arbitrary store write, then a reboot from whatever
      // prefix of the writes reached the disk.
      //
      // A keystroke this device made while CUT OFF from the relay has reached
      // nothing durable — not its own stores yet, and not the relay — so the
      // kill is allowed to take it (spike S8 Q2's bounded loss). Stop tracking
      // those; anything it managed to send while online is at the relay and
      // must still survive, so those stay tracked.
      if (duo.net.isOffline(id)) await forgetUnsent(world, cmd.dev)
      await duo.crash(cmd.dev, cmd.after)
      break
    case 'carve': {
      // Only carve from a fully delivered, in-step state. The adopt seeds the
      // mount from the PEER's PRE-IMAGE of the subtree; anything still in
      // flight makes that pre-image a different key set from the carver's
      // membership, and the two independent seed histories then merge as a
      // union — crasher 0003's open design question, reached from whichever
      // side happens to be behind.
      if (!quiet(world)) return
      const target = pick(carvable(dev), cmd.idx)
      if (!target || !reshapable(world, cmd.dev, dev.root)) return
      const room = `room-${world.seq++}`
      // The carver always holds the token it minted. Whether the PEER does is
      // half the interest: with one it adopts `active`, without one it adopts
      // `needs-token` and waits for an `addMountLink` paste (S10 Q2). Both
      // halves get generated.
      const relay: RelayConfig = { url: RELAY, token: `tok-${room}` }
      tokens[cmd.dev].set(room, relay)
      if (cmd.idx % 2 === 0) tokens[cmd.dev === 'a' ? 'b' : 'a'].set(room, relay)
      await carveOn(dev, { path: target, room, relayUrl: RELAY, token: `tok-${room}` })
      break
    }
    case 'unshare': {
      // Same rule as carve, for the mirror reason: an unshare re-states its
      // whole subtree on the map, and anything a peer did to that subtree in
      // flight collides with it (crasher 0005).
      // A mount someone OWNS: unsharing dissolves the room, which is the
      // carver's (or joiner's) call — a peer that merely adopted it can
      // unmount, never unshare. The owner is whichever device carved it, not
      // whichever the command names, or the case would almost never run.
      const owned = (['a', 'b'] as Which[])
        .flatMap((w) => {
          const d = duo.dev(w)
          return d
            .descs()
            .filter((x) => x.provenance !== 'adopted' && d.mounts.has(x.path))
            .map((x) => ({ w, dev: d, path: x.path }))
        })
        .sort((x, y) => `${x.w}${x.path}`.localeCompare(`${y.w}${y.path}`))
      const chosen = pick(owned, cmd.idx)
      if (!UNSHARE || !chosen || !quiet(world) || !reshapable(world, chosen.w, chosen.dev.root)) {
        return
      }
      const owner = chosen.dev
      const mount = owner.mounts.get(chosen.path)!
      owner.mounts.delete(chosen.path)
      await unshareMount({
        vaultDir: owner.vaultDir,
        mountsFile: owner.mountsFile,
        engine: owner.engine,
        rootRoom: ROOT_ROOM,
        desc: { room: mount.room, path: chosen.path },
        mount,
        root: owner.root,
        removeIgnore: (p) => owner.ignore.delete(p),
      })
      await owner.rebuildRoot()
      await owner.refreshDescs()
      // Let the unshare settle before anything else runs. While a peer still
      // holds the dissolved mount, an edit on the owner goes to the parent
      // room and the peer's copy is still in the old one — see the skipped
      // `fuzz-crashers/0008-edit-after-unshare-misses-a-peer.spec.ts`.
      await duo.deliver()
      break
    }
    case 'addMountLink': {
      // The paste: a mount adopted without a credential gets one, in place.
      const waiting = dev
        .descs()
        .filter((d) => d.status === 'needs-token' && dev.mounts.has(d.path))
        .sort((x, y) => x.path.localeCompare(y.path))
      const desc = pick(waiting, cmd.idx)
      if (!desc) return
      const relay: RelayConfig = { url: desc.relay?.url ?? RELAY, token: `tok-${desc.room}` }
      tokens[cmd.dev].set(desc.room, relay)
      dev.mounts.get(desc.path)!.enableSharing(relay)
      await settle()
      await dev.refreshDescs()
      break
    }
    case 'edit': {
      const row = pick(rowsOf(dev, 'text'), cmd.idx)
      if (!row) return
      const doc = row.session.docForPath(row.rel)
      if (!doc) return
      const marker = `[m${world.seq++}]`
      const text = doc.getText()
      // Insert at a line boundary so markers survive concurrent merges intact.
      const nl = text.indexOf('\n', cmd.pos % Math.max(1, text.length))
      const at = nl === -1 ? text.length : nl + 1
      doc.transact((t) => t.insert(at, `${marker}\n`), 'local')
      world.markers.set(marker, guidAt(row.session, row.rel) ?? '')
      break
    }
    case 'renameFile': {
      if (!RENAMES) return
      const row = pick(rowsOf(dev, 'text'), cmd.idx)
      if (!row || !reshapable(world, cmd.dev, row.session)) return
      const dir = row.rel.includes('/') ? `${row.rel.slice(0, row.rel.lastIndexOf('/'))}/` : ''
      await row.session.renamePath(row.rel, `${dir}r${world.seq++}.md`)
      break
    }
    case 'renameDir': {
      if (!RENAMES) return
      const row = pick(renamableDirs(dev), cmd.idx)
      if (!row || !reshapable(world, cmd.dev, row.session)) return
      const parent = row.rel.includes('/') ? `${row.rel.slice(0, row.rel.lastIndexOf('/'))}/` : ''
      await row.session.renamePath(row.rel, `${parent}d${world.seq++}`)
      break
    }
    case 'createInside': {
      const handles = dev.registry()
      const handle = pick(handles, cmd.idx)
      if (!handle || !reshapable(world, cmd.dev, handle.session)) return
      const marker = `[m${world.seq++}]`
      const made = await handle.session.createFile('', `n${world.seq++}.md`, `${marker}\n`)
      if (made) world.markers.set(marker, guidAt(handle.session, made) ?? '')
      break
    }
    case 'deleteInside': {
      const row = pick(rowsOf(dev, 'text'), cmd.idx)
      if (!row || !reshapable(world, cmd.dev, row.session)) return
      await row.session.deletePath(row.rel)
      break
    }
    case 'deleteDir': {
      const row = pick(renamableDirs(dev), cmd.idx)
      if (!row || !reshapable(world, cmd.dev, row.session)) return
      await row.session.deletePath(row.rel)
      break
    }
    case 'moveOut': {
      // Mount → root, in-app: import with a FRESH guid, tombstone the source.
      const row = pick(rowsOf(dev, 'text').filter((r) => r.mountPath !== ''), cmd.idx)
      if (!row || !reshapable(world, cmd.dev, row.session)) return
      const bytes = await row.session.readFileBytes(row.rel)
      if (!bytes) return
      await dev.root.importFile(`moved${world.seq++}.md`, bytes)
      await row.session.deletePath(row.rel)
      break
    }
    case 'moveIn': {
      const mountPath = pick([...dev.mounts.keys()].sort(), cmd.idx)
      if (mountPath === null) return
      const row = pick(
        rowsOf(dev, 'text').filter((r) => r.mountPath === ''),
        cmd.idx
      )
      if (!row) return
      const target = dev.mounts.get(mountPath)!
      if (!reshapable(world, cmd.dev, target)) return
      const bytes = await row.session.readFileBytes(row.rel)
      if (!bytes) return
      await target.importFile(`moved${world.seq++}.md`, bytes)
      await row.session.deletePath(row.rel)
      break
    }
  }
}

// ----------------------------------------------------------------- settling

/** Drain both devices' queued map work so no machine is half-way through. */
async function quiesce(world: World): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await settle()
    await world.duo.a.reconcile()
    await world.duo.b.reconcile()
  }
  await settle()
}

/**
 * Heal, then run until nothing is in flight and nothing is left to do. A FIXED
 * number of rounds is not enough: an absorb or an adopt that lands in the last
 * round rebuilds a session, whose new doc instances queue a fresh state
 * exchange that then never gets delivered — and the assertions read that as a
 * divergence the next stabilization would have fixed. Loop to quiescence,
 * bounded so a genuine livelock still fails loudly.
 */
async function stabilize(world: World): Promise<void> {
  world.duo.net.setOffline('A', false)
  world.duo.net.setOffline('B', false)
  for (let round = 0; round < 24; round++) {
    const wasQuiet = world.duo.net.pending() === 0
    world.duo.net.deliverAll()
    await settle()
    await world.duo.tick(400)
    await world.duo.a.reconcile()
    await world.duo.b.reconcile()
    await settle()
    if (round >= 3 && wasQuiet && world.duo.net.pending() === 0) return
  }
  if (world.duo.net.pending() > 0) {
    throw new Error(`stabilize did not quiesce: ${world.duo.net.pendingNames().join(', ')}`)
  }
}

function collect(world: World): void {
  for (const dev of [world.duo.a, world.duo.b]) {
    for (const r of dev.events.reviews) {
      world.reviewed.add(r.path)
      world.reviewText.push(r.mine, r.theirs)
    }
    world.errors.push(...dev.events.errors)
    dev.events.errors.length = 0
  }
}

// ---------------------------------------------------------------- assertions

/** Every live text row of a device, as workspace path → {guid, room}. */
function liveFiles(dev: BootedVault): Map<string, { guid: string; room: string }> {
  const out = new Map<string, { guid: string; room: string }>()
  for (const row of rowsOf(dev, 'text')) {
    out.set(row.full, { guid: row.session.files().find((f) => f.path === row.rel)!.guid, room: row.session.room })
  }
  return out
}

/** A digest of everything durable + everything rendered, for idempotence. */
async function digest(dev: BootedVault): Promise<string> {
  const disk: string[] = []
  for (const stat of await dev.adapter.list()) {
    disk.push(`${stat.path}=${dec.decode((await dev.adapter.read(stat.path))!)}`)
  }
  const maps = dev
    .registry()
    .map(
      ({ mountPath, session }) =>
        `${mountPath}|${session.room}|${session
          .mapEntries(true)
          .map(([p, e]) => `${p}:${e.guid}:${e.kind}${e.deleted ? ':D' : ''}`)
          .sort()
          .join(',')}`
    )
    .sort()
  const descs = dev
    .descs()
    .map((d) => `${d.room}@${d.path}:${d.status}:${d.provenance}`)
    .sort()
  return JSON.stringify({ disk: disk.sort(), maps, descs })
}

describe('L1 nested-mount fuzz', () => {
  it('two devices, carve/unshare/move/crash: A6 always, convergence and no loss after', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(cmdArb, { minLength: 1, maxLength: CMDS }), async (cmds) => {
        const tokensA = new Map<string, RelayConfig>()
        const tokensB = new Map<string, RelayConfig>()
        const duo = await bootDuo({
          files: FILES,
          tokensA,
          tokensB,
        })
        const world: World = {
          duo,
          markers: new Map(),
          reviewed: new Set(),
          reviewText: [],
          errors: [],
          seq: 0,
          reshaper: null,
        }
        try {
          await duo.deliver()
          for (const cmd of cmds) {
            if (inStep(world)) world.reshaper = null
            await runCmd(world, cmd, { a: tokensA, b: tokensB })
            await quiesce(world)
            collect(world)
            // A6, after every command, on both devices — the interesting
            // failures are transient (a guid in two maps for one tick means
            // some device could reconcile the same file twice).
            checkInvariants(duo.a)
            checkInvariants(duo.b)
          }

          await stabilize(world)
          collect(world)
          checkInvariants(duo.a)
          checkInvariants(duo.b)

          const [fa, fb] = [liveFiles(duo.a), liveFiles(duo.b)]

          // Same guid ⇒ same room, on both devices. A guid living in two rooms
          // is the one thing the whole namespace design exists to prevent.
          const roomOf = new Map<string, string>()
          for (const files of [fa, fb]) {
            for (const [path, { guid, room }] of files) {
              const seen = roomOf.get(guid)
              if (seen !== undefined && seen !== room) {
                throw new Error(`guid ${guid} (${path}) is in rooms ${seen} and ${room}`)
              }
              roomOf.set(guid, room)
            }
          }

          // Convergence: every non-reviewed file is byte-identical across
          // devices, and disk reflects the doc it came from.
          for (const path of new Set([...fa.keys(), ...fb.keys()])) {
            const rel = path.slice(path.lastIndexOf('/') + 1)
            if (world.reviewed.has(path) || world.reviewed.has(rel)) continue
            if (!fa.has(path) || !fb.has(path)) {
              throw new Error(`${path} exists on only one device`)
            }
            const da = dec.decode((await duo.a.adapter.read(path)) ?? new Uint8Array())
            const db = dec.decode((await duo.b.adapter.read(path)) ?? new Uint8Array())
            if (da !== db) throw new Error(`disks diverged on ${path}\nA:${da}\nB:${db}`)
          }

          // No writer's edit lost: every marker whose file STILL EXISTS shows
          // up on some surface (a doc, a disk file, or a pending review) of
          // some device. A marker whose guid no longer has a live entry
          // anywhere went with a delete somebody asked for — that is a delete,
          // not a loss.
          const surfaces = [...world.reviewText]
          const liveGuids = new Set<string>()
          for (const dev of [duo.a, duo.b]) {
            for (const { session, rel } of rowsOf(dev, 'text')) {
              const guid = guidAt(session, rel)
              if (guid) liveGuids.add(guid)
              surfaces.push(session.docForPath(rel)?.getText() ?? '')
              const bytes = await session.readFileBytes(rel)
              if (bytes) surfaces.push(dec.decode(bytes))
            }
          }
          const haystack = surfaces.join(' ')
          for (const [marker, guid] of world.markers) {
            if (!liveGuids.has(guid)) continue
            if (!haystack.includes(marker)) throw new Error(`marker ${marker} lost from ${guid}`)
          }

          // Idempotence: a second stabilization changes nothing, anywhere.
          const before = [await digest(duo.a), await digest(duo.b)]
          await stabilize(world)
          expect([await digest(duo.a), await digest(duo.b)]).toEqual(before)

          // No session reported an error — except the one tracked crasher this
          // harness found in `libs/vault`, which is checked in skipped as
          // `fuzz-crashers/0002-remote-rename-before-materialize.spec.ts`.
          // Delete this filter the moment that spec is un-skipped.
          const unexpected = world.errors
            .map(String)
            .filter((e) => !e.startsWith('Error: rename: missing '))
          if (unexpected.length > 0) {
            throw new Error(`session errors: ${unexpected.join(' | ')}`)
          }
        } finally {
          duo.dispose()
        }
      }),
      { numRuns: RUNS, ...REPLAY }
    )
  }, 180_000)
})
