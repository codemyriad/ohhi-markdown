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
  isRecoverable,
  JsonFileLcaStore,
  scopedStoreDir,
  wipeStoreDir,
  type MountDesc,
  type MountsFile,
  type StoreDir,
} from '@ohhi/vault'
import type { EngineDoc, SyncEngine } from '@ohhi/sync'
import { MAX_SEED_BYTES } from './mount-session.js'

export async function recoverMounts(
  vaultDir: StoreDir,
  mountsFile: MountsFile,
  engine: SyncEngine
): Promise<void> {
  const descs = await mountsFile.load()
  const root = descs.find((m) => m.path === '') ?? null
  for (const { action, desc } of await mountsFile.recover()) {
    if (action === 'rollback') {
      // Spike Q1/Q4 rollback: the half-made mount's stores are derived state —
      // drop them and the entry; the parent map was never touched.
      //
      // 'adopting:seeding' (N1) rolls back the same way, and means something
      // narrower than "undo": the carve is NOT this device's to undo — the
      // mount entry is a foreign-origin fact in a room we are a peer of. So
      // the derived half goes and the boot pass, seeing "mount entry at P, no
      // desc", adopts again from step 2. That boot-time trigger is required,
      // not an optimisation (spike S10 Q1).
      for (const name of await vaultDir.list(`${desc.room}/`)) await vaultDir.remove(name)
      await mountsFile.removeMount(desc.room)
    } else if (desc.status === 'carving:detaching' || desc.status === 'adopting:detaching') {
      // The mount namespace is complete by this point in BOTH machines — the
      // detaching status is only ever written after seeding finished — so the
      // surgery is identical: scrub the parent namespace using the seeded
      // mount folder blob as the membership authority. A mount with no token
      // is settled back to 'needs-token' by the host, which is the only side
      // that knows whether a credential exists.
      //
      // Settle the status ONLY if the rollforward actually ran. Without the
      // root desc, or without the mount's folder blob, there is nothing to
      // detach FROM and nothing that says what moved: writing 'active'
      // regardless declared a half-made mount finished, and the next boot —
      // which might have both — would never try again (spike S10 Q1's
      // recovery row "any adopting:* with the ROOT desc missing").
      if (await rollforwardDetach(vaultDir, engine, root, desc)) {
        await mountsFile.setStatus(desc.room, 'active')
      }
    } else {
      // unsharing:* rollforward (spike S8 Q6): 'absorbing' re-runs the absorb
      // surgery (idempotent — the mount namespace still exists in that phase),
      // then both statuses complete the disconnect: drop the namespace and the
      // entry. An unmount writes 'unsharing:disconnecting' directly (no
      // absorb — its files stay on disk and re-enroll as local via the root's
      // delta scan).
      if (desc.status === 'unsharing:absorbing' || desc.status === 'absorbing') {
        if (!root) continue // can't absorb without a root desc; retry next boot
        // Which namespace does this fold INTO? Normally the root's; for the
        // depth-1 dissolve (S10 Q5 row 11) the OUTER mount's, named by
        // `absorbInto`. Folding an inner mount into the root while the outer
        // mount owns those paths would put one guid in two namespaces.
        const into = desc.absorbInto ? descs.find((d) => d.room === desc.absorbInto) : root
        // The outer mount is itself mid-transition (its own adopt was
        // interrupted): leave this one for the next boot rather than folding
        // it into a namespace that is about to move again.
        if (!into || isRecoverable(into.status)) continue
        const rel =
          into.path === '' || !desc.path.startsWith(`${into.path}/`)
            ? desc.path
            : desc.path.slice(into.path.length + 1)
        // 'absorbing' is the PEER's row (N1): the same idempotent store copy,
        // with the map left alone — on a peer the map is the owner's, and
        // re-setting entries a blob-loaded temp doc holds could resurrect a
        // key the live map has since moved (spike S10 Q1(b)).
        await absorbMount(
          vaultDir,
          engine,
          into.room,
          { room: desc.room, path: rel },
          // The peer's own 'absorbing' leaves the map alone — it is the
          // owner's, and the owner's announcement is how we found out. The
          // depth-1 dissolve is the opposite: the inner mount's entries have
          // to APPEAR in the outer room, and nobody else is going to say so
          // (S10 Q5 row 11).
          { writeMap: desc.status === 'unsharing:absorbing' || desc.absorbInto !== undefined }
        )
        // The map half may be STALE in the blob: a peer writes 'absorbing'
        // off the LIVE map, and its own folder blob can still carry the
        // `kind:'mount'` entry from before the owner's announcement. Left
        // there, the next boot's adopt pass reads the entry, finds no desc,
        // and adopts the subtree straight back into a room that no longer
        // exists. Replace it with a dir entry — the same conclusion the
        // owner's announcement states, so a merge cannot go backwards. A hard
        // delete would NOT be safe: the key is the owner's to remove.
        await repairAbsorbedEntry(vaultDir, engine, into.room, rel, desc.room)
      }
      for (const name of await vaultDir.list(`${desc.room}/`)) await vaultDir.remove(name)
      await mountsFile.removeMount(desc.room)
    }
  }
  await dropOrphanNamespaces(vaultDir, mountsFile)
}


/**
 * Drop store namespaces no desc names any more.
 *
 * Every machine that retires a room writes `removeMount` and then wipes its
 * namespace, and a crash between the two leaves the namespace behind forever:
 * the losing room of a double carve (S10 Q5 row 10), a rolled-back join, an
 * inner mount dissolved by the depth-1 rule. Nothing reads them, but nothing
 * ever removed them either, and "no guid holds durable state in two
 * namespaces" cannot be checked while orphans are allowed to accumulate.
 *
 * Safe by construction, and deliberately timid: it runs only when a ROOT desc
 * exists — without one, mounts.json is not yet a statement about what this
 * vault holds (a first boot writes blobs before it writes the desc), and
 * wiping on that basis would throw away the durable CRDT state of a vault
 * whose mount table simply had not been written yet. The orphan's JOURNAL is
 * kept: pre-images are not derived state (golden rule 1).
 */
async function dropOrphanNamespaces(vaultDir: StoreDir, mountsFile: MountsFile): Promise<void> {
  const descs = await mountsFile.load()
  const root = descs.find((m) => m.path === '')
  if (!root) return
  const known = new Set(descs.map((m) => m.room))
  for (const name of await vaultDir.list()) {
    const slash = name.indexOf('/')
    if (slash === -1) continue // mounts.json and friends live at the top
    if (known.has(name.slice(0, slash))) continue
    // The JOURNAL is not derived state. Every Editor-initiated disk write
    // records its pre-image there first (golden rule 1), and those entries are
    // the only copy of what a file looked like before we touched it — the
    // undo of last resort, and the thing an operator reaches for when a sync
    // did something they did not expect. The doc blobs and LCA records of a
    // room nobody names any more are safe to drop; the receipts for the bytes
    // that room wrote to THIS disk are not, and they cost a few KB.
    if (name.slice(slash + 1).startsWith('journal/')) continue
    await vaultDir.remove(name)
  }
}

export interface AbsorbOptions {
  /**
   * Write the parent folder blob's entries (default true). FALSE on a peer
   * whose owner already announced the absorb on the live map, and false in
   * the peer-side machine generally: every re-`set` is a fresh local op its
   * folder provider ships back to the room, and the transaction runs against
   * a blob-loaded temp doc, so a peer whose live map has since moved on would
   * resurrect the stale key at its next reopen (spike S10 Q1(b)).
   */
  writeMap?: boolean
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
  desc: Pick<MountDesc, 'room' | 'path'>,
  opts: AbsorbOptions = {}
): Promise<void> {
  const mountDir = scopedStoreDir(vaultDir, `${desc.room}/`)
  const rootDir = scopedStoreDir(vaultDir, `${rootRoom}/`)

  const mountFolder = await loadFolderBlob(engine, mountDir, `absorb-mount:${desc.room}`)
  if (!mountFolder) return // nothing seeded: nothing to fold back
  const entries = mountFolder
    .getMap()
    .entries()
    .filter(([, e]) => !e.deleted)

  const rootFolder = (opts.writeMap ?? true)
    ? await loadFolderBlob(engine, rootDir, `absorb-root:${desc.room}`)
    : null
  if (rootFolder) {
    rootFolder.transactMap((m) => {
      // REPLACE a `kind:'mount'` entry at the mount root with a dir entry.
      // The old guard skipped any existing key, so the owner's unshare left a
      // mount entry pointing at a room it had just dissolved — every peer
      // would keep adopting a mount that no longer exists (spike S10 Q1's
      // "one bug fixed"). An existing dir entry keeps its guid.
      const at = m.get(desc.path)
      if (!at || at.deleted || at.kind !== 'dir') {
        m.set(desc.path, { guid: crypto.randomUUID(), kind: 'dir' })
      }
      for (const [p, e] of entries) {
        // Never restore a child `kind:'mount'` entry (the live twin,
        // `announceAbsorb`, filters them for the same reason). A dissolved
        // mount's map can still name an inner one, and putting that back
        // announces a room that no longer exists — carrying a stale seed that
        // every peer would then adopt from. Depth 1 is the rule; the inner
        // mount's own dissolve is what puts its FILES here.
        if (e.kind === 'mount') continue
        m.set(`${desc.path}/${p}`, e)
      }
    }, 'local')
    await rootDir
      .io(docBlobName(FOLDER_DOC_KEY))
      .writeAtomic(engine.encodeUpdateSince(rootFolder, null))
  } else if (opts.writeMap ?? true) {
    mountFolder.destroy()
    return // no root blob (fresh-vault edge): the delta scan re-enrolls from disk
  }

  const rootLcas = new JsonFileLcaStore(rootDir.io('lca.json'))
  const mountLcas = new JsonFileLcaStore(mountDir.io('lca.json'))
  for (const [p, e] of entries) {
    if (e.kind !== 'text') continue
    // Blob BEFORE the LCA record (Invariant D): a crash between the two must
    // leave the root holding a doc at least as new as its baseline. The other
    // order leaves an LCA with no doc behind it, which the reopen reads as
    // "the blob was lost" and re-seeds from baseText — silently rolling the
    // note back to its last disk state.
    const blob = await mountDir.io(docBlobName(e.guid)).read()
    if (blob) await rootDir.io(docBlobName(e.guid)).writeAtomic(blob)
    const lca = await mountLcas.get(e.guid)
    if (lca) await rootLcas.put({ ...lca, path: `${desc.path}/${p}` })
  }

  mountFolder.destroy()
  rootFolder?.destroy()
}

/**
 * Re-run the detach (carve step 5, or the peer's adopt step 5) against the
 * durable stores: the crashed session's map
 * transaction may or may not have been flushed, so delete the subtree from
 * the ROOT namespace (folder blob keys, LCA records, doc blobs) using the
 * fully-seeded mount namespace as the membership authority. Idempotent.
 */
export async function rollforwardDetach(
  vaultDir: StoreDir,
  engine: SyncEngine,
  root: MountDesc | null,
  desc: MountDesc
): Promise<boolean> {
  if (!root) return false // no root desc: nothing to detach from (fresh vault edge)
  const mountDir = scopedStoreDir(vaultDir, `${desc.room}/`)
  const rootDir = scopedStoreDir(vaultDir, `${root.room}/`)

  // Membership: the seeded mount folder doc (keys are subtree-relative).
  const guids = new Set<string>()
  const mountFolder = await loadFolderBlob(engine, mountDir, `recover-mount:${desc.room}`)
  if (!mountFolder) return false // nothing seeded: this is not a completed step 3
  for (const [, entry] of mountFolder.getMap().entries()) {
    if (entry.kind === 'text') guids.add(entry.guid)
  }
  const mountSeed = engine.encodeUpdateSince(mountFolder, null)
  mountFolder.destroy()

  // Root folder blob: drop every key UNDER the carved dir.
  const rootFolder = await loadFolderBlob(engine, rootDir, `recover-root:${desc.room}`)
  if (rootFolder) {
    const pre = `${desc.path}/`
    const at = rootFolder.getMap().get(desc.path)
    // NEVER delete the key at the mount root itself when it is the
    // `kind:'mount'` entry. On a peer that entry is the OWNER's announcement
    // for the whole room: deleting it here writes a hard delete into this
    // device's folder history, which the next reconnect ships back to the
    // room and dissolves the announcement for every peer at once. Only the
    // stale dir entry a carve replaced is ours to remove.
    const keepRoot = at !== undefined && !at.deleted && at.kind === 'mount'
    const doomed = rootFolder
      .getMap()
      .entries()
      .filter(([p]) => p.startsWith(pre) || (p === desc.path && !keepRoot))
      .map(([p]) => p)
    // The CARVER's own announcement may be the half that was lost (the
    // transaction ran but its blob flush did not). Re-state it — mounts.json
    // is the authority on WHETHER a mount exists, the map on where — with the
    // seed, so a peer adopting from this blob still gets one shared history.
    const restate = !keepRoot && desc.provenance === 'carved'
    if (doomed.length > 0 || restate) {
      rootFolder.transactMap((m) => {
        for (const p of doomed) m.delete(p)
        if (restate) {
          m.set(desc.path, {
            guid: desc.room,
            kind: 'mount',
            ...(desc.relay ? { relay: desc.relay.url } : {}),
            ...seedField(mountSeed),
          })
        }
      }, 'local')
      await rootDir.io(docBlobName(FOLDER_DOC_KEY)).writeAtomic(engine.encodeUpdateSince(rootFolder, null))
    }
    rootFolder.destroy()
  }

  // Root doc blobs + LCA records for the moved guids. Blob first: the residue
  // of a crash between them must not be one guid holding a doc blob in TWO
  // namespaces (`mountInvariants` checks exactly that).
  const rootLcas = new JsonFileLcaStore(rootDir.io('lca.json'))
  for (const guid of guids) {
    await rootDir.remove(docBlobName(guid))
    await rootLcas.remove(guid)
  }
  return true
}

/**
 * A stale folder blob still naming an absorbed mount at `path`: replace the
 * `kind:'mount'` entry with a dir entry, exactly as the owner's announcement
 * does. Never a hard delete — the key is the owner's, and a delete written
 * here would reach the room. No-op when the blob already agrees.
 */
async function repairAbsorbedEntry(
  vaultDir: StoreDir,
  engine: SyncEngine,
  parentRoom: string,
  path: string,
  room: string
): Promise<void> {
  const dir = scopedStoreDir(vaultDir, `${parentRoom}/`)
  const folder = await loadFolderBlob(engine, dir, `absorb-repair:${room}`)
  if (!folder) return
  try {
    const at = folder.getMap().get(path)
    if (!at || at.deleted || at.kind !== 'mount' || at.guid !== room) return
    folder.transactMap((m) => m.set(path, { guid: crypto.randomUUID(), kind: 'dir' }), 'local')
    await dir.io(docBlobName(FOLDER_DOC_KEY)).writeAtomic(engine.encodeUpdateSince(folder, null))
  } finally {
    folder.destroy()
  }
}

/**
 * The `seed` field for a restated mount entry, or nothing when the encoded
 * form is over the cap — measured on the BASE64, which is what travels
 * (`MAX_SEED_BYTES` in mount-session.ts).
 */
function seedField(bytes: Uint8Array): { seed?: string } {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  const encoded = btoa(binary)
  return encoded.length <= MAX_SEED_BYTES ? { seed: encoded } : {}
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
