/**
 * L1 fixtures 2 & 8 (spike S8 acceptance): the reopen matrix and the boot
 * mass-change breaker. Each "reboot" builds a fresh engine + MountSession
 * over the SAME MemVaultAdapter + MemStoreDir, wired exactly like the web
 * shim (JsonFileLcaStore behind lcaGuard, BlobDocStore, FileJournal,
 * MountsFile) — proving reopen works from durable state alone: no wipe, no
 * re-enrollment, no false divergence, offline-friendly.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import {
  BlobDocStore,
  FileJournal,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedStoreDir,
  type DivergenceReview,
  type StoreDir,
  type VaultAdapter,
} from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { MountSession } from '../src/mount-session.js'
import { recoverMounts } from '../src/vault-boot.js'
import type { SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const ROOM = 'room-1'

function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

interface BootOpts {
  relay?: { url: string; token: string }
  onBreaker?: (paths: string[]) => void
}

/** One boot over persistent adapter + storeDir — the web shim's wiring. */
async function boot(adapter: VaultAdapter, storeDir: StoreDir, opts: BootOpts = {}) {
  const engine = createYjsEngine()
  const clock = new SimClock()
  const mountsFile = new MountsFile(storeDir.io('mounts.json'))
  await recoverMounts(storeDir, mountsFile, engine)
  const mountDir = scopedStoreDir(storeDir, `${ROOM}/`)
  const docStore = new BlobDocStore(engine, mountDir, clock)
  const lcaStore = lcaGuard(docStore, new JsonFileLcaStore(mountDir.io('lca.json')))
  const reviews: DivergenceReview[] = []
  const errors: unknown[] = []
  const records = new Map<string, SyncRecordFields>()
  const session = await MountSession.create({
    engine,
    adapter,
    user: { name: 'Test', color: '#000' },
    room: ROOM,
    relay: opts.relay,
    clock,
    lcaStore,
    journal: new FileJournal(mountDir, { now: () => clock.now() }),
    docStore,
    mountsFile,
    recordFor: (path) => {
      let rec = records.get(path)
      if (!rec) {
        rec = freshRecord()
        records.set(path, rec)
      }
      return rec
    },
    makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
    events: {
      onReview: (review) => reviews.push(review),
      onError: (err) => errors.push(err),
      ...(opts.onBreaker ? { onBreaker: opts.onBreaker } : {}),
    },
  })
  return { session, engine, clock, reviews, errors, records }
}

/** Adapter wrapper that records every remove() — the no-wipe assertion. */
function spyRemoves(adapter: VaultAdapter): { adapter: VaultAdapter; removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    adapter: {
      list: () => adapter.list(),
      listDirs: () => adapter.listDirs(),
      read: (p) => adapter.read(p),
      writeAtomic: (p, b, opts) => adapter.writeAtomic(p, b, opts),
      rename: (f, t) => adapter.rename(f, t),
      remove: (p) => {
        removed.push(p)
        return adapter.remove(p)
      },
      mkdir: (p) => adapter.mkdir(p),
      removeDir: (p) => {
        removed.push(p)
        return adapter.removeDir(p)
      },
      renameDir: (f, t) => adapter.renameDir(f, t),
      watch: (cb) => adapter.watch(cb),
    },
  }
}

async function seedVault(files: Record<string, string>): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(files)) {
    await adapter.writeAtomic(path, enc.encode(text))
  }
  return adapter
}

const text = async (adapter: VaultAdapter, path: string) => dec.decode((await adapter.read(path))!)

describe('boot machine — reopen matrix (L1 fixture 2)', () => {
  it('clean reopen: no wipe, stable GUIDs, no re-enrollment, no reviews', async () => {
    const base = await seedVault({ 'a.md': 'alpha', 'notes/b.md': 'beta' })
    const store = new MemStoreDir()
    const b1 = await boot(base, store)
    const guid1 = b1.session.files().find((r) => r.path === 'a.md')!.guid
    b1.session.dispose()

    const { adapter, removed } = spyRemoves(base)
    const b2 = await boot(adapter, store)
    expect(removed).toEqual([]) // the join wipe is dead
    expect(b2.session.files().find((r) => r.path === 'a.md')!.guid).toBe(guid1)
    expect(b2.session.docForPath('a.md')?.getText()).toBe('alpha')
    expect(b2.reviews).toEqual([])
    expect(b2.errors).toEqual([])
    b2.session.dispose()
  })

  it('offline external edit while closed → ingested into the CRDT, no review', async () => {
    const adapter = await seedVault({ 'a.md': 'v1\n' })
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    b1.session.dispose()

    await adapter.writeAtomic('a.md', enc.encode('v1\nplus an offline line\n'))
    const b2 = await boot(adapter, store)
    expect(b2.session.docForPath('a.md')?.getText()).toBe('v1\nplus an offline line\n')
    expect(b2.reviews).toEqual([])
    expect(await text(adapter, 'a.md')).toBe('v1\nplus an offline line\n')
    b2.session.dispose()
  })

  it('doc ahead of LCA (unflushed edit persisted by dispose) + disk edit → divergence review, disk untouched', async () => {
    const adapter = await seedVault({ 'a.md': 'base\n' })
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    // Edit the doc but never advance the clock: the disk flush debounce and
    // the LCA advance never run; dispose()'s tail flush persists the blob.
    b1.session.docForPath('a.md')!.transact((t) => t.insert(0, 'MINE '), 'local')
    b1.session.dispose()
    await new Promise((r) => setTimeout(r, 0)) // let the tail flush settle

    await adapter.writeAtomic('a.md', enc.encode('THEIRS base\n'))
    const b2 = await boot(adapter, store)
    expect(b2.reviews).toHaveLength(1)
    expect(b2.reviews[0]!.reason).toBe('three-way')
    expect(await text(adapter, 'a.md')).toBe('THEIRS base\n') // never written while unresolved
    b2.session.dispose()
  })

  it('file vanished while closed → review, never a silent tombstone', async () => {
    const adapter = await seedVault({ 'a.md': 'keep me\n', 'b.md': 'stays' })
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    b1.session.dispose()

    await adapter.remove('a.md')
    const b2 = await boot(adapter, store)
    expect(b2.reviews).toHaveLength(1)
    expect(b2.reviews[0]!.mine).toBe('keep me\n') // CRDT content preserved for the review
    expect(b2.session.files().some((r) => r.path === 'a.md')).toBe(true) // no tombstone
    b2.session.dispose()
  })

  it('new file appeared while closed → additive enroll, existing GUIDs untouched', async () => {
    const adapter = await seedVault({ 'a.md': 'old' })
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    const guid1 = b1.session.files()[0]!.guid
    b1.session.dispose()

    await adapter.writeAtomic('fresh.md', enc.encode('found on disk'))
    const b2 = await boot(adapter, store)
    expect(b2.session.docForPath('fresh.md')?.getText()).toBe('found on disk')
    expect(b2.session.files().find((r) => r.path === 'a.md')!.guid).toBe(guid1)
    expect(b2.reviews).toEqual([])
    b2.session.dispose()
  })

  it('relay-attached reopen with the relay down: boots from stores, content present', async () => {
    const adapter = await seedVault({ 'a.md': 'works offline' })
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    b1.session.dispose()

    // Nothing listens on this port — the provider retries in the background
    // while boot completes from durable state alone.
    const b2 = await boot(adapter, store, {
      relay: { url: 'ws://127.0.0.1:9', token: 'irrelevant' },
    })
    expect(b2.session.docForPath('a.md')?.getText()).toBe('works offline')
    expect(b2.session.files()).toHaveLength(1)
    b2.session.dispose()
  })
})

describe('boot machine — directory delta scan (M3)', () => {
  it('dirs appearing on disk while closed enroll; missing map dirs rematerialize', async () => {
    const adapter = await seedVault({ 'a.md': 'alpha' })
    await adapter.mkdir('seeded/empty')
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    expect(b1.session.files().find((r) => r.path === 'seeded/empty')?.kind).toBe('dir')
    b1.session.dispose()

    // While closed: a new dir appears on disk, and a map-known dir vanishes.
    await adapter.mkdir('appeared')
    await adapter.removeDir('seeded/empty')

    const b2 = await boot(adapter, store)
    // Disk → map: the new dir enrolled.
    expect(b2.session.files().find((r) => r.path === 'appeared')?.kind).toBe('dir')
    // Map → disk: the known dir was rematerialized (dirs carry no content risk).
    expect(await adapter.listDirs()).toContain('seeded/empty')
    expect(b2.errors).toEqual([])
    b2.session.dispose()
  })
})

describe('boot machine — mass-change breaker (L1 fixture 8)', () => {
  it('bulk offline changes are HELD until confirmed; confirm processes them', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`n/${String(i).padStart(2, '0')}.md`] = `file ${i}\n`
    const adapter = await seedVault(files)
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    // 25 files + the 'n' dir entry (dirs are first-class since M3).
    expect(b1.session.files().filter((r) => r.kind === 'text')).toHaveLength(25)
    b1.session.dispose()

    // A git-branch-switch shape: 22 files rewritten while the app was closed.
    for (let i = 0; i < 22; i++) {
      await adapter.writeAtomic(`n/${String(i).padStart(2, '0')}.md`, enc.encode(`switched ${i}\n`))
    }
    let breakerPaths: string[] | null = null
    const b2 = await boot(adapter, store, { onBreaker: (paths) => (breakerPaths = paths) })
    expect(breakerPaths).not.toBeNull()
    expect(breakerPaths!).toHaveLength(22)
    // Held: nothing ingested, nothing tombstoned, no reviews raised.
    expect(b2.session.docForPath('n/00.md')?.getText()).toBe('file 0\n')
    expect(b2.reviews).toEqual([])

    await b2.session.confirmBootBatch()
    expect(b2.session.docForPath('n/00.md')?.getText()).toBe('switched 0\n')
    expect(b2.reviews).toEqual([])
    b2.session.dispose()
  })

  it('dismissing the batch leaves disk and map untouched', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`n/${i}.md`] = `file ${i}\n`
    const adapter = await seedVault(files)
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    b1.session.dispose()

    for (let i = 0; i < 22; i++) await adapter.remove(`n/${i}.md`)
    const b2 = await boot(adapter, store, { onBreaker: () => {} })
    b2.session.dismissBootBatch()
    // No tombstones, no reviews, no writes: the vanished files stay in the
    // map awaiting a real decision (M3's confirm dialog).
    expect(b2.session.files().filter((r) => r.kind === 'text')).toHaveLength(25)
    expect(b2.reviews).toEqual([])
    b2.session.dispose()
  })
})

/**
 * A held boot batch's new folders belong to the batch: enrolled before the
 * threshold check, they synced to every peer empty, and a dismissed batch
 * left them in the map. Folders with no held file in them still enrol at once.
 */
describe('boot machine — a held batch does not enrol its folders', () => {
  async function heldBoot() {
    const adapter = await seedVault({ 'keep.md': 'kept\n' })
    const store = new MemStoreDir()
    const b1 = await boot(adapter, store)
    b1.session.dispose()
    // While closed: 21 notes in two new folders (one nested), and a new empty folder.
    const added = Array.from({ length: 21 }, (_, i) => (i < 10 ? `batch/n${i}.md` : `batch/deep/n${i}.md`))
    for (const p of added) await adapter.writeAtomic(p, enc.encode(`${p}\n`))
    await adapter.mkdir('batch/deep/empty')
    await adapter.mkdir('lone')
    let breakerPaths: string[] | null = null
    const b2 = await boot(adapter, store, { onBreaker: (paths) => (breakerPaths = paths) })
    expect(breakerPaths).toHaveLength(21)
    return { adapter, b2, added }
  }
  const dirs = (session: MountSession) =>
    session.files().filter((r) => r.kind === 'dir').map((r) => r.path).sort()

  it('holds the batch’s folders out of the map; an unrelated empty folder enrols', async () => {
    const { b2 } = await heldBoot()
    expect(dirs(b2.session)).toEqual(['lone'])
    b2.session.dispose()
  })

  it('confirm enrols the folders, then the files', async () => {
    const { b2, added } = await heldBoot()
    await b2.session.confirmBootBatch()
    expect(dirs(b2.session)).toEqual(['batch', 'batch/deep', 'batch/deep/empty', 'lone'])
    for (const p of added) expect(b2.session.docForPath(p)?.getText()).toBe(`${p}\n`)
    expect(b2.errors).toEqual([])
    b2.session.dispose()
  })

  it('dismiss enrols neither, and a later folder sync does not sneak them in', async () => {
    const { adapter, b2, added } = await heldBoot()
    b2.session.dismissBootBatch()
    // Any app action that syncs folders (a note made elsewhere) must not
    // enrol the dismissed batch's folders behind the person's back.
    await b2.session.importFile('other/x.md', enc.encode('x\n'))
    expect(dirs(b2.session)).toEqual(['lone', 'other'])
    const files = b2.session.files().map((r) => r.path)
    for (const p of added) expect(files).not.toContain(p)
    expect(await adapter.read(added[0]!)).not.toBeNull() // disk untouched
    b2.session.dispose()
  })
})
