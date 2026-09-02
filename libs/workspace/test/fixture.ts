/**
 * Shared vault fixture for the mount-lifecycle L1 tests (join/unshare/move —
 * the carve suite predates it and keeps its local twin). Boots a full
 * multi-mount vault from mounts.json exactly the way the web shim does:
 * recoverMounts first, root over ignoringAdapter, mounts over scopedAdapter,
 * per-room store namespaces, guid-keyed records.
 */
import { createYjsEngine, type SyncEngine } from '@editor/sync'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  JsonFileLcaStore,
  lcaGuard,
  MemVaultAdapter,
  MountsFile,
  scopedAdapter,
  scopedStoreDir,
  type StoreDir,
  type StoreIo,
  type VaultAdapter,
} from '@editor/vault'
import { SimClock } from '@editor/testkit'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import { recoverMounts } from '../src/vault-boot.js'
import type { SyncRecordFields } from '../src/types.js'

export const enc = new TextEncoder()
export const dec = new TextDecoder()

export function freshRecord(): SyncRecordFields {
  return { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
}

/** StoreDir that throws 'injected-crash' after `budget` mutating operations. */
export function crashingDir(base: StoreDir, budget: number): StoreDir {
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

export async function seedAdapter(files: Record<string, string>): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(files)) {
    await adapter.writeAtomic(path, enc.encode(text))
  }
  return adapter
}

export async function diskSnapshot(adapter: VaultAdapter): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const stat of await adapter.list()) {
    out[stat.path] = dec.decode((await adapter.read(stat.path))!)
  }
  return out
}

export interface BootedVault {
  engine: SyncEngine
  clock: SimClock
  root: MountSession
  mounts: Map<string, MountSession>
  mountsFile: MountsFile
  ignore: Set<string>
  events: { reviews: { guid: string; path: string; reason: string }[] }
  makeSession: (
    room: string,
    adapter: VaultAdapter,
    mountPath: string,
    extra?: Partial<MountSessionConfig>
  ) => Promise<MountSession>
  dispose: () => void
}

/** Boot every mount from mounts.json — the web shim's multi-mount wiring. */
export async function bootVault(
  base: VaultAdapter,
  vaultDir: StoreDir,
  rootRoom: string
): Promise<BootedVault> {
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
  const events: BootedVault['events'] = { reviews: [] }

  const makeSession = (
    room: string,
    adapter: VaultAdapter,
    mountPath: string,
    extra?: Partial<MountSessionConfig>
  ): Promise<MountSession> => {
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
      recordFor,
      makeShareLink: (relay, room_) => `link:${relay.url}:${room_}`,
      events: {
        onReview: (r) => events.reviews.push({ guid: r.guid, path: r.path, reason: r.reason }),
      },
      ...extra,
    })
  }

  const root = await makeSession(rootRoom, ignoringAdapter(base, ignore), '')
  const mounts = new Map<string, MountSession>()
  for (const desc of descs) {
    if (desc.path === '') continue
    mounts.set(
      desc.path,
      await makeSession(desc.room, scopedAdapter(base, desc.path), desc.path, {
        provenance: desc.provenance,
      })
    )
  }
  return {
    engine,
    clock,
    root,
    mounts,
    mountsFile,
    ignore,
    events,
    makeSession,
    dispose: () => {
      root.dispose()
      for (const m of mounts.values()) m.dispose()
    },
  }
}
