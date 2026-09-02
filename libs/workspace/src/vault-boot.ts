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
      // unsharing:* rollforward (spike S8 Q6): 'absorbing' re-runs the absorb
      // surgery (idempotent — the mount namespace still exists in that phase),
      // then both statuses complete the disconnect: drop the namespace and the
      // entry. An unmount writes 'unsharing:disconnecting' directly (no
      // absorb — its files stay on disk and re-enroll as local via the root's
      // delta scan).
      if (desc.status === 'unsharing:absorbing') {
        if (!root) continue // can't absorb without a root desc; retry next boot
        await absorbMount(vaultDir, engine, root.room, desc)
      }
      for (const name of await vaultDir.list(`${desc.room}/`)) await vaultDir.remove(name)
      await mountsFile.removeMount(desc.room)
    }
  }
}

/**
 * Unshare step 2 (spike S8 Q6, 'unsharing:absorbing') as pure store surgery:
 * fold the mount's state back into the root namespace — folder-map entries
 * re-prefixed under the mount path (same guids), LCA records with rebased
 * paths, doc blobs copied verbatim, plus a dir entry for the mount root
 * itself. Idempotent: re-running overwrites identical values, so both the
 * live machine and crash recovery share it. Callers must ensure no live
 * session holds the ROOT stores while this runs (a debounced flush would
 * clobber the surgery).
 */
export async function absorbMount(
  vaultDir: StoreDir,
  engine: SyncEngine,
  rootRoom: string,
  desc: Pick<MountDesc, 'room' | 'path'>
): Promise<void> {
  const mountDir = scopedStoreDir(vaultDir, `${desc.room}/`)
  const rootDir = scopedStoreDir(vaultDir, `${rootRoom}/`)

  const mountFolder = await loadFolderBlob(engine, mountDir, `absorb-mount:${desc.room}`)
  if (!mountFolder) return // nothing seeded: nothing to fold back
  const entries = mountFolder
    .getMap()
    .entries()
    .filter(([, e]) => !e.deleted)

  const rootFolder = await loadFolderBlob(engine, rootDir, `absorb-root:${desc.room}`)
  if (!rootFolder) {
    mountFolder.destroy()
    return // no root blob (fresh-vault edge): the delta scan re-enrolls from disk
  }
  rootFolder.transactMap((m) => {
    if (!m.get(desc.path)) m.set(desc.path, { guid: crypto.randomUUID(), kind: 'dir' })
    for (const [p, e] of entries) m.set(`${desc.path}/${p}`, e)
  }, 'local')
  await rootDir
    .io(docBlobName(FOLDER_DOC_KEY))
    .writeAtomic(engine.encodeUpdateSince(rootFolder, null))

  const rootLcas = new JsonFileLcaStore(rootDir.io('lca.json'))
  const mountLcas = new JsonFileLcaStore(mountDir.io('lca.json'))
  for (const [p, e] of entries) {
    if (e.kind !== 'text') continue
    const lca = await mountLcas.get(e.guid)
    if (lca) await rootLcas.put({ ...lca, path: `${desc.path}/${p}` })
    const blob = await mountDir.io(docBlobName(e.guid)).read()
    if (blob) await rootDir.io(docBlobName(e.guid)).writeAtomic(blob)
  }

  mountFolder.destroy()
  rootFolder.destroy()
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
