/**
 * The read half of the surface (shaping A4): what is in the vault, and how to
 * read the PART of a note you need.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { OP_SCHEMAS } from '../src/contract.js'
import { runOp } from '../src/ops/index.js'
import { harness, type Harness } from './harness.js'
import { FIXTURE_BINARIES, FIXTURE_TEXT_NOTES } from './fixture.js'

let h: Harness
const open = async (): Promise<Harness> => (h = await harness())
afterEach(async () => h?.cleanup())

describe('ls', () => {
  it('lists direct children by default, folders first', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'ls', {})
    // Arrange/Act above; assert the shape AND the order the CLI renders.
    expect(out.dir).toBe('')
    expect(out.items.map((i) => i.path)).toEqual([
      // `.agents/` (skills) is not ignored: it syncs and lists like any folder.
      '.agents',
      'Areas',
      'attachments',
      'Competitors',
      'Daily',
      'Edible',
      'Inbox',
      'Projects',
      'TODO',
      'Competitors.base',
    ])
    // Folders first, then the one root-level file (the collection).
    expect(out.items.slice(0, -1).every((i) => i.kind === 'dir')).toBe(true)
    expect(out.items.at(-1)?.kind).toBe('text')
    expect(out.coverage).toEqual({
      docs: FIXTURE_TEXT_NOTES,
      skippedBinary: FIXTURE_BINARIES,
      ignored: expect.arrayContaining(['.git', '.obsidian', '.trash']),
    })
  })

  it('descends on depth 0 and reports size, kind and mtime per file', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'ls', { dir: 'Areas', depth: 0, limit: 100 })
    expect(out.items.map((i) => i.path)).toContain('Areas/CS/JSON.md')
    expect(out.items.map((i) => i.path)).toContain('Areas/Empty')
    const note = out.items.find((i) => i.path === 'Areas/CS/JSON.md')
    expect(note?.kind).toBe('text')
    expect(note?.size).toBeGreaterThan(0)
    expect(Date.parse(note?.mtime ?? '')).not.toBeNaN()
  })

  it('filters by kind and pages with an opaque cursor', async () => {
    const { backend } = await open()
    const binaries = await runOp(backend, 'ls', { depth: 0, kind: 'binary', limit: 50 })
    expect(binaries.items.map((i) => i.path)).toEqual(['attachments/diagram.png'])

    const first = await runOp(backend, 'ls', { depth: 0, kind: 'text', limit: 5 })
    expect(first.returned).toBe(5)
    expect(first.total).toBe(FIXTURE_TEXT_NOTES)
    expect(first.nextCursor).not.toBeNull()
    const second = await runOp(backend, 'ls', { depth: 0, kind: 'text', limit: 5, cursor: first.nextCursor! })
    expect(second.items.map((i) => i.path)).not.toEqual(first.items.map((i) => i.path))
  })

  it('never lists an ignored directory', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'ls', { depth: 0, limit: 100 })
    expect(out.items.some((i) => i.path.startsWith('.obsidian'))).toBe(false)
  })

  it('refuses a directory that is not there, and a path outside the vault', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'ls', { dir: 'Nope' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(runOp(backend, 'ls', { dir: '../..' })).rejects.toMatchObject({ code: 'refused' })
  })
})

describe('read', () => {
  it('reads a whole note with its byte size and content hash', async () => {
    const { backend, notes } = await open()
    const out = await runOp(backend, 'read', { path: 'Areas/CS/JSON.md' })
    expect(out.mode).toBe('full')
    expect(out.text).toBe(notes['Areas/CS/JSON.md'])
    expect(out.truncated).toBe(false)
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(out.size).toBe(Buffer.byteLength(notes['Areas/CS/JSON.md']))
  })

  it('truncates at a line boundary and says where to continue', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'read', { path: 'Areas/Life/Music.md', maxChars: 200 })
    expect(out.truncated).toBe(true)
    expect(out.text?.endsWith('\n')).toBe(true)
    expect(out.text!.length).toBeLessThanOrEqual(200)
    expect(out.nextLine).toBeGreaterThan(1)
    // The continuation is exactly the next line — no gap, no overlap.
    const rest = await runOp(backend, 'read', { path: 'Areas/Life/Music.md', lines: { from: out.nextLine!, to: out.nextLine! } })
    expect(out.text! + rest.text!).toBe(
      (await runOp(backend, 'read', { path: 'Areas/Life/Music.md', lines: { from: 1, to: out.nextLine! } })).text
    )
  })

  it('returns a whole over-long line rather than nothing', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'read', { path: 'Areas/CS/JSON.md', maxChars: 100 })
    expect(out.text!.length).toBeGreaterThan(0)
    expect(out.text!.startsWith('# JSON\n')).toBe(true)
  })

  it('outlines headings with per-section character counts', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'read', { path: 'Projects/Editor.md', outline: true })
    expect(out.mode).toBe('outline')
    expect(out.text).toBeUndefined()
    expect(out.outline?.map((o) => [o.level, o.text])).toEqual([
      [1, 'Editor'],
      [2, 'Decisions'],
      [2, 'Notes'],
      [3, 'Open questions'],
      [2, 'Later'],
    ])
    const decisions = out.outline?.find((o) => o.text === 'Decisions')
    expect(decisions?.line).toBe(17)
    expect(decisions?.chars).toBeGreaterThan(0)
  })

  it('reads one section by heading path, case-insensitively and nested', async () => {
    const { backend } = await open()
    const flat = await runOp(backend, 'read', { path: 'Projects/Editor.md', section: 'Decisions' })
    expect(flat.mode).toBe('section')
    expect(flat.from).toBe(17)
    expect(flat.text).toContain('Files are canonical')
    expect(flat.text).not.toContain('## Notes')

    const nested = await runOp(backend, 'read', { path: 'Projects/Editor.md', section: 'notes/OPEN QUESTIONS' })
    expect(nested.text).toContain('How does restore work?')
    expect(nested.text).not.toContain('Some prose here')
  })

  it('will not invent a section that is not there', async () => {
    const { backend } = await open()
    await expect(
      runOp(backend, 'read', { path: 'Projects/Editor.md', section: 'Open questions/Decisions' })
    ).rejects.toMatchObject({ code: 'not_found' })
    await expect(runOp(backend, 'read', { path: 'Projects/Editor.md', section: 'Nope' })).rejects.toMatchObject({
      code: 'not_found',
    })
  })

  it('reads a 1-based inclusive line range, clamped to the note', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'read', { path: 'Areas/CS/JSON.md', lines: { from: 1, to: 900 } })
    expect(out.mode).toBe('lines')
    expect(out.from).toBe(1)
    expect(out.to).toBe(3)
  })

  it('reads frontmatter only', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'read', { path: 'Projects/Editor.md', frontmatter: true })
    expect(out.mode).toBe('frontmatter')
    expect(out.text).toBeUndefined()
    expect(out.frontmatter?.present).toBe(true)
  })

  it('refuses a binary and a missing note', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'read', { path: 'attachments/diagram.png' })).rejects.toMatchObject({
      code: 'refused',
    })
    await expect(runOp(backend, 'read', { path: 'nope.md' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('the link ops', () => {
  it('lists a note.s outgoing links with their resolution', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'links', { path: 'Projects/Editor.md' })
    expect(out.links.map((l) => [l.target, l.resolved, l.alias])).toEqual([
      ['JSON', 'Areas/CS/JSON.md', null],
      ['Docs', 'Edible/Docs.md', 'the docs'],
    ])
    await expect(runOp(backend, 'links', { path: 'nope.md' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('finds backlinks by bare name and by path', async () => {
    const { backend } = await open()
    const byName = await runOp(backend, 'backlinks', { target: 'JSON' })
    expect(byName.backlinks.map((b) => b.path).sort()).toEqual([
      'Areas/CS/HTML.md',
      'Daily/02-5-2024.md',
      'Edible/Docs.md',
      'Projects/Editor.md',
    ])
    const byPath = await runOp(backend, 'backlinks', { target: 'Areas/CS/JSON.md' })
    expect(byPath.total).toBe(byName.total)
    expect(byName.backlinks[0].context).toContain('[[JSON]]')
  })

  it('lists unresolved links and marks embeds apart', async () => {
    const { backend } = await open()
    const out = await runOp(backend, 'unresolved', { limit: 50 })
    expect(out.links.map((l) => l.target).sort()).toEqual([
      'Nothing Here',
      'Nothing Here',
      'missing-diagram.png',
    ])
    expect(out.links.find((l) => l.target === 'missing-diagram.png')?.embed).toBe(true)
  })

  it('counts tags by note and resolves targets the way the editor does', async () => {
    const { backend } = await open()
    const tagged = await runOp(backend, 'tags', {})
    // Frontmatter `tags:` count exactly like inline tags (read-shaping X4), so
    // Projects/Editor.md's `[project, editor]` contributes `#editor` here and
    // `#project` is still one note however many times it is written.
    expect(tagged.tags).toEqual([
      { tag: '#cs', notes: 1 },
      { tag: '#editor', notes: 1 },
      { tag: '#project', notes: 1 },
    ])
    expect((await runOp(backend, 'resolve', { target: 'Docs' })).path).toBe('Edible/Docs.md')
    expect((await runOp(backend, 'resolve', { target: 'Nothing Here' })).path).toBeNull()
  })
})

describe('stats', () => {
  it('reports what the answer was computed over', async () => {
    const { backend, root } = await open()
    const out = await runOp(backend, 'stats', {})
    expect(out.vault).toBe(root)
    expect(out.docs).toBe(FIXTURE_TEXT_NOTES)
    expect(out.skippedBinary).toBe(FIXTURE_BINARIES)
    expect(out.unresolved).toBe(3)
    expect(out.tags).toBe(3) // #cs, #project and the frontmatter-only #editor
    expect(out.ignored).toContain('.obsidian')
    expect(out.buildMs).toBeGreaterThanOrEqual(0)
    expect(out.indexSchemaVersion).toBeGreaterThanOrEqual(1)
  })
})

describe('every op emits its own envelope', () => {
  it('validates against the contract output schema', async () => {
    const { backend } = await open()
    const documents = [
      await runOp(backend, 'ls', {}),
      await runOp(backend, 'read', { path: 'Areas/CS/JSON.md' }),
      await runOp(backend, 'search', { query: 'json' }),
      await runOp(backend, 'links', { path: 'Projects/Editor.md' }),
      await runOp(backend, 'backlinks', { target: 'JSON' }),
      await runOp(backend, 'unresolved', {}),
      await runOp(backend, 'tags', {}),
      await runOp(backend, 'resolve', { target: 'Docs' }),
      await runOp(backend, 'stats', {}),
      await runOp(backend, 'changes', { since: new Date(0).toISOString() }),
      await runOp(backend, 'write', { path: 'new.md', text: 'hi\n', dryRun: true }),
      await runOp(backend, 'patch', { path: 'TODO/Writing.md', old: 'Short.', new: 'Long.', dryRun: true }),
      await runOp(backend, 'append', { path: 'TODO/Writing.md', text: 'more\n', dryRun: true }),
      await runOp(backend, 'fm', { path: 'Projects/Editor.md' }),
      await runOp(backend, 'mv', { from: 'TODO/Writing.md', to: 'TODO/Prose.md', dryRun: true }),
      await runOp(backend, 'rm', { path: 'TODO/Writing.md', dryRun: true }),
    ]
    for (const doc of documents) {
      const op = (doc.schema as string).split('.')[1] as keyof typeof OP_SCHEMAS
      expect(OP_SCHEMAS[op].output.safeParse(doc)).toMatchObject({ success: true })
    }
  })

  it('rejects input the contract does not describe', async () => {
    const { backend } = await open()
    await expect(runOp(backend, 'read', { path: '' })).rejects.toMatchObject({ code: 'usage' })
    await expect(runOp(backend, 'search', { query: 'x', limit: 5000 })).rejects.toMatchObject({ code: 'usage' })
  })
})
