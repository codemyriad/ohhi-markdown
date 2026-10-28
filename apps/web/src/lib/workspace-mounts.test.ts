/**
 * The shim's nested-mount wiring (device-link N1): `ui.mounts` as a projection
 * of mounts.json — statuses included — the derived ignore set, the mount-root
 * refusals, and `addMountLink`.
 *
 * Boots the real `setupWorkspace` over a memory adapter and a memory store
 * dir, so this is the actual wiring App.svelte gets, not a stand-in. No relay
 * is attached to the root: the peer-side machines themselves are covered by
 * libs/workspace's `nested.test.ts` against two devices.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemStorage } from './storage.fixture.js'
import {
  docBlobName,
  FOLDER_DOC_KEY,
  hashText,
  JsonFileLcaStore,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedStoreDir,
} from '@ohhi/vault'
import { createYjsEngine } from '@ohhi/sync'
import {
  isAuthRefusalForAdoptedMount,
  resolveRoomRelay,
  setupWorkspace,
  type Workspace,
} from './workspace.svelte.js'
import { roomRelay, roomToken, setDefaultRelay, setOperatorSecret, setRoomToken } from './config.js'

// A carve mints its share on the relay first; here the mint answers locally.
vi.mock('./relay-admin.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./relay-admin.js')>()),
  mintShare: async (_relay: string, _secret: string, body: { folderGuid: string }) => ({
    token: `minted-${body.folderGuid}`,
    folderGuid: body.folderGuid,
    readOnly: false,
    label: null,
    kind: 'folder',
  }),
}))
import { encodeDeviceLink, encodeShareLink } from './share-link.js'

beforeEach(() => useMemStorage())

const enc = new TextEncoder()
const ROOM = 'team-room'
const RELAY = 'ws://relay.test'

let open: Workspace | null = null
afterEach(() => {
  open?.dispose()
  open = null
})

/**
 * A vault holding one mount at `team/` whose desc says `needs-token`: the
 * peer-side adopt's resting state when this device holds no key for the room.
 *
 * The mount is SEEDED — it has a folder blob naming the room's own guid for
 * `plan.md`, which is what an adopt leaves behind when this device held the
 * subtree before someone shared it. That distinction decides what a later
 * paste does: a seeded mount merges in place (`enableSharing`), while one that
 * has never held the room pulls it (`MountDesc.neverHeld`, device-link N3).
 */
const PLAN_GUID = '11111111-2222-4333-8444-555555555555'

async function bootWithNeedsToken(): Promise<Workspace> {
  const adapter = new MemVaultAdapter()
  await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
  await adapter.writeAtomic('team/plan.md', enc.encode('shared plan\n'))
  const storeDir = new MemStoreDir()
  await new MountsFile(storeDir.io('mounts.json')).save([
    { room: ROOM, path: 'team', provenance: 'adopted', relay: { url: RELAY }, status: 'needs-token' },
  ])
  const engine = createYjsEngine()
  const seed = engine.createDoc('mounts-test-seed')
  seed.transactMap((m) => m.set('plan.md', { guid: PLAN_GUID, kind: 'text' }), 'seed')
  await scopedStoreDir(storeDir, `${ROOM}/`)
    .io(docBlobName(FOLDER_DOC_KEY))
    .writeAtomic(engine.encodeUpdateSince(seed, null))
  seed.destroy()
  const ws = await setupWorkspace({ adapter, storeDir, user: 'T', room: 'root-room' })
  open = ws
  return ws
}

describe('the shim: mounts.json drives ui.mounts (N1)', () => {
  it('boots a needs-token mount as a provider-less session that still shows its files', async () => {
    const ws = await bootWithNeedsToken()

    expect(ws.ui.mounts).toEqual([
      {
        path: 'team',
        room: ROOM,
        provenance: 'adopted',
        link: null,
        status: 'needs-token',
        // Its room lives on a relay this vault has nothing to do with, so it
        // reads as somebody else's share (device-link N2, `isForeignMount`).
        foreign: true,
        // …and the room's relay is resolved once, as its session resolves it.
        relay: RELAY,
      },
    ])
    // "Keep + mark": the folder is in the tree and its note is openable — a
    // folder that vanished because a token is missing would be the dishonesty
    // golden rule 4 forbids (spike S10 Q2).
    expect(ws.ui.files.map((r) => r.path)).toContain('team/plan.md')
    expect(ws.docForPath('team/plan.md')?.getText()).toBe('shared plan\n')
    // Nothing about it reads as linked: no link, and no relay was attached.
    expect(ws.ui.linked).toBe(false)
  })

  it('refuses to carve, rename, move or delete a mount ROOT', async () => {
    const ws = await bootWithNeedsToken()
    const row = ws.ui.files.find((r) => r.path === 'team')
    // The row a mount root renders as, whether or not the vault is shared.
    expect(row?.kind).toBe('mount')

    await expect(ws.carveFolder('team')).rejects.toThrow()
    await expect(ws.renamePath('team', 'crew')).rejects.toThrow(/root of a shared folder/)
    await expect(ws.movePath('team', 'archive/team')).rejects.toThrow(/root of a shared folder/)
    await expect(ws.deletePath('team')).rejects.toThrow(/root of a shared folder/)
    // Refusing changed nothing.
    expect(ws.ui.files.map((r) => r.path)).toContain('team/plan.md')
  })

  it('addMountLink refuses a link for a different room, and activates on a matching one', async () => {
    const ws = await bootWithNeedsToken()

    await expect(
      ws.addMountLink('team', encodeShareLink({ relay: RELAY, room: 'someone-elses', token: 'x' }))
    ).rejects.toThrow(/different shared folder/)
    expect(ws.ui.mounts[0]?.status).toBe('needs-token')

    await expect(ws.addMountLink('nope', 'editor1:whatever')).rejects.toThrow()

    // The right link activates the mount IN PLACE: same session, same guids,
    // nothing re-seeded — enableSharing attaches providers to the docs it
    // already holds (spike S10 Q2).
    const guidBefore = ws.ui.files.find((r) => r.path === 'team/plan.md')!.guid
    await ws.addMountLink('team', encodeShareLink({ relay: RELAY, room: ROOM, token: 'team-token' }))
    expect(ws.ui.mounts[0]?.status).toBe('active')
    expect(ws.ui.files.find((r) => r.path === 'team/plan.md')!.guid).toBe(guidBefore)
    expect(ws.docForPath('team/plan.md')?.getText()).toBe('shared plan\n')
  })
})

/**
 * R5's credential rule (device-link-shaping R5, spike S10 Q2), stated as a
 * table rather than driven through a socket: `resolveRoomRelay` IS what
 * `relayForRoom` runs, so a row here is a claim about what this device would
 * actually send, and to whom.
 */
describe('resolveRoomRelay: which credential reaches which relay (R5)', () => {
  const OURS = 'ws://relay.test'
  const THEIRS = 'wss://evil.example'
  const base = {
    rootToken: 'DEVICE-KEY',
    rootTokenKind: 'device' as const,
    rootRelayUrl: OURS,
  }

  it('an exact token for the room always wins, on any relay', () => {
    expect(
      resolveRoomRelay({ ...base, url: THEIRS, provenance: 'joined', exactToken: 'folder-tok' })
    ).toEqual({ url: THEIRS, token: 'folder-tok' })
  })

  it('falls back to the DEVICE token for a carved/adopted room on THIS vault’s relay', () => {
    for (const provenance of ['carved', 'adopted'] as const) {
      expect(resolveRoomRelay({ ...base, url: OURS, provenance, exactToken: '' })).toEqual({
        url: OURS,
        token: 'DEVICE-KEY',
      })
    }
    // Same relay, spelled differently — the normaliser, not string equality.
    // ...and the URL that comes back is the VAULT's own spelling, not the
    // entry's. They name the same relay, so this was harmless until it wasn't:
    // the entry is written by any peer of the root room, and returning its
    // spelling persisted an attacker-chosen near-match into mounts.json and
    // into every provider URL built from it. The token is the vault's; so is
    // the address it is sent to.
    expect(
      resolveRoomRelay({ ...base, url: 'ws://Relay.TEST/', provenance: 'adopted', exactToken: '' })
    ).toEqual({ url: OURS, token: 'DEVICE-KEY' })
  })

  it('NEVER sends the device token to another relay — the credential leak (A1)', () => {
    // A peer of the root room can write any `relay` it likes into a
    // `kind:'mount'` entry; the map is advisory, never an auth source (D4).
    for (const provenance of ['carved', 'adopted', 'joined', 'local'] as const) {
      expect(
        resolveRoomRelay({ ...base, url: THEIRS, provenance, exactToken: '' }),
        provenance
      ).toBeNull()
    }
  })

  it('a FOLDER root token never reaches a mount, even on this vault’s relay', () => {
    expect(
      resolveRoomRelay({
        ...base,
        rootTokenKind: 'folder',
        url: OURS,
        provenance: 'adopted',
        exactToken: '',
      })
    ).toBeNull()
  })

  it('a joined mount never uses the fallback: it is somebody else’s share', () => {
    expect(
      resolveRoomRelay({ ...base, url: OURS, provenance: 'joined', exactToken: '' })
    ).toBeNull()
  })
})

describe('addShareMount refuses a device link (A2)', () => {
  it('says to use "Link this device" instead, and joins nothing', async () => {
    const ws = await bootWithNeedsToken()
    const deviceLink = encodeDeviceLink({
      relay: RELAY,
      room: 'someone-elses-vault',
      token: 'DEVICE-KEY',
      grants: [{ room: 'bonus-room', relay: RELAY, token: 'bonus' }],
    })

    await expect(ws.addShareMount(deviceLink, 'inbox')).rejects.toThrow(/device link/i)
    // Nothing joined, and — the half that is the actual defect — no grant
    // from the refused link was merged into this device's tokens.
    expect(ws.ui.mounts.map((m) => m.path)).toEqual(['team'])
    expect(localStorage.getItem('editor:config') ?? '').not.toContain('bonus')
  })
})

describe('addShareMount refuses a destination inside another mount (M10)', () => {
  it('refuses a destination under a mount root, and persists nothing', async () => {
    const ws = await bootWithNeedsToken()
    const link = encodeShareLink({ relay: RELAY, room: 'other-room', token: 'tok' })
    await expect(ws.addShareMount(link, 'team/sub')).rejects.toThrow()
    expect(ws.ui.mounts.map((m) => m.path)).toEqual(['team'])
    // This vault has a desc for `team`, so `ui.mounts` alone catches it. The
    // case `ui.mounts` CANNOT catch — a `kind:'mount'` entry another device
    // announced that has no desc here yet — is proven at the machine, in
    // libs/workspace's `join.test.ts` ("the ROOT MAP's mount entries overlap
    // too"); the shim now passes `mapEntries` so both guards run.
  })
})

describe('an auth refusal degrades an ADOPTED mount to needs-token (A1)', () => {
  const REFUSAL = new Error(
    'relay rejected this token (permission-denied) — check that the share exists on the relay'
  )

  it('degrades an adopted mount, and leaves every other case alone', () => {
    const adopted = { provenance: 'adopted' as const, status: 'active' as const }
    expect(isAuthRefusalForAdoptedMount(adopted, REFUSAL)).toBe(true)

    // A mount THIS device pasted a token for: a refusal means the share was
    // revoked or deleted, and "the relay said no" is the true story to leave
    // on screen — `needs-token` would promise a paste that cannot help.
    for (const provenance of ['joined', 'carved', 'local'] as const) {
      expect(isAuthRefusalForAdoptedMount({ provenance, status: 'active' }, REFUSAL)).toBe(false)
    }
    // Already resting there: no repeated status write, no churn.
    expect(isAuthRefusalForAdoptedMount({ ...adopted, status: 'needs-token' }, REFUSAL)).toBe(false)
    // Any other error is just an error.
    expect(isAuthRefusalForAdoptedMount(adopted, new Error('disk full'))).toBe(false)
    expect(isAuthRefusalForAdoptedMount(undefined, REFUSAL)).toBe(false)
  })
})

describe('unshare / unmount clear the room’s credential (A4)', () => {
  it('unmount forgets the token, the relay URL and the remembered link', async () => {
    const ws = await bootWithNeedsToken()
    setRoomToken(ROOM, 'team-token', RELAY, 'folder')
    expect(roomToken(ROOM)).toBe('team-token')

    await ws.unmount('team')

    // This device gave the share up: keeping a live key for the room would
    // ride out in the next device link's grants and silently reconnect the
    // moment a mount entry for it reappeared.
    expect(roomToken(ROOM)).toBe('')
    expect(roomRelay(ROOM)).toBe('')
    expect(ws.ui.mounts).toEqual([])
  })

  it('unshare forgets it too — the room is dissolved', async () => {
    const ws = await bootWithNeedsToken()
    setRoomToken(ROOM, 'team-token', RELAY, 'folder')

    await ws.unshare('team')

    expect(roomToken(ROOM)).toBe('')
    expect(roomRelay(ROOM)).toBe('')
    expect(ws.ui.mounts).toEqual([])
    // The content folded back into the vault, as unshare always does.
    expect(ws.ui.files.map((r) => r.path)).toContain('team/plan.md')
  })

  it('unshare rebuilds every root note’s doc, and their undo stacks follow the new instances', async () => {
    const ws = await bootWithNeedsToken()
    ws.setLiveViews(new Set(['keep.md']))
    const before = ws.undoManagerFor('keep.md')!
    expect(before.doc).toBe(ws.docForPath('keep.md')!.raw())

    await ws.unshare('team')

    // keep.md is outside the unshared folder, but the root was rebuilt: a new
    // doc instance under the same guid. Its undo manager must record THAT
    // doc — one bound to the destroyed instance undoes nothing anyone sees.
    const doc = ws.docForPath('keep.md')!
    const after = ws.undoManagerFor('keep.md')!
    expect(after.doc).toBe(doc.raw())
    const text = (doc.raw() as { getText(name: string): { insert(at: number, s: string): void } }).getText('content')
    text.insert(0, 'typed ')
    expect(doc.getText()).toBe('typed root note\n')
    after.undo()
    expect(doc.getText()).toBe('root note\n')
  })
})

/**
 * A mount's own boot can trip the mass-change breaker (more than 20 files
 * written into the shared folder while the app was closed — an agent's batch).
 * The batch is held by the MOUNT's session, raised from inside
 * `MountSession.create` before the shim registers it, so Apply must reach that
 * session — not fall through to the root, which holds no batch (a silent
 * no-op that brought the same dialog back on every launch).
 */
describe('a breaker raised by a mount’s boot is applied by that mount', () => {
  it('enrols every held file on Apply, and the tree shows them', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
    await adapter.writeAtomic('team/plan.md', enc.encode('shared plan\n'))
    const storeDir = new MemStoreDir()
    await new MountsFile(storeDir.io('mounts.json')).save([
      { room: ROOM, path: 'team', provenance: 'adopted', relay: { url: RELAY }, status: 'needs-token' },
    ])
    const engine = createYjsEngine()
    const seed = engine.createDoc('breaker-test-seed')
    seed.transactMap((m) => m.set('plan.md', { guid: PLAN_GUID, kind: 'text' }), 'seed')
    await scopedStoreDir(storeDir, `${ROOM}/`)
      .io(docBlobName(FOLDER_DOC_KEY))
      .writeAtomic(engine.encodeUpdateSince(seed, null))
    seed.destroy()
    // 21 notes the mount has never seen: one over the threshold.
    const added = Array.from({ length: 21 }, (_, i) => `team/new/note-${i}.md`)
    for (const p of added) await adapter.writeAtomic(p, enc.encode(`${p}\n`))

    const ws = await setupWorkspace({ adapter, storeDir, user: 'T', room: 'root-room' })
    open = ws

    expect(ws.ui.breaker?.paths).toEqual(expect.arrayContaining(added))
    expect(ws.ui.files.map((r) => r.path)).not.toContain(added[0])

    await ws.confirmBreaker()

    expect(ws.ui.breaker).toBeNull()
    const paths = ws.ui.files.map((r) => r.path)
    for (const p of added) expect(paths).toContain(p)
    expect(ws.docForPath(added[0]!)?.getText()).toBe(`${added[0]}\n`)
  })
})

/**
 * The same owner question for a REVIEW. A note whose disk copy moved past
 * the ingest ratio while the app was closed is raised from inside
 * `MountSession.create` too, and resolving it must reach the mount's
 * session: the root holds no doc for the guid, and routing it there threw
 * `resolveReview: unknown doc` behind a modal that cannot be dismissed
 * (dogfood 2026-10-23).
 */
describe('a review raised by a mount’s boot is resolved by that mount', () => {
  it('routes resolveReview to the mount, and the chosen text lands in the doc and on disk', async () => {
    const base = `# Plan\n\n${'a line of the shared plan, as this device last saw it\n'.repeat(6)}`
    const rewritten = `# Plan, rewritten\n\n${'an agent replaced every line while the app was closed\n'.repeat(10)}`
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
    await adapter.writeAtomic('team/plan.md', enc.encode(rewritten))
    const storeDir = new MemStoreDir()
    await new MountsFile(storeDir.io('mounts.json')).save([
      { room: ROOM, path: 'team', provenance: 'adopted', relay: { url: RELAY }, status: 'needs-token' },
    ])
    const engine = createYjsEngine()
    const mountDir = scopedStoreDir(storeDir, `${ROOM}/`)
    const seed = engine.createDoc('review-test-seed')
    seed.transactMap((m) => m.set('plan.md', { guid: PLAN_GUID, kind: 'text' }), 'seed')
    await mountDir.io(docBlobName(FOLDER_DOC_KEY)).writeAtomic(engine.encodeUpdateSince(seed, null))
    seed.destroy()
    // The note's durable state as the last boot left it: a doc holding the
    // base, and an LCA saying disk held the base too.
    const note = engine.createDoc(PLAN_GUID)
    note.transact((t) => t.insert(0, base), 'seed')
    await mountDir.io(docBlobName(PLAN_GUID)).writeAtomic(engine.encodeUpdateSince(note, null))
    await new JsonFileLcaStore(mountDir.io('lca.json')).put({
      guid: PLAN_GUID,
      path: 'plan.md',
      baseText: base,
      contentHash: hashText(base),
      heads: engine.encodeHeads(engine.heads(note)),
      eol: 'lf',
      bom: false,
    })
    note.destroy()

    const ws = await setupWorkspace({ adapter, storeDir, user: 'T', room: 'root-room' })
    open = ws

    const review = ws.ui.reviews.find((r) => r.guid === PLAN_GUID)
    expect(review?.reason).toBe('ratio-threshold')
    expect(review?.theirs).toBe(rewritten)

    await ws.resolveReview(PLAN_GUID, rewritten)

    expect(ws.ui.reviews).toEqual([])
    expect(ws.docForPath('team/plan.md')?.getText()).toBe(rewritten)
    expect(new TextDecoder().decode((await adapter.read('team/plan.md'))!)).toBe(rewritten)
  })
})

/**
 * Live enrol-on-create through the host (agents are first-class writers,
 * `agent-surface-shaping`): a note written into a mount's folder from outside
 * while the workspace runs appears in the tree at once — owned by the mount,
 * not also by the root — instead of after the next launch.
 */
describe('a file written into a mount’s folder while running shows up in the tree', () => {
  it('enrols it in the mount, once', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
    await adapter.writeAtomic('team/plan.md', enc.encode('shared plan\n'))
    const storeDir = new MemStoreDir()
    await new MountsFile(storeDir.io('mounts.json')).save([
      { room: ROOM, path: 'team', provenance: 'adopted', relay: { url: RELAY }, status: 'needs-token' },
    ])
    const engine = createYjsEngine()
    const seed = engine.createDoc('live-enrol-seed')
    seed.transactMap((m) => m.set('plan.md', { guid: PLAN_GUID, kind: 'text' }), 'seed')
    await scopedStoreDir(storeDir, `${ROOM}/`)
      .io(docBlobName(FOLDER_DOC_KEY))
      .writeAtomic(engine.encodeUpdateSince(seed, null))
    seed.destroy()
    const ws = await setupWorkspace({ adapter, storeDir, user: 'T', room: 'root-room' })
    open = ws

    adapter.externalWrite('team/from-agent.md', enc.encode('written by an agent\n'))
    for (let i = 0; i < 50 && !ws.ui.files.some((r) => r.path === 'team/from-agent.md'); i++) {
      await new Promise((r) => setTimeout(r, 5))
    }

    expect(ws.ui.files.filter((r) => r.path === 'team/from-agent.md')).toHaveLength(1)
    expect(ws.docForPath('team/from-agent.md')?.getText()).toBe('written by an agent\n')
  })
})

/** Run `work`, noting every value `look` takes while it runs (microtask by microtask). */
async function watchWhile<T>(work: Promise<unknown>, look: () => T): Promise<T[]> {
  const seen: T[] = []
  let done = false
  void work.finally(() => (done = true)).catch(() => {})
  for (let turn = 0; !done; turn++) {
    seen.push(look())
    // Mostly microtasks (the surgery's own awaits), and now and then a task,
    // so a wait on real I/O is not starved.
    if (turn % 50 === 49) await new Promise((r) => setTimeout(r, 0))
    else await Promise.resolve()
  }
  await work
  return seen
}

describe('a note open while its folder is shared (carve)', () => {
  it('resolves to the new mount’s doc, and tells the views to re-resolve', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
    await adapter.writeAtomic('team/plan.md', enc.encode('shared plan\n'))
    setOperatorSecret('operator-secret')
    // Nothing listens there: the new mount's socket just keeps retrying.
    setDefaultRelay(RELAY)
    const ws = await setupWorkspace({ adapter, storeDir: new MemStoreDir(), user: 'T', room: 'root-room' })
    open = ws
    ws.setLiveViews(new Set(['team/plan.md']))
    const before = ws.docForPath('team/plan.md')
    expect(before?.getText()).toBe('shared plan\n')
    const epoch = ws.ui.docsEpoch ?? 0

    await ws.carveFolder('team')

    const after = ws.docForPath('team/plan.md')
    // The path is the same; the doc is the NEW mount's instance, and a view
    // still holding `before` would type into a doc nobody syncs.
    expect(after).not.toBeNull()
    expect(after).not.toBe(before)
    expect(after?.getText()).toBe('shared plan\n')
    expect(ws.ui.docsEpoch).toBeGreaterThan(epoch)
    expect(ws.ui.mounts.map((m) => m.path)).toEqual(['team'])
  })

  it('holds the subtree’s open notes read-only while the carve replaces their docs', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
    await adapter.writeAtomic('team/plan.md', enc.encode('shared plan\n'))
    setOperatorSecret('operator-secret')
    setDefaultRelay(RELAY)
    const ws = await setupWorkspace({ adapter, storeDir: new MemStoreDir(), user: 'T', room: 'root-room' })
    open = ws
    ws.setLiveViews(new Set(['team/plan.md', 'keep.md']))

    const seen = await watchWhile(ws.carveFolder('team'), () => [...(ws.ui.frozen ?? [])])

    // The pane on team/plan.md still shows the root's instance, which the
    // carve flushes and destroys: anything typed into it then would be gone
    // at the remount, so the view is read-only for the surgery — and only the
    // surgery's subtree, and only until it is over.
    expect(seen.some((f) => f.includes('team'))).toBe(true)
    expect(seen.every((f) => f.every((p) => p === 'team'))).toBe(true)
    expect(ws.ui.frozen).toEqual([])
  })
})
