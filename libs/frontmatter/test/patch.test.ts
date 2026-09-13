/**
 * THE BYTE CONTRACT (golden rule 2, R4.2).
 *
 * Every op is one change over one value or one entry's lines. Everything else
 * in the file — the other keys, their quoting, the comments, the blank lines,
 * the body — comes out byte-identical, and the result still parses as what
 * was written. That is the whole promise `libs/frontmatter` exists to keep.
 */
import { describe, expect, it } from 'vitest'
import { parseFrontmatter, patchFrontmatter, type FmOp } from '../src/index.js'
import {
  applyChanges,
  BODIES,
  docOf,
  expectUntouchedLines,
  OBSIDIAN_BLOCKS,
  UNSUPPORTED_BLOCKS,
  VAULT_BLOCKS,
} from './corpus.js'

describe('patchFrontmatter — byte contract over the vault corpus', () => {
  const blocks = [...VAULT_BLOCKS, ...OBSIDIAN_BLOCKS.map((b) => ({ ...b, files: 0 }))]
  for (const { name, block } of blocks) {
    for (const body of BODIES) {
      const text = docOf(block, body)
      const fm = parseFrontmatter(text)
      const keys = fm.entries.map((e) => e.key)
      const ops: FmOp[] = [
        { op: 'set', key: 'status', value: 'Done' },
        { op: 'set', key: 'brand-new', value: 'x' },
        { op: 'set', key: keys[0] ?? 'tags', value: ['one', 'two'] },
        { op: 'set', key: 'tags', value: ['composition', 'testing'] },
        { op: 'remove', key: keys[keys.length - 1] ?? 'tags' },
        { op: 'rename', key: keys[0] ?? 'tags', to: 'renamed' },
      ]
      for (const op of ops) {
        it(`${name} + ${JSON.stringify(body.slice(0, 8))}: ${op.op} ${op.key}`, () => {
          const result = patchFrontmatter(text, op)
          if (!result.ok) {
            // The corpus is all inside the flat subset; the only refusals here
            // are ops that name a key the block does not have.
            expect(result.reason).toBe('missing-key')
            return
          }
          expect(result.changes.length).toBeLessThanOrEqual(1)
          expect(applyChanges(text, result.changes)).toBe(result.text)
          for (const change of result.changes) expectUntouchedLines(text, result.text, change)

          const after = parseFrontmatter(result.text)
          expect(after.supported).toBe(true)
          // The body is not frontmatter's business, ever.
          expect(result.text.slice(after.end)).toBe(text.slice(fm.end))
          if (op.op === 'set') {
            const entry = after.entries.find((e) => e.key === op.key)
            expect(entry?.value).toEqual(op.value)
          }
          if (op.op === 'remove') {
            expect(after.entries.map((e) => e.key)).not.toContain(op.key)
          }
          if (op.op === 'rename') {
            expect(after.entries.map((e) => e.key)).toContain(op.to)
            expect(after.entries.map((e) => e.key)).not.toContain(op.key)
          }
        })
      }
    }
  }
})

describe('patchFrontmatter — set', () => {
  it('replaces the value bytes and nothing else', () => {
    const text = docOf('milestone: builder round 2 testing\ntype: story\nstatus: On deck\ndue-date: 2023-09-01\n')
    const result = patchFrontmatter(text, { op: 'set', key: 'status', value: 'Done' })
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.changes).toEqual([{ from: text.indexOf('On deck') - 1, to: text.indexOf('On deck') + 7, insert: ' Done' }])
    expect(result.text).toBe(
      docOf('milestone: builder round 2 testing\ntype: story\nstatus: Done\ndue-date: 2023-09-01\n')
    )
  })

  it('fills an empty value without eating the trailing space it found', () => {
    const result = patchFrontmatter(docOf('due-date: \n'), { op: 'set', key: 'due-date', value: '2026-09-12' })
    expect(result).toMatchObject({ ok: true, text: docOf('due-date: 2026-09-12\n') })
  })

  it('fills an empty value that has no space at all', () => {
    const result = patchFrontmatter(docOf('milestone:\n'), { op: 'set', key: 'milestone', value: 'M2' })
    expect(result).toMatchObject({ ok: true, text: docOf('milestone: M2\n') })
  })

  it('writes in front of a trailing comment rather than over it', () => {
    const result = patchFrontmatter(docOf('milestone:  # tbd\n'), { op: 'set', key: 'milestone', value: 'M2' })
    expect(result).toMatchObject({ ok: true, text: docOf('milestone: M2 # tbd\n') })
  })

  it('keeps a comment that follows an existing value', () => {
    const result = patchFrontmatter(docOf('status: Todo # keep\n'), { op: 'set', key: 'status', value: 'Done' })
    expect(result).toMatchObject({ ok: true, text: docOf('status: Done # keep\n') })
  })

  it('clears a value to empty rather than writing empty quotes', () => {
    const result = patchFrontmatter(docOf('status: Todo\n'), { op: 'set', key: 'status', value: '' })
    expect(result).toMatchObject({ ok: true, text: docOf('status:\n') })
  })

  it('writes a list as a block list, replacing the whole entry', () => {
    const text = docOf('tags: [composition testing]\nstatus: Todo\n')
    const result = patchFrontmatter(text, { op: 'set', key: 'tags', value: ['a', 'b'] })
    expect(result).toMatchObject({ ok: true, text: docOf('tags:\n  - a\n  - b\nstatus: Todo\n') })
  })

  it('replaces a multi-line block list in place', () => {
    const text = docOf('tags:\n  - a\n  - b\nstatus: Todo\n')
    const result = patchFrontmatter(text, { op: 'set', key: 'tags', value: ['c'] })
    expect(result).toMatchObject({ ok: true, text: docOf('tags:\n  - c\nstatus: Todo\n') })
  })

  it('writes an empty list as a list, not as an empty scalar', () => {
    const result = patchFrontmatter(docOf('tags: [a]\n'), { op: 'set', key: 'tags', value: [] })
    expect(result).toMatchObject({ ok: true, text: docOf('tags: []\n') })
    expect(parseFrontmatter(docOf('tags: []\n')).entries[0].value).toEqual([])
  })

  it('inserts a missing key as one line, before the closing fence', () => {
    const text = docOf('status: Todo\n', 'body\n')
    const result = patchFrontmatter(text, { op: 'set', key: 'due-date', value: '2026-09-12' })
    expect(result).toMatchObject({ ok: true, text: docOf('status: Todo\ndue-date: 2026-09-12\n', 'body\n') })
  })

  it('creates the block on a note that has none', () => {
    const result = patchFrontmatter('# Note\n\nbody\n', { op: 'set', key: 'tags', value: ['x'] })
    expect(result).toMatchObject({ ok: true, text: '---\ntags:\n  - x\n---\n# Note\n\nbody\n' })
  })

  it('creates the block on an empty note', () => {
    const result = patchFrontmatter('', { op: 'set', key: 'status', value: 'Todo' })
    expect(result).toMatchObject({ ok: true, text: '---\nstatus: Todo\n---\n' })
  })

  it('adds a key to an empty block', () => {
    const result = patchFrontmatter('---\n---\nbody', { op: 'set', key: 'status', value: 'Todo' })
    expect(result).toMatchObject({ ok: true, text: '---\nstatus: Todo\n---\nbody' })
  })

  it('is a NO-OP when the value is already what was asked for', () => {
    for (const [block, op] of [
      ['status: Todo\n', { op: 'set', key: 'status', value: 'Todo' }],
      ['tags:\n  - a\n  - b\n', { op: 'set', key: 'tags', value: ['a', 'b'] }],
      ['milestone:\n', { op: 'set', key: 'milestone', value: '' }],
    ] as [string, FmOp][]) {
      const text = docOf(block)
      const result = patchFrontmatter(text, op)
      expect(result).toEqual({ ok: true, text, changes: [] })
    }
  })

  it('quotes only what a plain scalar would read back as something else', () => {
    const set = (value: string): string => {
      const result = patchFrontmatter(docOf('k: x\n'), { op: 'set', key: 'k', value })
      return result.ok ? result.text.slice(4, -5) : `refused: ${result.reason}`
    }
    expect(set('Done')).toBe('k: Done')
    expect(set('2026-09-12')).toBe('k: 2026-09-12')
    expect(set('true')).toBe('k: "true"')
    expect(set('1.50')).toBe('k: "1.50"')
    expect(set('#ccc')).toBe('k: "#ccc"')
    expect(set('a: b')).toBe('k: "a: b"')
    for (const value of ['Done', '2026-09-12', 'true', '1.50', '#ccc', 'a: b', '  lead', '[x]']) {
      const result = patchFrontmatter(docOf('k: x\n'), { op: 'set', key: 'k', value })
      expect(result.ok && parseFrontmatter(result.text).entries[0].value).toBe(value)
    }
  })

  it('quotes a tag that contains a space, so it does not read back as two tags', () => {
    const result = patchFrontmatter(docOf('tags: [a]\n'), { op: 'set', key: 'tags', value: ['two words'] })
    expect(result).toMatchObject({ ok: true, text: docOf('tags:\n  - "two words"\n') })
    expect(result.ok && parseFrontmatter(result.text).tags).toEqual(['two words'])
  })

  it('keeps the key exactly as it was spelled', () => {
    const text = docOf('"odd key": 1\n')
    const result = patchFrontmatter(text, { op: 'set', key: 'odd key', value: ['a'] })
    expect(result).toMatchObject({ ok: true, text: docOf('"odd key":\n  - a\n') })
  })
})

describe('patchFrontmatter — remove and rename', () => {
  it('removes the entry\'s lines and leaves the neighbours alone', () => {
    const text = docOf('# comment\ntags:\n  - a\n  - b\nstatus: Todo\n')
    const result = patchFrontmatter(text, { op: 'remove', key: 'tags' })
    expect(result).toMatchObject({ ok: true, text: docOf('# comment\nstatus: Todo\n') })
  })

  it('treats removing an absent key as already done', () => {
    const text = docOf('status: Todo\n')
    expect(patchFrontmatter(text, { op: 'remove', key: 'nope' })).toEqual({ ok: true, text, changes: [] })
    expect(patchFrontmatter('no block', { op: 'remove', key: 'nope' })).toEqual({
      ok: true,
      text: 'no block',
      changes: [],
    })
  })

  it('rewrites the key bytes only', () => {
    const text = docOf('due-date: 2023-09-01 # when\n')
    const result = patchFrontmatter(text, { op: 'rename', key: 'due-date', to: 'due' })
    expect(result).toMatchObject({ ok: true, text: docOf('due: 2023-09-01 # when\n') })
  })

  it('refuses a rename onto a key that already exists', () => {
    const text = docOf('a: 1\nb: 2\n')
    expect(patchFrontmatter(text, { op: 'rename', key: 'a', to: 'b' })).toEqual({
      ok: false,
      reason: 'duplicate-key',
    })
  })

  it('refuses a rename of a key that is not there, and no-ops a rename to itself', () => {
    const text = docOf('a: 1\n')
    expect(patchFrontmatter(text, { op: 'rename', key: 'zz', to: 'b' })).toEqual({
      ok: false,
      reason: 'missing-key',
    })
    expect(patchFrontmatter(text, { op: 'rename', key: 'a', to: 'a' })).toEqual({
      ok: true,
      text,
      changes: [],
    })
  })
})

describe('patchFrontmatter — refusals', () => {
  for (const { name, block, reason } of UNSUPPORTED_BLOCKS) {
    it(`refuses every op on ${name}`, () => {
      const text = docOf(block, 'body\n')
      for (const op of [
        { op: 'set', key: 'status', value: 'Done' },
        { op: 'remove', key: 'status' },
        { op: 'rename', key: 'status', to: 'state' },
      ] as FmOp[]) {
        expect(patchFrontmatter(text, op)).toEqual({ ok: false, reason })
      }
    })
  }

  it('refuses a value or a key with a line break — that is a block scalar', () => {
    const text = docOf('k: v\n')
    expect(patchFrontmatter(text, { op: 'set', key: 'k', value: 'a\nb' })).toEqual({
      ok: false,
      reason: 'multiline',
    })
    expect(patchFrontmatter(text, { op: 'set', key: 'k', value: ['a', 'b\nc'] })).toEqual({
      ok: false,
      reason: 'multiline',
    })
    expect(patchFrontmatter(text, { op: 'set', key: 'a\nb', value: 'x' })).toEqual({
      ok: false,
      reason: 'multiline',
    })
  })

  it('refuses an empty key rather than writing `: value`', () => {
    expect(patchFrontmatter(docOf('k: v\n'), { op: 'set', key: '  ', value: 'x' })).toEqual({
      ok: false,
      reason: 'invalid-key',
    })
  })

  it('never throws, whatever it is handed', () => {
    for (const text of ['', '---', '---\n---', '\x00---\n', '---\n{a: 1\n---\n']) {
      for (const op of [
        { op: 'set', key: 'k', value: 'v' },
        { op: 'remove', key: 'k' },
        { op: 'rename', key: 'k', to: 'j' },
      ] as FmOp[]) {
        expect(() => patchFrontmatter(text, op)).not.toThrow()
      }
    }
  })
})
