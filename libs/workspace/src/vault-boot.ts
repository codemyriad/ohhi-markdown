/**
 * Vault-level boot recovery (spike S8): before any mount session is created,
 * classify interrupted lifecycle transitions in mounts.json and execute their
 * recovery. Rollback drops the half-made mount's derived stores; rollforward
 * completes an interrupted carve detach as pure store surgery (the mount's
 * namespace is fully seeded by then — 'carving:detaching' is only ever
 * written after seeding finished).
 */
import {
  docBlobName,
  FOLDER_DOC_KEY,
  JsonFileLcaStore,
  scopedStoreDir,
  type MountDesc,
  type MountsFile,
  type StoreDir,
} from '@editor/vault'
import type { EngineDoc, SyncEngine } from '@editor/sync'

export async function recoverMounts(
  vaultDir: StoreDir,
  mountsFile: MountsFile,
  engine: SyncEngine
): Promise<void> {
  const root = (await mountsFile.load()).find((m) => m.path === '') ?? null
  for (const { action, desc } of await mountsFile.recover()) {
    if (action === 'rollback') {
      // Spike Q1/Q4 rollback: the half-made mount's stores are derived state —
      // drop them and the entry; the parent map was never touched.
      for (const name of await vaultDir.list(`${desc.room}/`)) await vaultDir.remove(name)
      await mountsFile.removeMount(desc.room)
    } else if (desc.status === 'carving:detaching') {
      await rollforwardCarveDetach(vaultDir, engine, root, desc)
      await mountsFile.setStatus(desc.room, 'active')
    } else {
      // TODO(M5): unsharing:* rollforward (spike S8 Q6) — those flows don't
      // exist yet, so these statuses cannot be written today.
    }
  }
}

/**
 * Re-run carve step 5 against the durable stores: the crashed session's map
 * transaction may or may not have been flushed, so delete the subtree from
 * the ROOT namespace (folder blob keys, LCA records, doc blobs) using the
 * fully-seeded mount namespace as the membership authority. Idempotent.
 */
async function rollforwardCarveDetach(
  vaultDir: StoreDir,
  engine: SyncEngine,
  root: MountDesc | null,
  desc: MountDesc
): Promise<void> {
  if (!root) return // no root desc: nothing to detach from (fresh vault edge)
  const mountDir = scopedStoreDir(vaultDir, `${desc.room}/`)
  const rootDir = scopedStoreDir(vaultDir, `${root.room}/`)

  // Membership: the seeded mount folder doc (keys are subtree-relative).
  const guids = new Set<string>()
  const mountFolder = await loadFolderBlob(engine, mountDir, `recover-mount:${desc.room}`)
  if (!mountFolder) return
  for (const [, entry] of mountFolder.getMap().entries()) {
    if (entry.kind === 'text') guids.add(entry.guid)
  }
  mountFolder.destroy()

  // Root folder blob: drop every key at or under the carved dir.
  const rootFolder = await loadFolderBlob(engine, rootDir, `recover-root:${desc.room}`)
  if (rootFolder) {
    const pre = `${desc.path}/`
    const doomed = rootFolder
      .getMap()
      .entries()
      .filter(([p]) => p === desc.path || p.startsWith(pre))
      .map(([p]) => p)
    if (doomed.length > 0) {
      rootFolder.transactMap((m) => {
        for (const p of doomed) m.delete(p)
      }, 'local')
      await rootDir.io(docBlobName(FOLDER_DOC_KEY)).writeAtomic(engine.encodeUpdateSince(rootFolder, null))
    }
    rootFolder.destroy()
  }

  // Root LCA records + doc blobs for the moved guids.
  const rootLcas = new JsonFileLcaStore(rootDir.io('lca.json'))
  for (const guid of guids) {
    await rootLcas.remove(guid)
    await rootDir.remove(docBlobName(guid))
  }
}

async function loadFolderBlob(
  engine: SyncEngine,
  dir: StoreDir,
  tmpName: string
): Promise<EngineDoc | null> {
  const bytes = await dir.io(docBlobName(FOLDER_DOC_KEY)).read()
  if (!bytes) return null
  const doc = engine.createDoc(tmpName)
  engine.applyUpdate(doc, bytes, 'seed')
  return doc
}
