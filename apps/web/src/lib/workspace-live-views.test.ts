/**
 * The open-doc refcount, in the shim that owns it (tab-groups B3, spike S9).
 *
 * `libs/workspace`'s `multi-view-lifecycle.test.ts` drives the seam from the
 * mount side with a model of this collapse step; what it cannot reach is the
 * PRODUCTION one — `setLiveViews`'s per-mount diff, the `mounted` guard, and
 * the drop/reapply pair the mount surgeries bracket themselves with. That is
 * the half where a note can be left live in a pane and closed in the vault,
 * which is the reconciler materializing over a live buffer (golden rule 1,
 * R4.1), so it is tested here against the real `setupWorkspace`.
 *
 * The probe is the lifecycle pair itself, tapped on `VaultSession` across
 * every mount: the real implementations still run, so what is asserted is
 * what the policy DID, not what a stub was asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemStorage } from './storage.fixture.js'
import { createYjsEngine } from '@ohhi/sync'
import {
  docBlobName,
  FOLDER_DOC_KEY,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedStoreDir,
  VaultSession,
} from '@ohhi/vault'
import { MountSession } from '@ohhi/workspace'
import { setOperatorSecret, setRoomToken } from './config.js'
import { encodeShareLink } from './share-link.js'
import { setupWorkspace, type Workspace } from './workspace.svelte.js'

beforeEach(() => useMemStorage())

const enc = new TextEncoder()
const ROOM = 'team-room'
const RELAY = 'ws://relay.test'

const FILES: Record<string, string> = {
  'keep.md': 'root note\n',
  'team/plan.md': 'shared plan\n',
  'team/notes/deep.md': 'nested note\n',
}

let open: Workspace | null = null
let life: Lifecycle | null = null
afterEach(() => {
  life?.restore()
  life = null
  open?.dispose()
  open = null
  vi.unstubAllGlobals()
})

interface Lifecycle {
  calls: { op: 'open' | 'closed'; guid: string }[]
  /** Net state per guid — what the vault believes right now; survives `reset`. */
  state: (guid: string) => 'open' | 'closed'
  reset: () => void
  restore: () => void
}

/** Tap markOpen/markClosed across every VaultSession this vault runs. */
function tapLifecycle(): Lifecycle {
  const calls: { op: 'open' | 'closed'; guid: string }[] = []
  const net = new Map<string, 'open' | 'closed'>()
  const realOpen = VaultSession.prototype.markOpen
  const realClosed = VaultSession.prototype.markClosed
  VaultSession.prototype.markOpen = function (guid: string): void {
    calls.push({ op: 'open', guid })
    net.set(guid, 'open')
    realOpen.call(this, guid)
  }
  VaultSession.prototype.markClosed = async function (guid: string): Promise<void> {
    calls.push({ op: 'closed', guid })
    net.set(guid, 'closed')
    await realClosed.call(this, guid)
  }
  return {
    calls,
    state: (guid) => net.get(guid) ?? 'closed',
    reset: () => calls.splice(0, calls.length),
    restore: () => {
      VaultSession.prototype.markOpen = realOpen
      VaultSession.prototype.markClosed = realClosed
    },
  }
}

/** Who was told what, so "a session out of the registry is never spoken to" is checkable. */
function tapSetOpenPaths(): { calls: { session: MountSession; rels: string[] }[]; restore: () => void } {
  const calls: { session: MountSession; rels: string[] }[] = []
  const real = MountSession.prototype.setOpenPaths
  MountSession.prototype.setOpenPaths = function (rels: ReadonlySet<string>): void {
    calls.push({ session: this, rels: [...rels] })
    real.call(this, rels)
  }
  return {
    calls,
    restore: () => {
      MountSession.prototype.setOpenPaths = real
    },
  }
}

async function seeded(): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(FILES)) await adapter.writeAtomic(path, enc.encode(text))
  return adapter
}

/** A plain vault, no mounts. */
async function boot(): Promise<Workspace> {
  const ws = await setupWorkspace({
    adapter: await seeded(),
    storeDir: new MemStoreDir(),
    user: 'T',
    room: 'root-room',
  })
  open = ws
  return ws
}

/**
 * A vault with `team/` already a mount this device holds no key for — the
 * shape `addMountLink` acts on (device-link N1), seeded exactly as
 * `workspace-mounts.test.ts` seeds it: the namespace carries the room's own
 * guid for `plan.md`, so a later paste MERGES in place (a pull needs a live
 * relay, which a unit test has not got).
 */
const PLAN_GUID = '11111111-2222-4333-8444-555555555555'

async function bootWithMount(): Promise<Workspace> {
  const adapter = await seeded()
  const storeDir = new MemStoreDir()
  await new MountsFile(storeDir.io('mounts.json')).save([
    { room: ROOM, path: 'team', provenance: 'adopted', relay: { url: RELAY }, status: 'needs-token' },
  ])
  const engine = createYjsEngine()
  const seed = engine.createDoc('live-views-seed')
  seed.transactMap((m) => m.set('plan.md', { guid: PLAN_GUID, kind: 'text' }), 'seed')
  await scopedStoreDir(storeDir, `${ROOM}/`)
    .io(docBlobName(FOLDER_DOC_KEY))
    .writeAtomic(engine.encodeUpdateSince(seed, null))
  seed.destroy()
  const ws = await setupWorkspace({ adapter, storeDir, user: 'T', room: 'root-room' })
  open = ws
  return ws
}

const guidOf = (ws: Workspace, path: string): string =>
  ws.ui.files.find((f) => f.path === path)!.guid

/** The mint the carve does first; no relay is reachable from a unit test. */
function stubMint(): void {
  setOperatorSecret('test-secret')
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ token: 'carved-token', folderGuid: 'x', readOnly: false, label: null }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  )
}

describe('setLiveViews: the per-mount diff (S9 Q1/Q2)', () => {
  it('opens on 0→1, closes on 1→0, and says nothing when the set is unchanged', async () => {
    const ws = await boot()
    life = tapLifecycle()
    const keep = guidOf(ws, 'keep.md')
    const plan = guidOf(ws, 'team/plan.md')

    ws.setLiveViews(new Set(['keep.md', 'team/plan.md']))
    expect(life.calls).toEqual([
      { op: 'open', guid: keep },
      { op: 'open', guid: plan },
    ])

    // Two panes on ONE note collapse to one member of the set, and re-sending
    // the same set is not an event: the diff is what makes the last view out
    // the one that closes the doc.
    life.reset()
    ws.setLiveViews(new Set(['keep.md', 'team/plan.md']))
    expect(life.calls).toEqual([])

    ws.setLiveViews(new Set(['keep.md']))
    expect(life.calls).toEqual([{ op: 'closed', guid: plan }])
    expect(life.state(keep)).toBe('open')

    life.reset()
    ws.setLiveViews(new Set())
    expect(life.calls).toEqual([{ op: 'closed', guid: keep }])
  })

  it('ignores a path no mount owns, rather than throwing', async () => {
    const ws = await boot()
    life = tapLifecycle()
    ws.setLiveViews(new Set(['nowhere.md', 'keep.md']))
    expect(life.calls).toEqual([{ op: 'open', guid: guidOf(ws, 'keep.md') }])
  })
})

describe('a surgery keeps the notes in the other panes live (C1)', () => {
  it('carve: the subtree moves to a new mount and its views go with it', async () => {
    stubMint()
    const ws = await boot()
    life = tapLifecycle()
    ws.setLiveViews(new Set(['keep.md', 'team/plan.md']))

    await ws.carveFolder('team')

    // The carve destroys the root's doc instances for the subtree, so the
    // view is closed on the way out — and re-opened on the mount that owns
    // it now. What must never be left behind is a pane rendering a buffer
    // the vault believes is closed.
    const plan = guidOf(ws, 'team/plan.md')
    expect(life.state(plan)).toBe('open')
    expect(life.state(guidOf(ws, 'keep.md'))).toBe('open')
    expect(ws.ui.settling).toBe(false)
  })

  it('unshare: the subtree folds back into the root and its views survive it', async () => {
    const ws = await bootWithMount()
    life = tapLifecycle()
    ws.setLiveViews(new Set(['keep.md', 'team/plan.md']))
    expect(life.state(guidOf(ws, 'team/plan.md'))).toBe('open')

    await ws.unshare('team')

    // `rebuildRoot` mints a fresh MountSession whose open set is empty. The
    // dropped views used to be replayed from a `liveViews` the drop had
    // already stripped, so this note stayed live in its pane and closed in
    // the vault — and the next write from Obsidian or git materialized over
    // the buffer (golden rule 1).
    expect(ws.ui.files.map((f) => f.path)).toContain('team/plan.md')
    expect(life.state(guidOf(ws, 'team/plan.md'))).toBe('open')
    expect(life.state(guidOf(ws, 'keep.md'))).toBe('open')
    expect(ws.ui.settling).toBe(false)
  })

  it('unmount: the files become the root’s and the views follow them', async () => {
    const ws = await bootWithMount()
    life = tapLifecycle()
    ws.setLiveViews(new Set(['team/plan.md']))

    await ws.unmount('team')

    expect(ws.ui.files.map((f) => f.path)).toContain('team/plan.md')
    expect(life.state(guidOf(ws, 'team/plan.md'))).toBe('open')
  })

  it('addMountLink: a merge keeps the same session, so nothing is disturbed', async () => {
    const ws = await bootWithMount()
    life = tapLifecycle()
    ws.setLiveViews(new Set(['team/plan.md']))
    const plan = guidOf(ws, 'team/plan.md')
    life.reset()

    await ws.addMountLink('team', encodeShareLink({ relay: RELAY, room: ROOM, token: 'team-token' }))

    // The merge branch replaces no session and destroys no doc: the view is
    // never released, so there is no close/open churn to see at all.
    expect(life.calls).toEqual([])
    expect(life.state(plan)).toBe('open')
    expect(ws.ui.mounts[0]?.status).toBe('active')
  })

  it('never speaks to a session that has left the registry', async () => {
    const ws = await bootWithMount()
    life = tapLifecycle()
    const told = tapSetOpenPaths()
    try {
      ws.setLiveViews(new Set(['team/plan.md', 'keep.md']))
      const root = told.calls.find((c) => c.rels.includes('keep.md'))!.session
      const mount = told.calls.find((c) => c.rels.includes('plan.md'))!.session
      expect(mount).not.toBe(root)

      // The shell goes on deriving its live set while the surgery runs — a
      // tab switch, a pane closing — and BOTH of these sessions are torn down
      // half-way through it. `doUnshare` releases the views and takes both
      // sessions out of the registry SYNCHRONOUSLY, before its first await, so
      // by the time this promise is in hand every call below is in the gap.
      const surgery = ws.unshare('team')
      const gap = told.calls.length
      ws.setLiveViews(new Set(['keep.md']))
      ws.setLiveViews(new Set(['keep.md', 'team/plan.md']))
      await surgery
      ws.setLiveViews(new Set(['keep.md']))

      // Nothing in or after that gap may speak to the old sessions: their
      // docs are destroyed and their stores are gone, so a `setOpenPaths`
      // would run `reconcileClosedDoc` against a dead session — writing, or
      // failing to write, on behalf of a mount that no longer exists.
      const dead = new Set([root, mount])
      expect(told.calls.slice(gap).some((c) => dead.has(c.session))).toBe(false)
      // The replacement root IS spoken to, so this is not vacuous.
      expect(told.calls.slice(gap).some((c) => !dead.has(c.session))).toBe(true)
    } finally {
      told.restore()
    }
  })
})

describe('ui.settling (M3)', () => {
  it('is true until the boot settles, and across every mount surgery', async () => {
    const ws = await bootWithMount()
    expect(ws.ui.phase).toBe('ready')
    expect(ws.ui.settling).toBe(false)

    // The shell reads this to gate anything that DELETES state derived from
    // `ui.files` — the tab prune above all — because mid-surgery the tree is
    // a partial picture of the vault.
    const seen: boolean[] = []
    const watched = ws.unshare('team').then(() => seen.push(ws.ui.settling))
    seen.push(ws.ui.settling)
    await watched
    expect(seen).toEqual([true, false])
  })
})
