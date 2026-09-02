import { describe, expect, it } from 'vitest'
import { MemStoreDir } from '../src/store-dir.js'
import { FileJournal } from '../src/file-journal.js'
import { MemJournal } from '../src/stores.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array) => new TextDecoder().decode(b)

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

    // Dropped entry files are physically removed; index + kept files remain.
    const files = await dir.list('journal/')
    expect(files.filter((f) => f.endsWith('.bin'))).toHaveLength(4)
  })
})
