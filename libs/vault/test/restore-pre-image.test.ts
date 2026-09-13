/**
 * Restoring a journaled pre-image (W3, the History rail section).
 *
 * The contract these assert is the one the UI depends on: the pre-image goes
 * back through the CRDT + materialize path, so the CRDT and disk agree
 * afterwards, the bytes that were on disk are journaled first (a restore is
 * itself undoable), the file's EOL flavour survives, and a path with no live
 * doc is refused rather than written over.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import {
  enrollFolder,
  MemJournal,
  MemLcaStore,
  MemVaultAdapter,
  VaultSession,
} from '../src/index.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

async function harness(initial = 'v1\n') {
  const engine = createYjsEngine()
  const adapter = new MemVaultAdapter()
  await adapter.writeAtomic('a.md', enc.encode(initial))
  const lcaStore = new MemLcaStore()
  const clock = new SimClock()
  const journal = new MemJournal(() => clock.now())
  const folderDoc = engine.createDoc('r/folder')
  const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore)
  /** Reviews raised and cleared, in order — the rail/modal's whole input. */
  const reviews: string[] = []
  const cleared: string[] = []
  const session = new VaultSession({
    engine,
    adapter,
    lcaStore,
    journal,
    clock,
    folderDoc,
    docs,
    events: {
      onReview: (r) => reviews.push(r.guid),
      onReviewCleared: (g) => cleared.push(g),
    },
  })
  await session.start()
  const guid = folderDoc.getMap().get('a.md')!.guid
  const doc = docs.get(guid)!
  /**
   * Edit through the CRDT and flush it to disk. The debounce that calls
   * `flush` lives in MountSession, so a VaultSession-level test drives it
   * directly — same entry point, no timers to chase.
   */
  const edit = async (text: string): Promise<void> => {
    doc.transact((t) => {
      t.delete(0, doc.getText().length)
      t.insert(0, text)
    }, 'local')
    await session.flush(guid)
  }
  return { adapter, journal, session, doc, guid, edit, reviews, cleared }
}

describe('VaultSession.restoreFile', () => {
  it('puts a pre-image back on disk AND in the CRDT', async () => {
    const h = await harness('v1\n')
    await h.edit('v2\n')
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('v2\n')

    const entries = await h.journal.entries('a.md')
    const v1 = entries.find((e) => dec.decode(e.bytes) === 'v1\n')!
    expect(v1.seq).toBeGreaterThan(0)
    await h.session.restoreFile('a.md', v1.bytes)

    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('v1\n')
    // The CRDT is the source of truth for peers: it moved too, so nobody
    // re-materializes 'v2' over the restore on their next reconcile.
    expect(h.doc.getText()).toBe('v1\n')
  })

  it('journals what it replaced, so the restore is itself undoable', async () => {
    const h = await harness('v1\n')
    await h.edit('v2\n')
    const before = await h.journal.entries('a.md')
    await h.session.restoreFile('a.md', enc.encode('v1\n'))

    const after = await h.journal.entries('a.md')
    expect(after.length).toBe(before.length + 1)
    expect(dec.decode(after.at(-1)!.bytes)).toBe('v2\n')
    // Seqs are unique and monotonic — the id the History list names a row by.
    expect(new Set(after.map((e) => e.seq)).size).toBe(after.length)
    expect(after.at(-1)!.seq).toBeGreaterThan(before.at(-1)!.seq)
  })

  it("keeps the file's EOL flavour rather than the pre-image's", async () => {
    const h = await harness('v1\r\nline\r\n')
    await h.edit('v2\nline\n')
    // A pre-image handed back as LF must not silently flip a CRLF file.
    await h.session.restoreFile('a.md', enc.encode('v1\nline\n'))
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('v1\r\nline\r\n')
  })

  it('refuses a path that is not a live note', async () => {
    const h = await harness()
    await expect(h.session.restoreFile('nope.md', enc.encode('x')))
      .rejects.toThrow(/not a live note/)
  })

  /**
   * The window that made a restore lossy (M9): for an OPEN note, disk lags the
   * editor by the flush debounce, and `resolveDivergence` journals what is on
   * disk. A sentence typed just before Restore was therefore deleted by
   * `applyDiffsAsOps` while being in no journal entry, no LCA, and — its ops
   * carrying origin 'disk' — out of the UndoManager's reach.
   */
  it('flushes the open doc first, so an unflushed edit is journaled not lost', async () => {
    const h = await harness('v1\n')
    await h.edit('v2\n')
    const v1 = (await h.journal.entries('a.md')).find((e) => dec.decode(e.bytes) === 'v1\n')!

    // A view holds the note and a sentence has just been typed: the CRDT is
    // ahead of disk, and no debounce has fired.
    h.session.markOpen(h.guid)
    h.doc.transact((t) => t.insert(0, 'typed '), 'local')
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('v2\n')

    await h.session.restoreFile('a.md', v1.bytes)

    // What the editor held when Restore was pressed is IN the journal — one
    // row of this same list away — rather than gone.
    const texts = (await h.journal.entries('a.md')).map((e) => dec.decode(e.bytes))
    expect(texts).toContain('typed v2\n')
    expect(h.doc.getText()).toBe('v1\n')
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('v1\n')
    // The note is still open: the flush's suspension was a bracket, not a close.
    h.doc.transact((t) => t.insert(0, 'after '), 'local')
    await h.session.flush(h.guid)
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('after v1\n')
  })

  it('clears a pending divergence review — the restore IS the resolution', async () => {
    const h = await harness('v1\n')
    await h.edit('v2\n')
    // Both sides moved: the reconcile raises a review and writes nothing.
    await h.adapter.writeAtomic('a.md', enc.encode('from obsidian\n'))
    h.doc.transact((t) => t.insert(0, 'mine '), 'local')
    await h.session.flush(h.guid)
    expect(h.session.pendingReviews().map((r) => r.guid)).toEqual([h.guid])
    expect(h.cleared).toEqual([])

    await h.session.restoreFile('a.md', enc.encode('v1\n'))

    // A modal left open over a file that is now exactly what was asked for is
    // the same lie as a stale pill (golden rule 4).
    expect(h.session.pendingReviews()).toEqual([])
    expect(h.cleared).toEqual([h.guid])
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('v1\n')
  })
})
