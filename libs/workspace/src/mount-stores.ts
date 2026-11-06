/**
 * One mount's durable store bundle — the doc store, the LCA store guarded by
 * it, and the pre-image journal — all under `<storeDir>/<room>/`. Every host
 * (the web shell, the bench harness, the test fixture, the Nextcloud
 * custodian) builds the same four objects; this is the one place that says
 * how. The journal stamps through the injected clock (golden rule 5).
 */
import type { SyncEngine } from '@ohhi/sync'
import {
  BlobDocStore,
  FileJournal,
  JsonFileLcaStore,
  lcaGuard,
  scopedStoreDir,
  type Clock,
  type DocStore,
  type LcaStore,
  type PreImageJournal,
  type StoreDir,
} from '@ohhi/vault'

export interface MountStores {
  docStore: DocStore
  lcaStore: LcaStore
  journal: PreImageJournal
  mountDir: StoreDir
}

export function createMountStores(engine: SyncEngine, storeDir: StoreDir, room: string, clock: Clock): MountStores {
  const mountDir = scopedStoreDir(storeDir, `${room}/`)
  const docStore = new BlobDocStore(engine, mountDir, clock)
  const lcaStore = lcaGuard(docStore, new JsonFileLcaStore(mountDir.io('lca.json')))
  const journal = new FileJournal(mountDir, { now: () => clock.now() })
  return { docStore, lcaStore, journal, mountDir }
}
