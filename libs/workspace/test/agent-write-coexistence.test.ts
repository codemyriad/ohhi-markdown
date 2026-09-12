/**
 * L1 fixture for spike S11 — agent-write coexistence (agent-surface A11,
 * fork 4-A). The gate on "an agent may write plain files while Editor is
 * running", which `plans/agent-surface-shaping.md` A11 asserts and nothing
 * had exercised with a pane open and a debounced flush pending.
 *
 * The agent here is `ohhi`: a separate process that writes the vault's files
 * through `NodeVaultAdapter.writeAtomic` and knows nothing about the CRDT, the
 * relay or the LCA. `MemVaultAdapter.externalWrite` is exactly that writer —
 * bytes replaced, watcher notified, no Editor-side bookkeeping — so every
 * scenario below drives the real path: watcher → quiesce → classify → act.
 *
 * What has to stay true (spike S11 Q1–Q3, Q5):
 *
 *  - an external write to an OPEN note is INGESTED into the live Y.Text;
 *    open-doc ownership suppresses materialize, never ingest, so the pane
 *    shows the agent's edit and Editor writes no bytes of its own;
 *  - with a local edit pending, the agent's write is a three-way review and
 *    the pending flush writes NOTHING — a flush is a reconcile with ownership
 *    suspended, not a blind write;
 *  - an external write that restores a recently flushed state escalates as
 *    `stale-echo` rather than ingesting, and both candidates survive;
 *  - a watch batch over the mass-change threshold trips the breaker, which
 *    with no host affordance auto-confirms and says so on the console.
 *
 * Plus one honest finding, pinned as `it.fails`: F1, the materialize window.
 *
 * Everything runs on the SimClock (`bootVault` wires one): quiesce, the flush
 * debounce and the breaker are all clock-driven, so every ordering below is
 * chosen, not raced.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  FileJournal,
  MemStoreDir,
  scopedStoreDir,
  type MemVaultAdapter,
} from '@editor/vault'
import { bootVault, dec, enc, seedAdapter, type BootedVault } from './fixture.js'

const ROOT_ROOM = 'root-room'

/** `VaultSession`'s default double-read delay (libs/vault/src/session.ts). */
const QUIESCE_MS = 30
/** `FLUSH_DEBOUNCE_MS` in libs/workspace/src/mount-session.ts. */
const FLUSH_DEBOUNCE_MS = 800
/** `DEFAULT_THRESHOLDS.massChangePaths` in libs/vault/src/types.ts. */
const MASS_CHANGE_PATHS = 20

const yieldMacro = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

/**
 * Records every disk write Editor makes, so "did that ingest write bytes?" is
 * answerable. A local twin of `multi-view-lifecycle.test.ts`'s helper —
 * copied rather than shared while the agent-surface branch is in flight (both
 * belong in `fixture.ts`; flagged for the review pass).
 */
function watchWrites(adapter: MemVaultAdapter): { paths: string[]; reset: () => void } {
  const paths: string[] = []
  const real = adapter.writeAtomic.bind(adapter)
  adapter.writeAtomic = async (path: string, bytes: Uint8Array): Promise<void> => {
    paths.push(path)
    await real(path, bytes)
  }
  return { paths, reset: () => paths.splice(0, paths.length) }
}

/** Let the promise chains a synchronous event started run to a standstill. */
async function drain(turns = 12): Promise<void> {
  for (let i = 0; i < turns; i++) await yieldMacro()
}

/**
 * Drive one watch event through quiesce to a classification.
 *
 * `quiesceThenReconcile` reads, schedules `quiesceMs`, reads again, and only
 * then classifies — so a watch event needs both microtask turns AND a clock
 * advance. Deliberately advances far less than `FLUSH_DEBOUNCE_MS`: the
 * scenarios below turn on the flush NOT having fired yet.
 */
async function settleWatch(vault: BootedVault): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await drain(4)
    vault.clock.advance(QUIESCE_MS)
  }
  await drain()
}

/** Let the open-doc flush debounce fire, and settle the write it causes. */
async function settleFlush(vault: BootedVault): Promise<void> {
  vault.clock.advance(FLUSH_DEBOUNCE_MS + 50)
  await drain()
  await settleWatch(vault) // the materialize's own write wakes the watcher
}

/** Read the room's pre-image journal back — bytes included (fileHistory omits them). */
function journalOf(vault: BootedVault): FileJournal {
  return new FileJournal(scopedStoreDir(vault.vaultDir, `${ROOT_ROOM}/`))
}

const guidOf = (vault: BootedVault, path: string): string =>
  vault.root.files().find((r) => r.path === path)!.guid

describe('S11 — an agent writes files while Editor is running', () => {
  it('Q1: an external write to an OPEN note is ingested into the live Y.Text; Editor writes nothing', async () => {
    const base = await seedAdapter({ 'note.md': 'one\ntwo\nthree\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    try {
      // A pane holds the note: the editor owns the file (golden rule 1's
      // "one writer per path"), which is what makes this the interesting case.
      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      const doc = vault.root.docForPath('note.md')!
      const origins: unknown[] = []
      const off = vault.engine.onUpdate(doc, (_u, origin) => origins.push(origin))

      // `ohhi patch note.md` — a plain atomic file write from another process.
      const agentText = 'one\ntwo — agent\nthree\n'
      base.externalWrite('note.md', enc.encode(agentText))
      writes.reset()
      await settleWatch(vault)

      // Ingested: the open buffer now holds the agent's edit. This is the
      // whole of A11 — materialize is what open-doc ownership skips, ingest
      // is not (reconciler.ts checks `openPaths` only in the disk-unchanged,
      // doc-ahead branch).
      expect(doc.getText()).toBe(agentText)

      // As ONE transaction tagged 'disk' — a minimal dmp diff applied as
      // ordinary ops, never delete-all + reinsert (primer 03, invariant 2).
      // That single 'disk' transaction is what `yCollab`'s ySync remaps a
      // caret through; the caret itself is CM6's and is asserted at L2.
      expect(origins).toEqual(['disk'])

      // Editor wrote no bytes: the file on disk is still literally the
      // agent's own write, so `git diff` shows the agent's change and nothing
      // else, and nothing was journaled because nothing Editor-initiated
      // touched the file.
      expect(writes.paths).toEqual([])
      expect(dec.decode((await base.read('note.md'))!)).toBe(agentText)
      expect(await vault.root.fileHistory('note.md')).toEqual([])

      // No review, no escalation: this is the clean quadrant.
      expect(vault.events.reviews).toEqual([])
      expect(vault.events.errors).toEqual([])
      off()
    } finally {
      vault.dispose()
    }
  })

  it('Q1: the ingest does not arm a flush — a disk-origin update never writes back', async () => {
    const base = await seedAdapter({ 'note.md': 'one\ntwo\nthree\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    try {
      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      base.externalWrite('note.md', enc.encode('agent wrote this\n'))
      writes.reset()
      await settleWatch(vault)
      expect(vault.root.docForPath('note.md')!.getText()).toBe('agent wrote this\n')

      // Long past the flush debounce: `routeDocUpdate` returns early for
      // origin 'disk', so no debounce was ever armed and the agent's bytes are
      // never rewritten by the editor that just ingested them. (A write-back
      // would be harmless byte-wise here but would churn mtime and, on a CRLF
      // or BOM file, is where spurious diffs come from.)
      vault.clock.advance(FLUSH_DEBOUNCE_MS * 4)
      await drain()
      expect(writes.paths).toEqual([])
      expect(await vault.root.fileHistory('note.md')).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('Q2: with a local edit pending, the agent write is a three-way review and the pending flush writes NOTHING', async () => {
    const base = await seedAdapter({ 'note.md': 'one\ntwo\nthree\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    try {
      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      const guid = guidOf(vault, 'note.md')
      const doc = vault.root.docForPath('note.md')!

      // The human types. The doc is now ahead of the LCA, disk is not, and an
      // 800 ms flush debounce is armed.
      doc.transact((t) => t.insert(0, 'human '), 'local')
      await drain(2)

      // The agent writes the copy it read a moment ago. Both sides have moved.
      const agentText = 'one\ntwo — agent\nthree\n'
      base.externalWrite('note.md', enc.encode(agentText))
      writes.reset()
      await settleWatch(vault) // still well inside the debounce window

      expect(vault.events.reviews).toEqual([
        {
          guid,
          path: 'note.md',
          reason: 'three-way',
          mine: 'human one\ntwo\nthree\n',
          theirs: agentText,
        },
      ])
      // Nothing written, nothing journaled: the human's sentence lives in the
      // CRDT, the agent's bytes live on disk, and the review names both.
      expect(writes.paths).toEqual([])
      expect(dec.decode((await base.read('note.md'))!)).toBe(agentText)
      expect(doc.getText()).toBe('human one\ntwo\nthree\n')

      // Now let the pending flush fire. `VaultSession.flush` suspends
      // open-path ownership for its own turn and reconciles — it is NOT a
      // blind write — so with both sides still ahead of the LCA it classifies
      // three-way again and the agent's bytes stay untouched.
      vault.clock.advance(FLUSH_DEBOUNCE_MS + 200)
      await drain()
      expect(writes.paths).toEqual([])
      expect(dec.decode((await base.read('note.md'))!)).toBe(agentText)
      expect(doc.getText()).toBe('human one\ntwo\nthree\n')
      expect(await vault.root.fileHistory('note.md')).toEqual([])
      expect(vault.events.reviews.every((r) => r.reason === 'three-way')).toBe(true)
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('Q2: resolving the review writes once, journaling the agent bytes it replaces', async () => {
    const base = await seedAdapter({ 'note.md': 'one\ntwo\nthree\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    try {
      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      const guid = guidOf(vault, 'note.md')
      const doc = vault.root.docForPath('note.md')!
      doc.transact((t) => t.insert(0, 'human '), 'local')
      await drain(2)
      const agentText = 'one\ntwo — agent\nthree\n'
      base.externalWrite('note.md', enc.encode(agentText))
      await settleWatch(vault)
      expect(vault.events.reviews.at(-1)?.reason).toBe('three-way')

      // The human picks a merge. `resolveDivergence` applies it as ops and
      // materializes, journaling what is on disk FIRST — so the agent's bytes
      // are recoverable through `ohhi restore` afterwards, not discarded.
      const merged = 'human one\ntwo — agent\nthree\n'
      await vault.root.resolveReview(guid, merged)
      await drain()

      expect(doc.getText()).toBe(merged)
      expect(dec.decode((await base.read('note.md'))!)).toBe(merged)
      const pre = (await journalOf(vault).entries('note.md')).map((e) => dec.decode(e.bytes))
      expect(pre).toEqual([agentText])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('Q3: an external write that restores a recently flushed state escalates as stale-echo', async () => {
    const base = await seedAdapter({ 'note.md': 'v0\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    try {
      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      const guid = guidOf(vault, 'note.md')
      const doc = vault.root.docForPath('note.md')!

      // Flush #1 — Editor writes v1 and remembers its content hash.
      doc.transact((t) => t.insert(0, 'v1 '), 'local')
      await settleFlush(vault)
      const v1Bytes = (await base.read('note.md'))!
      expect(dec.decode(v1Bytes)).toBe('v1 v0\n')

      // Flush #2 — Editor moves past it. The ring now holds [h(v1), h(v2)].
      doc.transact((t) => t.insert(0, 'v2 '), 'local')
      await settleFlush(vault)
      expect(dec.decode((await base.read('note.md'))!)).toBe('v2 v1 v0\n')

      // Two Editor-initiated writes, two journal entries. `seq` is allocated
      // by THIS journal only and `at` comes from the injected clock — the two
      // facts S11-Q4's union rests on.
      const flushed = await vault.root.fileHistory('note.md')
      expect(flushed.map((e) => e.seq)).toEqual([2, 1]) // newest first
      expect(flushed[0]!.at).toBeGreaterThan(flushed[1]!.at)

      // The agent puts the EARLIER flushed state back, byte-identical: its own
      // revert, or `ohhi restore` of a pre-image, or another editor's stale
      // autosave buffer. The reconciler cannot tell those apart, and treats
      // all three the same way — escalate, never auto-ingest (spike S6).
      const writes = watchWrites(base)
      base.externalWrite('note.md', v1Bytes)
      await settleWatch(vault)

      expect(vault.events.reviews.at(-1)).toEqual({
        guid,
        path: 'note.md',
        reason: 'stale-echo',
        mine: 'v2 v1 v0\n',
        theirs: 'v1 v0\n',
      })
      // No data loss in either direction: the CRDT still holds v2, the disk
      // still holds the agent's v1, and nothing was written over.
      expect(doc.getText()).toBe('v2 v1 v0\n')
      expect(dec.decode((await base.read('note.md'))!)).toBe('v1 v0\n')
      expect(writes.paths).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('Q3: an external write to a state Editor never flushed is an ordinary ingest', async () => {
    const base = await seedAdapter({ 'note.md': 'v0\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    try {
      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      const doc = vault.root.docForPath('note.md')!
      doc.transact((t) => t.insert(0, 'v1 '), 'local')
      await settleFlush(vault)

      // Not in the ring: the guard is content-hash equality with something
      // Editor itself wrote, so an agent's NEW text never trips it however
      // large the revert looks.
      base.externalWrite('note.md', enc.encode('agent rewrote it\n'))
      await settleWatch(vault)
      expect(doc.getText()).toBe('agent rewrote it\n')
      expect(vault.events.reviews).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('Q5: a 25-path watch batch trips the mass-change breaker and auto-confirms headless, with a warning', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`n${i}.md`] = `note ${i}\n`
    const base = await seedAdapter(files)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const writes = watchWrites(base)
    try {
      const paths = Object.keys(files)
      expect(paths.length).toBeGreaterThan(MASS_CHANGE_PATHS)

      // A CLI burst as ONE coalesced watch batch (`emitBatch` is the watcher
      // shape a debouncing/coalescing platform watcher produces).
      base.autoEmit = false
      for (const p of paths) base.externalWrite(p, enc.encode(`${files[p]!.trim()} — agent\n`))
      base.emitBatch(paths)

      // No host `onBreaker` affordance in this fixture (a headless run, or the
      // CLI-driven app before the confirm UI is mounted): the batch is held,
      // the warning is printed, and the batch is auto-confirmed.
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalledWith(
        '[workspace] mass-change breaker tripped — auto-confirming',
        expect.arrayContaining(paths)
      )

      await drain(120)
      for (const p of paths) {
        expect(vault.root.docForPath(p)!.getText()).toBe(`${files[p]!.trim()} — agent\n`)
      }
      // Confirming ingests; it never writes disk and never journals.
      expect(writes.paths).toEqual([])
      expect(vault.events.reviews).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      warn.mockRestore()
      vault.dispose()
    }
  })

  it('Q5: a batch AT the threshold does not trip the breaker — it is `> massChangePaths`', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < MASS_CHANGE_PATHS; i++) files[`n${i}.md`] = `note ${i}\n`
    const base = await seedAdapter(files)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      const paths = Object.keys(files)
      base.autoEmit = false
      for (const p of paths) base.externalWrite(p, enc.encode(`${files[p]!.trim()} — agent\n`))
      base.emitBatch(paths)

      expect(warn).not.toHaveBeenCalled()
      await settleWatch(vault)
      await drain(60)
      for (const p of paths) {
        expect(vault.root.docForPath(p)!.getText()).toBe(`${files[p]!.trim()} — agent\n`)
      }
      expect(vault.events.reviews).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      warn.mockRestore()
      vault.dispose()
    }
  })

  it('Q5: 25 writes arriving as 25 separate watch events never reach the breaker', async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 25; i++) files[`n${i}.md`] = `note ${i}\n`
    const base = await seedAdapter(files)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      // This is what `NodeVaultAdapter.watch` actually delivers: `node:fs`
      // hands one filename per callback, so it emits `{paths: [one]}` every
      // time. `onWatch` counts KNOWN paths per EVENT, so 25 sequential writes
      // are 25 batches of one and the breaker is unreachable from a CLI burst
      // on Node — the finding behind S11-Q5's answer.
      const paths = Object.keys(files)
      for (const p of paths) base.externalWrite(p, enc.encode(`${files[p]!.trim()} — agent\n`))
      await settleWatch(vault)
      await drain(60)

      expect(warn).not.toHaveBeenCalled()
      for (const p of paths) {
        expect(vault.root.docForPath(p)!.getText()).toBe(`${files[p]!.trim()} — agent\n`)
      }
      expect(vault.events.errors).toEqual([])
    } finally {
      warn.mockRestore()
      vault.dispose()
    }
  })
})

describe('S11 — findings (known-bad behaviour, pinned)', () => {
  /**
   * FINDING F1 — the materialize window.
   *
   * `reconcileFile` reads the file to classify (disk == LCA, doc ahead →
   * materialize), then `materialize` journals the PRE-IMAGE IT ALREADY READ
   * and only afterwards calls `writeAtomic`. Between those two points there
   * are awaits (the journal's durable write). An external write that lands in
   * that window is overwritten by the flush, and it survives NOWHERE: not on
   * disk (replaced), not in Editor's journal (which holds the pre-agent
   * bytes), and in no review (the classification already happened).
   *
   * Narrow — it needs the agent's rename to land inside one journal write of
   * an open note's flush — but real, and it is the one ordering in which
   * fork 4-A's "the reconciler ingests it" promise does not hold. The fix is a
   * compare-and-swap: re-read and re-hash inside the exclusive turn
   * immediately before `writeAtomic`, and reclassify instead of writing if the
   * hash moved. Not fixed here (Spike S11 owns the fixture, not the library).
   *
   * `it.fails` so the assertion is a ratchet: when the CAS lands, this test
   * starts failing and both this file and the spike must be updated.
   */
  it.fails('F1: an external write landing inside materialize is lost with no journal entry and no review', async () => {
    const base = await seedAdapter({ 'note.md': 'one\ntwo\nthree\n' })
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const agentText = 'one\ntwo — agent\nthree\n'
    try {
      // The agent's rename wins the race to the inode a moment before
      // Editor's — after Editor read the file and decided to materialize.
      const real = base.writeAtomic.bind(base)
      let armed = true
      base.writeAtomic = async (path: string, bytes: Uint8Array): Promise<void> => {
        if (armed && path === 'note.md') {
          armed = false
          base.externalWrite(path, enc.encode(agentText))
        }
        await real(path, bytes)
      }

      vault.root.setOpenPaths(new Set(['note.md']))
      await drain(2)
      vault.root.docForPath('note.md')!.transact((t) => t.insert(0, 'human '), 'local')
      await drain(2)
      await settleFlush(vault)
      expect(armed).toBe(false) // the race actually happened

      const onDisk = dec.decode((await base.read('note.md'))!)
      const journaled = (await journalOf(vault).entries('note.md')).map((e) => dec.decode(e.bytes))
      const reviewed = vault.events.reviews.some((r) => r.theirs === agentText)

      // The agent's bytes must survive SOMEWHERE. Today they survive nowhere.
      expect(onDisk === agentText || journaled.includes(agentText) || reviewed).toBe(true)
    } finally {
      vault.dispose()
    }
  })
})
