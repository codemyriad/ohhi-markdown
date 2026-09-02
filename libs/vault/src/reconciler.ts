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
 */
import DiffMatchPatch from 'diff-match-patch'
import type { EngineDoc, SyncEngine } from '@editor/sync'
import { decodeFile, renderFile } from './eol.js'
import { hashBytes } from './hash.js'
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
  const { engine, adapter, lcaStore, journal, thresholds } = ctx
  const diskBytes = await adapter.read(lca.path)
  if (diskBytes === null) {
    if (lca.contentHash === '') {
      // Never existed on disk (remote-created file): materialize creates it.
      if (doc.getText().length === 0) return { action: 'noop' }
      return materialize(ctx, doc, lca, null)
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
    return materialize(ctx, doc, lca, diskBytes)
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
  preImage: Uint8Array | null
): Promise<ReconcileResult> {
  const { engine, adapter, lcaStore, journal } = ctx
  const text = doc.getText()
  const bytes = renderFile(text, lca.eol, lca.bom)
  await journal.record(lca.path, preImage)
  await adapter.writeAtomic(lca.path, bytes)
  const newHash = hashBytes(bytes)
  rememberFlush(ctx, lca.path, newHash)
  await lcaStore.put({
    ...lca,
    baseText: text,
    contentHash: newHash,
    heads: engine.encodeHeads(engine.heads(doc)),
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
  return materialize(ctx, doc, lca, preImage)
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
