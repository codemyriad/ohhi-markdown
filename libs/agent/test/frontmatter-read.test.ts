/**
 * The flat-subset frontmatter reader. It is a STAND-IN for `libs/frontmatter`
 * (read-shaping X3), so what these assert is the boundary of the subset: what
 * it reads, and — just as load-bearing — what it refuses to pretend it read.
 */
import { describe, expect, it } from 'vitest'
import { readFrontmatter } from '../src/frontmatter-read.js'

const block = (body: string): string => `---\n${body}\n---\n\n# Note\n\nBody.\n`

describe('readFrontmatter', () => {
  it('reports absence without inventing an empty block', () => {
    expect(readFrontmatter('# Note\n\nNo frontmatter here.\n')).toEqual({ present: false, supported: true })
    // A `---` that never closes is a horizontal rule, not frontmatter.
    expect(readFrontmatter('---\nnot closed\n').present).toBe(false)
    expect(readFrontmatter('').present).toBe(false)
  })

  it('types scalars the way the vault writes them', () => {
    const out = readFrontmatter(
      block('title: Editor\ncount: 3\nratio: 1.5\ndraft: false\nempty:\nnothing: null\ncreated: 2026-01-05')
    )
    expect(out.supported).toBe(true)
    expect(out.entries).toEqual([
      { key: 'title', value: 'Editor', type: 'string', line: 2 },
      { key: 'count', value: 3, type: 'number', line: 3 },
      { key: 'ratio', value: 1.5, type: 'number', line: 4 },
      { key: 'draft', value: false, type: 'boolean', line: 5 },
      { key: 'empty', value: null, type: 'null', line: 6 },
      { key: 'nothing', value: null, type: 'null', line: 7 },
      { key: 'created', value: '2026-01-05', type: 'date', line: 8 },
    ])
  })

  it('unwraps quotes without unwrapping meaning', () => {
    const out = readFrontmatter(block('title: "3"\nother: \'true\''))
    expect(out.entries).toEqual([
      { key: 'title', value: '3', type: 'string', line: 2 },
      { key: 'other', value: 'true', type: 'string', line: 3 },
    ])
  })

  it('reads flow lists and block lists as the same thing', () => {
    const flow = readFrontmatter(block('tags: [project, editor]'))
    expect(flow.entries?.[0]).toEqual({ key: 'tags', value: ['project', 'editor'], type: 'list', line: 2 })
    const listed = readFrontmatter(block('tags:\n  - project\n  - editor\nstatus: active'))
    expect(listed.entries).toEqual([
      { key: 'tags', value: ['project', 'editor'], type: 'list', line: 2 },
      { key: 'status', value: 'active', type: 'string', line: 5 },
    ])
    expect(readFrontmatter(block('tags: []')).entries?.[0].value).toEqual([])
  })

  it('skips blank lines and comments', () => {
    const out = readFrontmatter(block('# a comment\n\ntitle: Editor'))
    expect(out.entries).toEqual([{ key: 'title', value: 'Editor', type: 'string', line: 4 }])
  })

  it('keeps the raw block, fences included, whatever it made of it', () => {
    const out = readFrontmatter(block('title: Editor'))
    expect(out.raw).toBe('---\ntitle: Editor\n---\n')
  })

  it('refuses anything nested instead of guessing', () => {
    const nested = readFrontmatter(block('meta:\n  nested: true'))
    expect(nested).toEqual({ present: true, raw: '---\nmeta:\n  nested: true\n---\n', supported: false })
    expect(readFrontmatter(block('meta: {a: 1}')).supported).toBe(false)
    expect(readFrontmatter(block('text: |\n  a literal block')).supported).toBe(false)
    expect(readFrontmatter(block('not a key at all')).supported).toBe(false)
    expect(readFrontmatter(block('anchored: &ref')).supported).toBe(false)
  })

  it('gives line numbers of the NOTE, so a key is one read --lines away', () => {
    const out = readFrontmatter(block('title: Editor\ntags: [a]'))
    expect(out.entries?.map((e) => e.line)).toEqual([2, 3])
  })
})
