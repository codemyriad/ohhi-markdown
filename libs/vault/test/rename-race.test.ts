/**
 * Regression fixtures for the rename race (QA 2026-10-16, the desktop app):
 * renaming a note from its inline title kicked its tab back to an empty tab,
 * and a "Divergence review — <new name>.md, reason: vanished" followed.
 *
 * Two defects in `VaultSession.renameFile` / `renameDir`, each pinned here:
 *
 *  1. THE RENAME WAS NOT SERIALIZED WITH THE RECONCILER. The desktop's native
 *     watcher reports the rename while `renameFile` is still awaiting the
 *     journal and the LCA store, and a watch-driven reconcile of the OLD
 *     path ran in that window: the LCA still named the old path, the disk
 *     no longer had it, and the reconciler classified a file that had merely
 *     moved as externally deleted — a 'vanished' review. The rename now runs
 *     inside the per-doc exclusive section, so a reconcile for that doc waits
 *     until the rename has fully landed (disk, map, LCA) and then sees a
 *     file at its new path, unchanged.
 *
 *  2. THE HOST HEARD ABOUT THE RENAME TOO LATE. The folder map changed (and
 *     the host's file list with it) the moment the map transaction ran, but
 *     `onPathsRenamed` fired only after the journal and LCA awaits — on a
 *     desktop, real disk I/O. The shell's tab layer prunes tabs whose path
 *     has left the file list after a settle period, so a slow rename closed
 *     the tab at the old path before it was told the new one (S9-Q4: "a
 *     rename must reach the tabs in the same turn the file list changes").
 *     The event now fires in that same turn, before any further await.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import { enrollFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { VaultSession } from '../src/session.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import type { DivergenceReview } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

/**
 * A journal whose `rename` parks until released — the deterministic stand-in
 * for the desktop's `.ohhi/` disk I/O, which is what gave the watcher its
 * window.
 */
class GatedJournal extends MemJournal {
  private gates: (() => void)[] = []
  gateRenames = false
  get parked(): number {
    return this.gates.length
  }
  override async rename(from: string, to: string): Promise<void> {
    if (this.gateRenames) await new Promise<void>((r) => this.gates.push(r))
    return super.rename(from, to)
  }
  release(): void {
    this.gates.shift()?.()
  }
}

async function vault(files: Record<string, string>) {
  const engine = createYjsEngine()
  const adapter = new MemVaultAdapter() // emits watch events on rename, like the desktop's watcher
  const lcaStore = new MemLcaStore()
  const journal = new GatedJournal()
  const clock = new SimClock()
  for (const [path, text] of Object.entries(files)) await adapter.writeAtomic(path, enc(text))
  const folderDoc = engine.createDoc('room/folder')
  const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore)
  const reviews: DivergenceReview[] = []
  const moves: { from: string; to: string }[] = []
  const session = new VaultSession({
    engine,
    adapter,
    lcaStore,
    journal,
    clock,
    folderDoc,
    docs,
    events: {
      onReview: (r) => reviews.push(r),
      onPathsRenamed: (m) => moves.push(...m),
    },
  })
  await session.start()
  return { engine, adapter, lcaStore, journal, clock, folderDoc, docs, session, reviews, moves }
}

describe('rename races (regression: the desktop rename, 2026-10-16)', () => {
  it('a watcher event for the old path mid-rename never raises a vanished review', async () => {
    const v = await vault({ 'My first note.md': 'This is' })
    const guid = v.folderDoc.getMap().get('My first note.md')!.guid

    // The rename reaches the disk and the map, then parks in the journal —
    // exactly where a desktop rename spends its time.
    v.journal.gateRenames = true
    const rename = v.session.renameFile('My first note.md', 'My first no.md')
    await settle()
    expect(v.journal.parked).toBe(1)
    expect(await v.adapter.read('My first note.md')).toBeNull()

    // The watcher's quiesce (two reads of the old path, both gone) fires and
    // asks for a reconcile of the old path while the rename is in flight.
    v.clock.advance(30)
    await settle()
    await settle()

    v.journal.release()
    await rename
    await settle()
    v.clock.advance(100)
    await settle()

    // Pre-fix: one 'vanished' review for the note that merely moved.
    expect(v.reviews.map((r) => r.reason)).toEqual([])
    expect(v.session.pendingReviews()).toEqual([])
    expect(dec(await v.adapter.read('My first no.md'))).toBe('This is')
    expect((await v.lcaStore.get(guid))?.path).toBe('My first no.md')
    expect(v.moves).toEqual([{ from: 'My first note.md', to: 'My first no.md' }])
  })

  it('the host hears about a file rename in the turn the map changes, before the journal and LCA awaits', async () => {
    const v = await vault({ 'notes/a.md': 'A' })
    v.journal.gateRenames = true
    const rename = v.session.renameFile('notes/a.md', 'notes/b.md')
    await settle()
    expect(v.journal.parked).toBe(1)
    // The map already says the new path — and so does the host.
    expect(v.folderDoc.getMap().get('notes/b.md')).toBeTruthy()
    expect(v.folderDoc.getMap().get('notes/a.md')).toBeUndefined()
    expect(v.moves).toEqual([{ from: 'notes/a.md', to: 'notes/b.md' }])
    v.journal.release()
    await rename
  })

  it('a dir rename: the same, for every file under it, and no review from the watcher', async () => {
    const v = await vault({ 'old/one.md': '1', 'old/two.md': '2', 'other.md': 'x' })
    const one = v.folderDoc.getMap().get('old/one.md')!.guid
    v.journal.gateRenames = true
    const rename = v.session.renameDir('old', 'new')
    await settle()
    expect(v.journal.parked).toBe(1)
    expect(v.moves.sort((a, b) => a.from.localeCompare(b.from))).toEqual([
      { from: 'old', to: 'new' },
      { from: 'old/one.md', to: 'new/one.md' },
      { from: 'old/two.md', to: 'new/two.md' },
    ])

    v.clock.advance(30)
    await settle()
    await settle()
    v.journal.release()
    await rename
    await settle()
    v.clock.advance(100)
    await settle()

    expect(v.reviews).toEqual([])
    expect(v.session.pendingReviews()).toEqual([])
    expect((await v.lcaStore.get(one))?.path).toBe('new/one.md')
    expect(dec(await v.adapter.read('new/two.md'))).toBe('2')
  })
})
