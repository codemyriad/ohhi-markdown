/**
 * L1 fixture 1 (spike S8 acceptance): the carve crash matrix. A carve is
 * killed by a failure-injecting StoreDir after every possible number of store
 * writes; each "reboot" (fresh engine, recoverMounts, boot every mount from
 * mounts.json) must land in a converged state:
 *   - every disk file managed by exactly one mount map (no orphans, no dupes),
 *   - no GUID present in two maps,
 *   - not a single disk byte changed by the carve or its recovery,
 *   - every surviving mounts.json entry 'active'.
 * The happy path and the detach-rollforward path are asserted exactly.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine, type SyncEngine } from '@editor/sync'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedAdapter,
  scopedStoreDir,
  type StoreDir,
  type StoreIo,
  type VaultAdapter,
} from '@editor/vault'
import { SimClock } from '@editor/testkit'
import { carveFolder } from '../src/carve.js'
import { MountSession } from '../src/mount-session.js'
import { recoverMounts } from '../src/vault-boot.js'
import type { SyncRecordFields } from '../src/types.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const ROOT_ROOM = 'root-room'
const CARVE_ROOM = 'carved-room'
const RELAY_URL = 'ws://relay.test'

const FILES: Record<string, string> = {
  'keep.md': 'stays in the root vault\n',
  'team/plan.md': 'shared plan\n',
  'team/notes/deep.md': 'nested shared note\n',
}

function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

/** StoreDir that throws 'injected-crash' after `budget` mutating operations. */
function crashingDir(base: StoreDir, budget: number): StoreDir {
  let left = budget
  const spend = (): void => {
    if (left <= 0) throw new Error('injected-crash')
    left--
  }
  return {
    io: (name): StoreIo => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          spend()
          await io.writeAtomic(bytes)
        },
      }
    },
    remove: async (name) => {
      spend()
      await base.remove(name)
    },
    list: (prefix) => base.list(prefix),
  }
}

async function seedAdapter(): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(FILES)) {
    await adapter.writeAtomic(path, enc.encode(text))
  }
  return adapter
}

async function diskSnapshot(adapter: VaultAdapter): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const stat of await adapter.list()) {
    out[stat.path] = dec.decode((await adapter.read(stat.path))!)
  }
  return out
}

interface BootedVault {
  engine: SyncEngine
  root: MountSession
  mounts: Map<string, MountSession>
  ignore: Set<string>
  dispose: () => void
}

/** Boot every mount from mounts.json — the web shim's multi-mount wiring. */
async function bootVault(base: VaultAdapter, vaultDir: StoreDir): Promise<BootedVault> {
  const engine = createYjsEngine()
  const clock = new SimClock()
  const mountsFile = new MountsFile(vaultDir.io('mounts.json'))
  await recoverMounts(vaultDir, mountsFile, engine)

  const descs = await mountsFile.load()
  const ignore = new Set<string>(descs.filter((d) => d.path !== '').map((d) => d.path))
  const records = new Map<string, SyncRecordFields>()
  const recordFor = (key: string): SyncRecordFields => {
    let rec = records.get(key)
    if (!rec) {
      rec = freshRecord()
      records.set(key, rec)
    }
    return rec
  }

  const makeSession = (room: string, adapter: VaultAdapter, mountPath: string, provenance?: 'carved') => {
    const dir = scopedStoreDir(vaultDir, `${room}/`)
    const docStore = new BlobDocStore(engine, dir, clock)
    return MountSession.create({
      engine,
      adapter,
      user: { name: 'T', color: '#000' },
      room,
      clock,
      lcaStore: lcaGuard(docStore, new JsonFileLcaStore(dir.io('lca.json'))),
      journal: new FileJournal(dir, { now: () => clock.now() }),
      docStore,
      mountsFile,
      mountPath,
      ...(provenance ? { provenance } : {}),
      recordFor,
      makeShareLink: (relay, room_) => `link:${relay.url}:${room_}`,
      events: {},
    })
  }

  const root = await makeSession(ROOT_ROOM, ignoringAdapter(base, ignore), '')
  const mounts = new Map<string, MountSession>()
  for (const desc of descs) {
    if (desc.path === '') continue
    mounts.set(desc.path, await makeSession(desc.room, scopedAdapter(base, desc.path), desc.path, 'carved'))
  }
  return {
    engine,
    root,
    mounts,
    ignore,
    dispose: () => {
      root.dispose()
      for (const m of mounts.values()) m.dispose()
    },
  }
}

/** First boot + the carve, driven through a (possibly crashing) StoreDir. */
async function carveThrough(
  base: MemVaultAdapter,
  vaultDir: StoreDir
): Promise<{ vault: BootedVault; mountsFile: MountsFile }> {
  const vault = await bootVault(base, vaultDir)
  const mountsFile = new MountsFile(vaultDir.io('mounts.json'))
  await carveFolder({
    root: vault.root,
    vaultDir,
    mountsFile,
    mountPath: 'team',
    room: CARVE_ROOM,
    relayUrl: 'ws://relay.test',
    addIgnore: (prefix) => vault.ignore.add(prefix),
  })
  return { vault, mountsFile }
}

async function assertConverged(base: MemVaultAdapter, vaultDir: StoreDir, before: Record<string, string>) {
  // Reboot from durable state only.
  const vault = await bootVault(base, vaultDir)

  // Invariant: not a single disk byte changed.
  expect(await diskSnapshot(base)).toEqual(before)

  // Invariant: every surviving entry is 'active'.
  const mountsFile = new MountsFile(vaultDir.io('mounts.json'))
  for (const desc of await mountsFile.load()) expect(desc.status).toBe('active')

  // Invariant: every file under exactly one map, and no guid in two maps.
  const rootRows = vault.root.files().filter((r) => r.kind === 'text')
  const rootPaths = new Set(rootRows.map((r) => r.path))
  const rootGuids = new Set(rootRows.map((r) => r.guid))
  const carved = vault.mounts.get('team')
  if (carved) {
    // Carve completed (or rolled forward): subtree owned by the mount only.
    const mountRows = carved.files().filter((r) => r.kind === 'text')
    expect(new Set(mountRows.map((r) => r.path))).toEqual(new Set(['plan.md', 'notes/deep.md']))
    expect(rootPaths).toEqual(new Set(['keep.md']))
    for (const row of mountRows) expect(rootGuids.has(row.guid)).toBe(false)
    expect(carved.docForPath('plan.md')?.getText()).toBe(FILES['team/plan.md'])
  } else {
    // Carve rolled back: the root owns everything again, stores are gone.
    expect(rootPaths).toEqual(new Set(Object.keys(FILES)))
    expect(await vaultDir.list(`${CARVE_ROOM}/`)).toEqual([])
    expect(vault.root.docForPath('team/plan.md')?.getText()).toBe(FILES['team/plan.md'])
  }
  expect(vault.root.docForPath('keep.md')?.getText()).toBe(FILES['keep.md'])
  vault.dispose()
}

describe('carve — happy path', () => {
  it('moves the subtree into its own mount: maps split, guids preserved, disk untouched', async () => {
    const base = await seedAdapter()
    const vaultDir = new MemStoreDir()
    const before = await diskSnapshot(base)

    const first = await bootVault(base, vaultDir)
    const guidBefore = first.root.files().find((r) => r.path === 'team/plan.md')!.guid
    first.dispose()

    const { vault, mountsFile } = await carveThrough(base, vaultDir)
    // Same doc guid, new room — the carve copies no content.
    const desc = (await mountsFile.load()).find((m) => m.room === CARVE_ROOM)
    expect(desc).toMatchObject({ path: 'team', provenance: 'carved', status: 'active' })
    expect(vault.root.files().some((r) => r.path.startsWith('team'))).toBe(false)
    vault.dispose()

    const reboot = await bootVault(base, vaultDir)
    const carved = reboot.mounts.get('team')!
    expect(carved.files().find((r) => r.path === 'plan.md')!.guid).toBe(guidBefore)
    reboot.dispose()

    await assertConverged(base, vaultDir, before)
  })

  it('carves inside a RELAY-ATTACHED root: the map announces the nested mount (N1)', async () => {
    // The V1 "this vault is itself shared" refusal is gone (device-link
    // shaping A5); the depth-1 carve announces itself instead.
    const base = await seedAdapter()
    const vaultDir = new MemStoreDir()
    const before = await diskSnapshot(base)
    const vault = await bootVault(base, vaultDir)
    vault.root.enableSharing({ url: RELAY_URL, token: 't' })
    const mountsFile = new MountsFile(vaultDir.io('mounts.json'))

    await carveFolder({
      root: vault.root,
      vaultDir,
      mountsFile,
      mountPath: 'team',
      room: CARVE_ROOM,
      relayUrl: RELAY_URL,
      addIgnore: (prefix) => vault.ignore.add(prefix),
    })

    // The subtree left the root map and a single mount entry took its place —
    // guid IS the room, and the relay URL rides along (the token never does).
    const rows = vault.root.files()
    expect(rows.filter((r) => r.path === 'team' || r.path.startsWith('team/'))).toEqual([
      { path: 'team', guid: CARVE_ROOM, kind: 'mount' },
    ])
    expect(vault.root.mountEntries()).toEqual([
      { path: 'team', room: CARVE_ROOM, relay: RELAY_URL },
    ])
    expect((await mountsFile.load()).find((m) => m.room === CARVE_ROOM)).toMatchObject({
      path: 'team',
      provenance: 'carved',
      status: 'active',
    })
    // Still zero bytes moved.
    expect(await diskSnapshot(base)).toEqual(before)
    vault.dispose()
  })

  it('a PRIVATE root carve writes no mount entry (nothing to announce)', async () => {
    const base = await seedAdapter()
    const vaultDir = new MemStoreDir()
    const { vault } = await carveThrough(base, vaultDir)
    expect(vault.root.mountEntries()).toEqual([])
    expect(vault.root.files().some((r) => r.kind === 'mount')).toBe(false)
    vault.dispose()
  })
})

describe('carve — crash matrix (L1 fixture 1)', () => {
  it('killed after every possible store write, every reboot converges', async () => {
    // Budget sweep: 0 writes allowed (dies at the first desc write) up past
    // the happy path's total. The loop stops the first time the carve
    // completes without hitting the injection.
    for (let budget = 0; budget < 60; budget++) {
      const base = await seedAdapter()
      const vaultDir = new MemStoreDir()
      const before = await diskSnapshot(base)

      // Warm boot so durable state exists, then carve through a crashing dir.
      const warm = await bootVault(base, vaultDir)
      warm.dispose()

      const crashing = crashingDir(vaultDir, budget)
      let crashed = false
      const vault = await bootVault(base, vaultDir)
      const mountsFile = new MountsFile(crashing.io('mounts.json'))
      try {
        await carveFolder({
          root: vault.root,
          vaultDir: crashing,
          mountsFile,
          mountPath: 'team',
          room: CARVE_ROOM,
          relayUrl: 'ws://relay.test',
          addIgnore: (prefix) => vault.ignore.add(prefix),
        })
      } catch (err) {
        crashed = true
        expect(String(err)).toContain('injected-crash')
      }
      vault.dispose()

      await assertConverged(base, vaultDir, before)
      if (!crashed) return // the whole matrix is covered
    }
    throw new Error('crash budget never reached the happy path — raise the sweep bound')
  }, 30_000)
})
