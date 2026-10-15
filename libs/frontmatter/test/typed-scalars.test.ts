/**
 * Typed scalars (collections A4/A8): a cell editor sets `score: 8` and
 * `done: true` as a number and a boolean, written plain; a STRING that
 * looks like one is still quoted so it reads back as text.
 */
import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../src/parse.js'
import { patchFrontmatter } from '../src/patch.js'

const ok = (r: ReturnType<typeof patchFrontmatter>): string => {
  if (!r.ok) throw new Error(r.reason)
  return r.text
}

describe('typed scalars', () => {
  it('writes a number and a boolean plain, and a look-alike string quoted', () => {
    const base = '---\nscore: 5\ndone: false\nnote: x\n---\n'
    expect(ok(patchFrontmatter(base, { op: 'set', key: 'score', value: 8 }))).toBe('---\nscore: 8\ndone: false\nnote: x\n---\n')
    expect(ok(patchFrontmatter(base, { op: 'set', key: 'done', value: true }))).toBe('---\nscore: 5\ndone: true\nnote: x\n---\n')
    expect(ok(patchFrontmatter(base, { op: 'set', key: 'note', value: 'true' }))).toBe('---\nscore: 5\ndone: false\nnote: "true"\n---\n')
    expect(ok(patchFrontmatter(base, { op: 'set', key: 'note', value: '8' }))).toBe('---\nscore: 5\ndone: false\nnote: "8"\n---\n')
  })

  it('adds a typed key and writes a typed list', () => {
    const out = ok(patchFrontmatter('# n\n', { op: 'set', key: 'ids', value: [1, 2.5, true, 'x'] }))
    expect(out).toBe('---\nids:\n  - 1\n  - 2.5\n  - true\n  - x\n---\n# n\n')
    const read = parseFrontmatter(out)
    expect(read.entries[0]).toMatchObject({ key: 'ids', value: ['1', '2.5', 'true', 'x'], kind: 'block-list' })
  })

  it('refuses a number that is not one', () => {
    expect(patchFrontmatter('---\na: 1\n---\n', { op: 'set', key: 'a', value: Number.NaN })).toEqual({ ok: false, reason: 'invalid-value' })
  })
})
