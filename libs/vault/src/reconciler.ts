/**
 * The reconciler: classifies the relationship between a file's disk state,
 * its LCA record, and its CRDT doc, then performs exactly one safe action.
 *
 *   disk vs LCA | doc vs LCA | action
 *   ------------+------------+--------------------------------------------
 *   same        | same       | noop
 *   same        | ahead      | materialize doc → disk (journal + atomic)
 *   changed     | same       | ingest disk diff → CRDT ops (origin 'disk')
 *   changed     | ahead      | diverged → review, never write
 *
 * Clean-room implementation of the LCA/shadow-copy pattern (see
 * docs/primers/03-lca-reconciliation.md). The LCA advances ONLY together
 * with the CRDT change it describes — both happen inside this module or
 * neither does.
 *
 * Every materialize is a COMPARE-AND-SWAP against the bytes the classifying
 * read saw (`WriteOptions.expectHash`). Classification and writing are not
 * one atomic step — the journal write sits between them — and an external
 * write landing in that window used to be overwritten with no journal entry
 * and no review (Spike S11 finding F1). A losing swap re-classifies instead
 * of writing, so those bytes are either ingested or surfaced for review.
 */
import DiffMatchPatch from 'diff-match-patch'
import type { EngineDoc, SyncEngine } from '@editor/sync'
import { decodeFile, renderFile } from './eol.js'
import { hashBytes } from './hash.js'
import { WriteConflictError } from './types.js'
import type {
  DivergenceReview,
  LcaRecord,
  LcaStore,
  PreImageJournal,
  ReconcileResult,
  ReconcileThresholds,
  VaultAdapter,
} from './types.js'

const dmp = new DiffMatchPatch()

export interface ReconcileContext {
  engine: SyncEngine
  adapter: VaultAdapter
  lcaStore: LcaStore
  journal: PreImageJournal
  thresholds: ReconcileThresholds
  /** Recently flushed content hashes per path (stale-echo detection). */
  recentFlushes: Map<string, string[]>
  /** Paths currently owned by an open editor (materialization deferred). */
  openPaths: Set<string>
}

export async function reconcileFile(
  ctx: ReconcileContext,
  doc: EngineDoc,
  lca: LcaRecord
): Promise<ReconcileResult> {
  return classify(ctx, doc, lca, 1)
}

/**
 * `retriesLeft` is how many more times a losing compare-and-swap inside
 * `materialize` may re-enter this function. One is enough: a CAS failure means
 * an external writer moved the bytes, and the re-classification either ingests
 * them or raises a review — neither of which writes. A second failure would
 * need a third writer inside the same window, and looping on it would be worse
 * than surfacing the error.
 */
async function classify(
  ctx: ReconcileContext,
  doc: EngineDoc,
  lca: LcaRecord,
  retriesLeft: number
): Promise<ReconcileResult> {
  const { engine, adapter, lcaStore, journal, thresholds } = ctx
  const diskBytes = await adapter.read(lca.path)
  if (diskBytes === null) {
    if (lca.contentHash === '') {
      // Never existed on disk (remote-created file): materialize creates it.
      if (doc.getText().length === 0) return { action: 'noop' }
      return materialize(ctx, doc, lca, null, retriesLeft)
    }
    // File vanished without a folder-map tombstone: external deletion.
    // Never silently drop CRDT content — surface as a 'vanished' review the
    // host resolves via resolveVanished (restore | confirm removal, M5).
    return review(lca, doc.getText(), '', 'vanished')
  }

  const diskHash = hashBytes(diskBytes)
  const diskChanged = diskHash !== lca.contentHash
  const docHeads = engine.heads(doc)
  const docChanged = !engine.headsEqual(docHeads, engine.decodeHeads(lca.heads))

  if (!diskChanged && !docChanged) return { action: 'noop' }

  if (!diskChanged && docChanged) {
    if (ctx.openPaths.has(lca.path)) return { action: 'noop' } // editor owns it; flush will materialize
    return materialize(ctx, doc, lca, diskBytes, retriesLeft)
  }

  const decoded = decodeFile(diskBytes)

  if (diskChanged && !docChanged) {
    // Stale-echo guard: the disk now holds something we flushed EARLIER
    // (but not our latest flush) — typical of another editor's stale
    // autosave buffer overwriting newer content (Spike S6) → review.
    const ring = ctx.recentFlushes.get(lca.path) ?? []
    if (ring.length > 0 && ring[ring.length - 1] !== diskHash && ring.includes(diskHash)) {
      return review(lca, doc.getText(), decoded.text, 'stale-echo')
    }

    const diffs = dmp.diff_main(lca.baseText, decoded.text)
    dmp.diff_cleanupSemantic(diffs)
    const distance = dmp.diff_levenshtein(diffs)
    if (
      lca.baseText.length >= thresholds.ratioMinBaseLength &&
      distance / lca.baseText.length > thresholds.maxIngestRatio
    ) {
      return review(lca, doc.getText(), decoded.text, 'ratio-threshold')
    }

    applyDiffsAsOps(doc, diffs)
    const newLca: LcaRecord = {
      ...lca,
      baseText: decoded.text,
      contentHash: diskHash,
      heads: engine.encodeHeads(engine.heads(doc)),
      eol: decoded.eol,
      bom: decoded.bom,
    }
    await lcaStore.put(newLca)
    return { action: 'ingested' }
  }

  // Both changed: three-way divergence. Touch nothing; surface review.
  return review(lca, doc.getText(), decoded.text, 'three-way')
}

/** CRDT advanced, disk did not: write doc state to disk safely. */
async function materialize(
  ctx: ReconcileContext,
  doc: EngineDoc,
  lca: LcaRecord,
  preImage: Uint8Array | null,
  retriesLeft = 0
): Promise<ReconcileResult> {
  const { engine, adapter, lcaStore, journal } = ctx
  // Text and heads MUST be captured back-to-back in one synchronous block:
  // the LCA describes a single moment of the doc. Reading heads after the
  // awaits below let a remote update land in between and store a TORN record
  // — old text/hash with new heads — which the next pass classifies as noop
  // over stale disk (and, with overlapping entry points, as spurious
  // three-way reviews; dogfood 2026-09-07). If the doc advances during the
  // awaits, the next pass sees doc-ahead-of-LCA and materializes the delta.
  const text = doc.getText()
  const heads = engine.encodeHeads(engine.heads(doc))
  const bytes = renderFile(text, lca.eol, lca.bom)
  // What the caller read a moment ago — `lca.contentHash` on the classify
  // paths, and the bytes `resolveDivergence` just read on the resolution path,
  // where the LCA is stale BY DEFINITION (that is what a divergence is).
  // `''` is "there is no file there", matching LcaRecord.contentHash.
  const expectHash = preImage === null ? '' : hashBytes(preImage)
  // Journal FIRST and unconditionally (golden rule 1: the pre-image is durable
  // before any write can replace it). A losing CAS therefore leaves one extra
  // pre-image of bytes that were never overwritten — harmless: the journal is
  // a retention ring of recoverable versions, not a log of writes, and an
  // entry too many costs a line in the History rail, never a note.
  await journal.record(lca.path, preImage)
  try {
    await adapter.writeAtomic(lca.path, bytes, { expectHash })
  } catch (err) {
    // S11 F1: somebody else wrote inside the window between the classifying
    // read and the rename. Their bytes are still on disk, so re-classify:
    // disk-ahead ingests them, both-ahead raises a three-way review. Either
    // way nothing is lost, which is the whole point of the swap.
    if (err instanceof WriteConflictError && retriesLeft > 0) {
      return classify(ctx, doc, lca, retriesLeft - 1)
    }
    throw err
  }
  const newHash = hashBytes(bytes)
  rememberFlush(ctx, lca.path, newHash)
  await lcaStore.put({
    ...lca,
    baseText: text,
    contentHash: newHash,
    heads,
  })
  return { action: 'materialized' }
}

/**
 * Resolution entry point: the user (or a directed test) produced a merged
 * text. Apply it to the CRDT as a minimal diff (never delete-all+reinsert),
 * then materialize. Used by the review UI's accept actions.
 */
export async function resolveDivergence(
  ctx: ReconcileContext,
  doc: EngineDoc,
  lca: LcaRecord,
  mergedText: string
): Promise<ReconcileResult> {
  const diffs = dmp.diff_main(doc.getText(), mergedText)
  dmp.diff_cleanupSemantic(diffs)
  applyDiffsAsOps(doc, diffs)
  const preImage = await ctx.adapter.read(lca.path)
  // One retry, same as the classify paths: if a third party wrote while the
  // human was deciding, the merge must be re-offered against THEIR bytes
  // rather than written over them.
  return materialize(ctx, doc, lca, preImage, 1)
}

export function rememberFlush(ctx: ReconcileContext, path: string, hash: string): void {
  const ring = ctx.recentFlushes.get(path) ?? []
  ring.push(hash)
  while (ring.length > ctx.thresholds.flushRingSize) ring.shift()
  ctx.recentFlushes.set(path, ring)
}

function applyDiffsAsOps(doc: EngineDoc, diffs: [number, string][]): void {
  doc.transact((t) => {
    let pos = 0
    for (const [op, text] of diffs) {
      if (op === 0) {
        pos += text.length
      } else if (op === 1) {
        t.insert(pos, text)
        pos += text.length
      } else {
        t.delete(pos, text.length)
      }
    }
  }, 'disk')
}

function review(
  lca: LcaRecord,
  mine: string,
  theirs: string,
  reason: DivergenceReview['reason']
): ReconcileResult {
  return {
    action: reason === 'three-way' || reason === 'vanished' ? 'diverged' : 'escalated',
    review: { guid: lca.guid, path: lca.path, base: lca.baseText, mine, theirs, reason },
  }
}
