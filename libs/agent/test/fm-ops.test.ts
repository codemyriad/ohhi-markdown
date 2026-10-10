/**
 * `fm` writes (bases-shaping DB5, the write half of R7): one value's bytes
 * per key through the flat-subset patcher, journaled and atomic like every
 * other write, refused — never repaired — where the block is outside the
 * subset.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runOp } from '../src/ops/index.js'
import { harness, type Harness } from './harness.js'

let h: Harness
beforeEach(async () => {
  h = await harness()
})
afterEach(() => h.cleanup())

const EDITOR = 'Projects/Editor.md'

describe('fm — read', () => {
  it('reads as before, now with the hash a later write can expect', async () => {
    const out = await runOp(h.backend, 'fm', { path: EDITOR })
    expect(out.schema).toBe('ohhi.fm.v1')
    expect(out.frontmatter.entries?.map((e) => e.key)).toEqual(['title', 'tags', 'status', 'created', 'draft', 'retries', 'notes'])
    expect(out).toMatchObject({ changed: false, journalSeq: null, dryRun: false })
    expect(out.hash).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('fm — write', () => {
  it('sets, unsets and renames keys, moving only those bytes, typed as given', async () => {
    const before = await h.text(EDITOR)
    const out = await runOp(h.backend, 'fm', {
      path: EDITOR,
      set: { status: 'done', retries: 4, draft: true, notes: ['third', 'fourth'], score: 7.5 },
      unset: ['created'],
      rename: { title: 'name' },
    })
    expect(out.changed).toBe(true)
    expect(out.journalSeq).not.toBeNull()
    const after = await h.text(EDITOR)
    expect(after).toBe(
      before
        .replace('title: Editor', 'name: Editor')
        .replace('status: active', 'status: done')
        .replace('created: 2026-01-05\n', '')
        .replace('draft: false', 'draft: true')
        .replace('retries: 3', 'retries: 4')
        .replace('notes:\n  - first\n  - second\n', 'notes:\n  - third\n  - fourth\nscore: 7.5\n')
    )
    expect(out.frontmatter.entries?.find((e) => e.key === 'retries')).toMatchObject({ value: 4, type: 'number' })
    expect(out.frontmatter.entries?.find((e) => e.key === 'draft')).toMatchObject({ value: true, type: 'boolean' })
    // The pre-image is in the journal, so this is undoable.
    const listed = await runOp(h.backend, 'restore', { path: EDITOR, list: true })
    expect(listed.entries?.map((e) => e.seq)).toContain(out.journalSeq)
  })

  it('quotes a string that would read back as something else, and keeps a trailing comment', async () => {
    await h.backend.adapter.writeAtomic('Inbox/Typed.md', new TextEncoder().encode('---\nn: 1 # why\n---\nbody\n'))
    await runOp(h.backend, 'fm', { path: 'Inbox/Typed.md', set: { n: '2', flag: 'true' } })
    expect(await h.text('Inbox/Typed.md')).toBe('---\nn: "2" # why\nflag: "true"\n---\nbody\n')
  })

  it('gives a note without a block one, and treats unsetting a missing key as done', async () => {
    const out = await runOp(h.backend, 'fm', { path: 'TODO/Writing.md', set: { status: 'draft' }, unset: ['nothing'] })
    expect(out.changed).toBe(true)
    expect(await h.text('TODO/Writing.md')).toBe('---\nstatus: draft\n---\n# Writing\n\nShort.\n')
    const again = await runOp(h.backend, 'fm', { path: 'TODO/Writing.md', set: { status: 'draft' } })
    expect(again.changed).toBe(false)
    expect(again.journalSeq).toBeNull()
  })

  it('refuses a block outside the flat subset and touches nothing', async () => {
    const before = await h.text('Projects/Nested.md')
    await expect(runOp(h.backend, 'fm', { path: 'Projects/Nested.md', set: { status: 'x' } })).rejects.toMatchObject({
      code: 'refused',
      details: { reason: 'nested' },
    })
    expect(await h.text('Projects/Nested.md')).toBe(before)
    await expect(runOp(h.backend, 'fm', { path: EDITOR, rename: { nothere: 'x' } })).rejects.toMatchObject({ code: 'refused', details: { reason: 'missing-key' } })
  })

  it('honours --dry-run and --expect-hash like every write', async () => {
    const before = await h.text(EDITOR)
    const dry = await runOp(h.backend, 'fm', { path: EDITOR, set: { status: 'done' }, dryRun: true })
    expect(dry).toMatchObject({ changed: true, dryRun: true, journalSeq: null })
    expect(await h.text(EDITOR)).toBe(before)
    await expect(runOp(h.backend, 'fm', { path: EDITOR, set: { status: 'done' }, expectHash: 'nope' })).rejects.toMatchObject({ code: 'conflict' })
    await expect(runOp(h.backend, 'fm', { path: 'Nope.md', set: { a: 'b' } })).rejects.toMatchObject({ code: 'not_found' })
    await expect(runOp(h.backend, 'fm', { path: 'Competitors.base', set: { a: 'b' } })).rejects.toMatchObject({ code: 'refused' })
  })
})
