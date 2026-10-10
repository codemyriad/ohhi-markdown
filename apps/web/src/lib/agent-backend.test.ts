import { describe, expect, it } from 'vitest'
import { MemoryIndex } from '@ohhi/index'
import { decodeFile, MemJournal } from '@ohhi/vault'
import { createAppBackend, RefusedError, type AppBackendHost } from './agent-backend.js'
import type { FileRow } from './workspace.svelte.js'

const enc = new TextEncoder()

/**
 * A small in-memory host: `plan.md` is enrolled (a live Y.Text that is AHEAD
 * of its disk copy), `crlf.md` is enrolled and caught up but CRLF on disk,
 * `local.md` is tracked (no doc), `img.png` a binary.
 */
function setup() {
  const disk = new Map<string, Uint8Array>([
    ['notes/plan.md', enc.encode('# Plan\n\nold disk text\n')],
    ['notes/crlf.md', enc.encode('one\r\ntwo\r\n')],
    ['local.md', enc.encode('tracked [[plan]]\n')],
    ['notes/img.png', new Uint8Array([1, 2, 3, 4, 5])],
  ])
  const live = new Map<string, string>([
    ['notes/plan.md', '# Plan\n\nunsaved live text [[local]]\n'],
    ['notes/crlf.md', 'one\ntwo\n'],
  ])
  const rows: FileRow[] = [
    { path: 'notes', guid: 'd1', kind: 'dir' },
    { path: 'notes/plan.md', guid: 'g-plan', kind: 'text' },
    { path: 'notes/crlf.md', guid: 'g-crlf', kind: 'text' },
    { path: 'local.md', guid: 'g-local', kind: 'text' },
    { path: 'notes/img.png', guid: 'g-img', kind: 'binary' },
  ]
  const index = new MemoryIndex()
  index.rebuild([
    { guid: 'g-plan', path: 'notes/plan.md', text: live.get('notes/plan.md')! },
    { guid: 'g-local', path: 'local.md', text: 'tracked [[plan]]\n' },
  ])
  const journal = new MemJournal()
  const host: AppBackendHost = {
    root: 'room-1',
    clock: { now: () => 0, schedule: () => () => {} },
    index,
    files: () => rows,
    liveText: (p) => live.get(p) ?? null,
    readFileBytes: async (p) => disk.get(p) ?? null,
    journal: () => journal,
  }
  return { backend: createAppBackend(host), disk, live, journal }
}

const text = (bytes: Uint8Array | null): string | null => (bytes ? decodeFile(bytes).text : null)

describe('createAppBackend', () => {
  it('reads an enrolled note from its live text, never the stale disk copy', async () => {
    const { backend } = setup()
    expect(text(await backend.adapter.read('notes/plan.md'))).toBe('# Plan\n\nunsaved live text [[local]]\n')
    const docs = await backend.docs()
    expect(docs.get('notes/plan.md')).toEqual({ guid: 'g-plan', path: 'notes/plan.md', text: '# Plan\n\nunsaved live text [[local]]\n' })
  })

  it('serves a caught-up note as the disk bytes (same hash), and a changed one in the disk’s EOL', async () => {
    const { backend, disk, live } = setup()
    // Caught up: the exact disk bytes, CRLF and all.
    expect(await backend.adapter.read('notes/crlf.md')).toBe(disk.get('notes/crlf.md'))
    // Ahead of disk: the live text, rendered CRLF like the file it will become.
    live.set('notes/crlf.md', 'one\ntwo\nthree\n')
    expect(new TextDecoder().decode((await backend.adapter.read('notes/crlf.md'))!)).toBe('one\r\ntwo\r\nthree\r\n')
  })

  it('reads a tracked file (no doc) from its mount', async () => {
    const { backend } = setup()
    expect(text(await backend.adapter.read('local.md'))).toBe('tracked [[plan]]\n')
    expect((await backend.docs()).get('local.md')?.text).toBe('tracked [[plan]]\n')
  })

  it('lists files, dirs and coverage from the workspace rows', async () => {
    const { backend } = setup()
    const files = await backend.files()
    expect([...files.keys()].sort()).toEqual(['local.md', 'notes/crlf.md', 'notes/img.png', 'notes/plan.md'])
    expect(files.get('notes/img.png')).toEqual({ path: 'notes/img.png', size: 5, mtime: null, kind: 'binary' })
    expect(files.get('local.md')?.kind).toBe('text')
    expect(await backend.dirs()).toEqual(['notes'])
    expect(await backend.exists('notes')).toBe('dir')
    expect(await backend.exists('local.md')).toBe('file')
    expect(await backend.exists('nope.md')).toBeNull()
    const coverage = await backend.coverage()
    expect(coverage).toMatchObject({ docs: 3, skippedBinary: 1 })
    expect(coverage.ignored).toContain('.ohhi')
  })

  it('answers the guid-keyed index queries by path', async () => {
    const { backend } = setup()
    const index = await backend.index()
    const out = await index.outgoing('notes/plan.md')
    expect(out.items.map((l) => l.target)).toEqual(['local'])
    const back = await index.backlinks('notes/plan.md')
    expect(back.items.map((l) => l.path)).toEqual(['local.md'])
  })

  it('refuses every write this wave, and journals nothing', async () => {
    const { backend, journal } = setup()
    await expect(backend.adapter.writeAtomic('notes/plan.md', enc.encode('x'))).rejects.toBeInstanceOf(RefusedError)
    await expect(backend.adapter.rename('a', 'b')).rejects.toThrow(/^refused: /)
    await expect(backend.adapter.remove('a')).rejects.toThrow(RefusedError)
    await expect(backend.journal.record('notes/plan.md', enc.encode('pre'))).rejects.toThrow(RefusedError)
    expect(await journal.list()).toEqual([])
  })

  it('lists the root mount’s pre-images', async () => {
    const { backend, journal } = setup()
    await journal.record('local.md', enc.encode('before'))
    expect((await backend.journal.list()).map((e) => e.path)).toEqual(['local.md'])
  })
})
