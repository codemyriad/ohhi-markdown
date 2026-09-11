import { describe, expect, it } from 'vitest'
import { MemStoreDir } from '../src/store-dir.js'
import { FileJournal } from '../src/file-journal.js'
import { MemJournal, type StoreIo } from '../src/stores.js'
import type { StoreDir } from '../src/store-dir.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

/** Counts writeAtomic (and read) per name — the amplification guard. */
class CountingStoreDir implements StoreDir {
  writes: string[] = []
  reads: string[] = []
  constructor(private inner: StoreDir) {}
  io(name: string): StoreIo {
    const io = this.inner.io(name)
    return {
      read: () => {
        this.reads.push(name)
        return io.read()
      },
      writeAtomic: async (bytes) => {
        this.writes.push(name)
        await io.writeAtomic(bytes)
      },
      binding: { dir: this, name },
    }
  }
  remove(name: string): Promise<void> {
    return this.inner.remove(name)
  }
  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
}

/** A pre-S10 journal on disk: `index.json` plus `<seq>-<path>.bin` entries. */
async function seedLegacyJournal(
  dir: StoreDir,
  entries: { seq: number; path: string; at: number; text: string }[]
): Promise<void> {
  const index = entries.map((e) => ({
    seq: e.seq,
    path: e.path,
    at: e.at,
    file: `journal/${e.seq}-${encodeURIComponent(e.path)}.bin`,
  }))
  for (const [i, e] of entries.entries()) {
    await dir.io(index[i]!.file).writeAtomic(enc(e.text))
  }
  await dir
    .io('journal/index.json')
    .writeAtomic(enc(JSON.stringify({ seq: Math.max(...entries.map((e) => e.seq)), entries: index })))
}

describe('FileJournal', () => {
  it('matches MemJournal semantics for record/entries/latest', async () => {
    let t = 0
    const now = () => ++t
    const dir = new MemStoreDir()
    const file = new FileJournal(dir, { now })
    const mem = new MemJournal(now)

    for (const j of [file, mem]) {
      t = 0
      await j.record('a.md', enc('one'))
      await j.record('b.md', enc('bee'))
      await j.record('a.md', null) // null pre-image → empty bytes (MemJournal parity)
    }

    for (const j of [file, mem]) {
      const all = await j.entries()
      expect(all.map((e) => e.path)).toEqual(['a.md', 'b.md', 'a.md'])
      const a = await j.entries('a.md')
      expect(a).toHaveLength(2)
      expect(dec(a[0]!.bytes)).toBe('one')
      const latest = await j.latest('a.md')
      expect(latest!.bytes).toHaveLength(0)
      expect(await j.latest('missing.md')).toBeNull()
    }
  })

  it('persists across instances over the same StoreDir', async () => {
    const dir = new MemStoreDir()
    const first = new FileJournal(dir, { now: () => 7 })
    await first.record('note.md', enc('pre-image'))

    const second = new FileJournal(dir)
    const latest = await second.latest('note.md')
    expect(latest).not.toBeNull()
    expect(dec(latest!.bytes)).toBe('pre-image')
    expect(latest!.at).toBe(7)
  })

  it('bounds retention per path and removes dropped entry files', async () => {
    const dir = new MemStoreDir()
    const journal = new FileJournal(dir, { retentionPerPath: 3 })
    for (let i = 1; i <= 5; i++) await journal.record('a.md', enc(`v${i}`))
    await journal.record('other.md', enc('kept'))

    const a = await journal.entries('a.md')
    expect(a.map((e) => dec(e.bytes))).toEqual(['v3', 'v4', 'v5']) // oldest dropped
    expect(await journal.entries('other.md')).toHaveLength(1) // per-path, not global

    // Dropped entry files are physically removed; kept files remain.
    const files = await dir.list('journal/')
    expect(files.filter((f) => f.endsWith('.bin'))).toHaveLength(4)
  })

  it('records cost ONE write each — no index rewritten per entry (S10-Q4)', async () => {
    const counting = new CountingStoreDir(new MemStoreDir())
    const journal = new FileJournal(counting, { now: () => 5 })
    const N = 40
    for (let i = 0; i < N; i++) await journal.record(`note-${i}.md`, enc(`pre ${i}`))

    expect(counting.writes).toHaveLength(N)
    expect(counting.writes.every((w) => w.endsWith('.bin'))).toBe(true)
    expect(counting.writes).not.toContain('journal/index.json')
    // The metadata is the NAME, so the listing alone rebuilds the journal.
    expect((await new FileJournal(counting).entries()).map((e) => e.path)).toEqual(
      Array.from({ length: N }, (_, i) => `note-${i}.md`)
    )
  })

  it('a path that looks like a legacy name round-trips (dated notes)', async () => {
    const dir = new MemStoreDir()
    const journal = new FileJournal(dir, { now: () => 11 })
    await journal.record('2024-01-01.md', enc('daily'))
    const reopened = await new FileJournal(dir).latest('2024-01-01.md')
    expect(reopened!.path).toBe('2024-01-01.md')
    expect(dec(reopened!.bytes)).toBe('daily')
    expect(reopened!.at).toBe(11)
  })

  it('reads a pre-S10 journal, dates it from index.json, and drops it when spent', async () => {
    const dir = new MemStoreDir()
    await seedLegacyJournal(dir, [
      { seq: 1, path: 'a.md', at: 100, text: 'old-a1' },
      { seq: 2, path: 'b.md', at: 200, text: 'old-b1' },
      { seq: 3, path: 'a.md', at: 300, text: 'old-a2' },
    ])

    const journal = new FileJournal(dir, { now: () => 400, retentionPerPath: 2 })
    const a = await journal.entries('a.md')
    expect(a.map((e) => dec(e.bytes))).toEqual(['old-a1', 'old-a2'])
    expect(a.map((e) => e.at)).toEqual([100, 300]) // timestamps from the index
    expect(await dir.io('journal/index.json').read()).not.toBeNull() // still needed

    // New entries use the current naming and continue the seq; retention drops
    // the legacy 'a.md' files, and the last one takes index.json with it.
    await journal.record('a.md', enc('new-a3'))
    expect((await journal.entries('a.md')).map((e) => dec(e.bytes))).toEqual(['old-a2', 'new-a3'])
    expect(await dir.io('journal/index.json').read()).not.toBeNull() // 'old-a2' remains
    await journal.record('a.md', enc('new-a4'))
    expect((await journal.entries('a.md')).map((e) => dec(e.bytes))).toEqual(['new-a3', 'new-a4'])
    expect(await dir.io('journal/index.json').read()).not.toBeNull() // 'b.md' remains
    await journal.record('b.md', enc('new-b2'))
    await journal.record('b.md', enc('new-b3'))
    expect(await dir.io('journal/index.json').read()).toBeNull() // last legacy file gone

    // Everything still reads back after a reopen, in seq order.
    const reopened = new FileJournal(dir)
    expect((await reopened.entries()).map((e) => dec(e.bytes))).toEqual([
      'new-a3',
      'new-a4',
      'new-b2',
      'new-b3',
    ])
  })

  it('lists metadata WITHOUT reading a single pre-image back (M11)', async () => {
    const counting = new CountingStoreDir(new MemStoreDir())
    const journal = new FileJournal(counting, { now: () => 5 })
    await journal.record('a.md', enc('one'))
    await journal.record('a.md', enc('twenty-two chars long!'))
    await journal.record('b.md', enc('bee'))

    // A fresh instance, so nothing is cached from the writes above.
    const reader = new FileJournal(counting)
    counting.reads.length = 0
    const rows = await reader.list('a.md')
    expect(rows).toEqual([
      { seq: 1, path: 'a.md', at: 5, size: 3 },
      { seq: 2, path: 'a.md', at: 5, size: 22 },
    ])
    // The whole listing came out of the directory listing: the History rail
    // re-runs this on every flush, and the bytes stay where they are.
    expect(counting.reads).toEqual([])

    // …and `entries` still hands the bytes over, for the restore that asks.
    expect((await reader.entries('a.md')).map((e) => dec(e.bytes))).toEqual([
      'one',
      'twenty-two chars long!',
    ])
    expect(counting.reads).toHaveLength(2)
  })

  it('answers `size` for pre-M11 entries too, by reading only those', async () => {
    const dir = new MemStoreDir()
    // A sizeless name from before M11, beside a current one.
    await dir.io('journal/1.100-a.md.bin').writeAtomic(enc('older'))
    const journal = new FileJournal(dir, { now: () => 200 })
    await journal.record('a.md', enc('newer!'))

    expect(await journal.list('a.md')).toEqual([
      { seq: 1, path: 'a.md', at: 100, size: 5 },
      { seq: 2, path: 'a.md', at: 200, size: 6 },
    ])
  })

  it('renames an entry prefix-wise, keeping seq, time and bytes (M10)', async () => {
    const dir = new MemStoreDir()
    const journal = new FileJournal(dir, { now: () => 42 })
    await journal.record('notes/a.md', enc('v1'))
    await journal.record('notes/a.md', enc('v2'))
    await journal.record('notes/sub/b.md', enc('deep'))
    await journal.record('other.md', enc('untouched'))

    await journal.rename('notes', 'archive')

    expect((await journal.list('notes/a.md'))).toEqual([])
    expect(await journal.list('archive/a.md')).toEqual([
      { seq: 1, path: 'archive/a.md', at: 42, size: 2 },
      { seq: 2, path: 'archive/a.md', at: 42, size: 2 },
    ])
    expect((await journal.entries('archive/sub/b.md')).map((e) => dec(e.bytes))).toEqual(['deep'])
    expect((await journal.entries('other.md')).map((e) => dec(e.bytes))).toEqual(['untouched'])

    // The old entry FILES are gone, and the new names are what a reopen reads
    // — the directory listing is still the whole index.
    const names = await dir.list('journal/')
    expect(names.some((n) => n.includes('notes'))).toBe(false)
    const reopened = new FileJournal(dir)
    expect((await reopened.entries('archive/a.md')).map((e) => dec(e.bytes))).toEqual(['v1', 'v2'])
    // A rename of exactly one file, not a prefix, moves only that file.
    await reopened.rename('other.md', 'renamed.md')
    expect(await reopened.list('other.md')).toEqual([])
    expect((await reopened.entries('renamed.md')).map((e) => dec(e.bytes))).toEqual(['untouched'])
  })

  it('rewrites a pre-S10 entry under a current name, and drops its index', async () => {
    const dir = new MemStoreDir()
    await seedLegacyJournal(dir, [{ seq: 1, path: 'a.md', at: 100, text: 'old' }])
    const journal = new FileJournal(dir, { now: () => 7 })

    await journal.rename('a.md', 'b.md')

    expect(await journal.list('b.md')).toEqual([{ seq: 1, path: 'b.md', at: 100, size: 3 }])
    // Its date is in its own name now, so the index has nothing left to date.
    expect(await dir.io('journal/index.json').read()).toBeNull()
    expect((await new FileJournal(dir).entries('b.md')).map((e) => e.at)).toEqual([100])
  })

  it('drops a pre-S10 index that no longer dates anything, at open', async () => {
    const dir = new MemStoreDir()
    await seedLegacyJournal(dir, [{ seq: 4, path: 'a.md', at: 100, text: 'old' }])
    await dir.remove('journal/4-a.md.bin') // its entry file already aged out

    const journal = new FileJournal(dir, { now: () => 7 })
    expect(await journal.entries()).toEqual([])
    expect(await dir.io('journal/index.json').read()).toBeNull()

    // seq resumes past the legacy index's high-water mark, so no name reuse.
    await journal.record('a.md', enc('fresh'))
    expect(await dir.list('journal/')).toEqual(['journal/5.7.5-a.md.bin']) // seq.at.size
  })
})
