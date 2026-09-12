import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../src/index.js'
import { docOf, OBSIDIAN_BLOCKS, UNSUPPORTED_BLOCKS, VAULT_BLOCKS } from './corpus.js'

describe('parseFrontmatter — the block', () => {
  it('finds a block only at offset 0', () => {
    expect(parseFrontmatter('# Note\n\n---\nk: v\n---\n').present).toBe(false)
    expect(parseFrontmatter(docOf('k: v\n')).present).toBe(true)
  })

  it('needs a closing delimiter, and takes `...` as one', () => {
    expect(parseFrontmatter('---\nk: v\n').present).toBe(false)
    expect(parseFrontmatter('---\nk: v\n...\nbody').present).toBe(true)
  })

  it('is not fooled by `---` with something after it', () => {
    expect(parseFrontmatter('--- not a fence\nk: v\n---\n').present).toBe(false)
  })

  it('requires the closing delimiter to be a line of its own', () => {
    const fm = parseFrontmatter('---\ntitle: x\n---- not a fence\n---\nbody')
    expect(fm.present).toBe(true)
    // `---- not a fence` is error debris, not a key: it has no colon.
    expect(fm.entries.map((e) => e.key)).toEqual(['title'])
    expect(fm.supported).toBe(false)
  })

  it('reports `end` as the first body character', () => {
    const text = docOf('k: v\n', '# Body\n')
    const fm = parseFrontmatter(text)
    expect(text.slice(fm.end)).toBe('# Body\n')
    expect(parseFrontmatter('no block here').end).toBe(0)
  })

  it('reads a block that ends the file with no trailing newline', () => {
    const fm = parseFrontmatter('---\nk: v\n---')
    expect(fm.present).toBe(true)
    expect(fm.end).toBe(12)
  })

  it('handles CRLF without dragging the carriage return into the value', () => {
    const fm = parseFrontmatter('---\r\nstatus: Todo\r\n---\r\nbody')
    expect(fm.entries[0].value).toBe('Todo')
  })
})

describe('parseFrontmatter — entries', () => {
  it('reads scalars as written, and unquotes what YAML would unquote', () => {
    const fm = parseFrontmatter(docOf('title: "Hello: world"\ncolour: \'#ccc\'\nn: 1.50\nd: 2023-09-01\nb: true\n'))
    expect(fm.supported).toBe(true)
    expect(fm.entries.map((e) => e.value)).toEqual(['Hello: world', '#ccc', '1.50', '2023-09-01', 'true'])
    expect(fm.entries.every((e) => e.kind === 'scalar')).toBe(true)
  })

  it('reads an empty value as an empty scalar, with or without a trailing space', () => {
    const fm = parseFrontmatter(docOf('milestone:\ndue-date: \n'))
    expect(fm.entries.map((e) => [e.key, e.value])).toEqual([
      ['milestone', ''],
      ['due-date', ''],
    ])
  })

  it('gives each entry its 0-based line range in the DOCUMENT', () => {
    const fm = parseFrontmatter(docOf('tags:\n  - a\n  - b\nstatus: Todo\n'))
    expect(fm.entries[0].lines).toEqual([1, 3])
    expect(fm.entries[1].lines).toEqual([4, 4])
  })

  it('distinguishes flow lists from block lists', () => {
    expect(parseFrontmatter(docOf('tags: [a, b]\n')).entries[0]).toMatchObject({
      kind: 'flow-list',
      value: ['a', 'b'],
    })
    expect(parseFrontmatter(docOf('tags:\n  - a\n  - b\n')).entries[0]).toMatchObject({
      kind: 'block-list',
      value: ['a', 'b'],
    })
  })

  it('keeps comments and blank lines out of the entries and out of their ranges', () => {
    const fm = parseFrontmatter(docOf('# why\n\ntags: [testing]\n\nstatus: Todo\n'))
    expect(fm.supported).toBe(true)
    expect(fm.entries.map((e) => e.lines)).toEqual([
      [3, 3],
      [5, 5],
    ])
  })
})

describe('parseFrontmatter — Obsidian tag shapes', () => {
  it("splits the vault's pre-1.4 space-separated flow list", () => {
    const fm = parseFrontmatter(docOf('tags: [composition testing]\n'))
    expect(fm.entries[0]).toMatchObject({ legacy: true, value: ['composition', 'testing'] })
    expect(fm.tags).toEqual(['composition', 'testing'])
  })

  it('splits a space-separated BLOCK list item too — the vault has one', () => {
    const fm = parseFrontmatter(docOf('tags:\n  - functional-programming composition\n'))
    expect(fm.tags).toEqual(['functional-programming', 'composition'])
  })

  it('leaves a QUOTED item alone — quoting is how a writer says "one value"', () => {
    const fm = parseFrontmatter(docOf('tags:\n  - "two words"\n'))
    expect(fm.entries[0].legacy).toBeUndefined()
    expect(fm.tags).toEqual(['two words'])
  })

  it('never splits a non-tag list on spaces', () => {
    const fm = parseFrontmatter(docOf('aliases: [Memory Layout]\n'))
    expect(fm.entries[0].legacy).toBeUndefined()
    expect(fm.aliases).toEqual(['Memory Layout'])
  })

  it('reads a comma string, a space string and a `tag` key', () => {
    expect(parseFrontmatter(docOf('tags: a, b\n')).tags).toEqual(['a', 'b'])
    expect(parseFrontmatter(docOf('tags: a b\n')).tags).toEqual(['a', 'b'])
    expect(parseFrontmatter(docOf('tag: solo\n')).tags).toEqual(['solo'])
  })

  it('strips the `#` and dedupes case-insensitively, keeping the first spelling', () => {
    // A bare `#` opens a YAML comment, so a hash-prefixed tag is always
    // quoted in practice — Obsidian writes them without the hash at all.
    const fm = parseFrontmatter(docOf('tags: ["#Project", project, PROJECT]\n'))
    expect(fm.tags).toEqual(['Project'])
  })

  it('reads aliases as phrases, split on commas only', () => {
    expect(parseFrontmatter(docOf('aliases:\n  - Memory Layout\n  - ML\n')).aliases).toEqual([
      'Memory Layout',
      'ML',
    ])
    expect(parseFrontmatter(docOf('alias: One Thing, Another\n')).aliases).toEqual([
      'One Thing',
      'Another',
    ])
  })
})

describe('parseFrontmatter — what it refuses', () => {
  for (const { name, block, reason } of UNSUPPORTED_BLOCKS) {
    it(`refuses ${name} with reason ${reason}`, () => {
      const fm = parseFrontmatter(docOf(block))
      expect(fm.present).toBe(true)
      expect(fm.supported).toBe(false)
      expect(fm.reason).toBe(reason)
    })
  }

  it('still reports the keys of an unsupported block, for the strip and the index', () => {
    const fm = parseFrontmatter(docOf('meta:\n  owner: chris\nstatus: Todo\n'))
    expect(fm.entries.map((e) => e.key)).toEqual(['meta', 'status'])
  })

  it('treats a zero-key block as a supported EMPTY block, not as an error', () => {
    const fm = parseFrontmatter('---\n---\nbody')
    expect(fm).toMatchObject({ present: true, supported: true, entries: [] })
  })

  it('treats prose between two rules as a present-but-unsupported block', () => {
    // The index reads this as content (no entries); the editor shows a badge.
    const fm = parseFrontmatter('---\n\nReal content with [[Link]] and #tag\n\n---\n')
    expect(fm).toMatchObject({ present: true, supported: false, entries: [] })
  })
})

describe('parseFrontmatter — never throws', () => {
  const garbage = [
    '',
    '-',
    '---',
    '---\n',
    '---\n\t: tabs\n---\n',
    '---\n\x00\n---\n',
    '---\n- a\n- b\n---\n',
    '---\n[unclosed\n---\n',
    '---\n{a: 1\n---\n',
    '---\n: no key\n---\n',
    '---\n'.repeat(50),
  ]
  for (const text of garbage) {
    it(`survives ${JSON.stringify(text.slice(0, 20))}`, () => {
      expect(() => parseFrontmatter(text)).not.toThrow()
    })
  }
})

describe('parseFrontmatter — the real vault', () => {
  it('supports every block shape in the vault (Fork 4: 17/17 files)', () => {
    let files = 0
    for (const { name, block, files: n } of VAULT_BLOCKS) {
      const fm = parseFrontmatter(docOf(block, '\nbody\n'))
      expect(fm.present, name).toBe(true)
      expect(fm.supported, name).toBe(true)
      files += n
    }
    expect(files).toBe(17)
  })

  it('supports every shape Obsidian 1.4+ writes', () => {
    for (const { name, block } of OBSIDIAN_BLOCKS) {
      expect(parseFrontmatter(docOf(block)).supported, name).toBe(true)
    }
  })

  it('reads the vault to 11 distinct frontmatter tags', () => {
    // read-shaping.md §Evidence: 11 distinct tags in 10 files. The count only
    // comes out right if both legacy shapes split.
    const blocks = [
      'tags: [dogfooding communication-structures]\n',
      'tags:\n  - functional-programming composition\ndue-date:\n',
      'tags: [classes oop]\n',
      'tags: [testing]\n',
      'tags: [impunity]\n',
      'tags: [composition]\n',
      'tags: [testing]\n',
      'tags: [css transitions]\n',
      'tags: [naming-things]\n',
      'tags: [composition testing]\n',
    ]
    const distinct = new Set(blocks.flatMap((b) => parseFrontmatter(docOf(b)).tags))
    expect(distinct.size).toBe(11)
  })
})
