/**
 * Unit tests for the pure pieces the conformance suite exercises only
 * indirectly. These are the modules the UI depends on, so they get direct
 * coverage (parent R6: V2 capability code is testable without a browser).
 */
import { describe, expect, it } from 'vitest'
import { fuzzyScore, toSpans } from '../src/fuzzy.js'
import { parseMarkdown } from '../src/parse.js'
import { PathResolver, basename, normalizeTarget } from '../src/resolve.js'
import { fold, queryTerms, tokenize } from '../src/tokenize.js'
import { parseQuery } from '../src/memory-index.js'

describe('tokenize', () => {
  it('folds Portuguese diacritics', () => {
    expect(fold('memória')).toBe('memoria')
    expect(fold('NÃO')).toBe('nao')
  })

  it('keeps offsets in the ORIGINAL text', () => {
    const text = 'olá mundo'
    const tokens = tokenize(text)
    expect(tokens.map((t) => t.term)).toEqual(['ola', 'mundo'])
    expect(text.slice(tokens[1].offset, tokens[1].offset + tokens[1].length)).toBe('mundo')
  })

  it('emits CJK per character as well as per segment', () => {
    const terms = tokenize('中文分词').map((t) => t.term)
    expect(terms).toContain('分')
    expect(terms).toContain('词')
  })

  it('drops duplicate query terms but keeps order', () => {
    expect(queryTerms('memory memory layout')).toEqual(['memory', 'layout'])
  })
})

describe('parseMarkdown', () => {
  it('reads frontmatter keys without touching values', () => {
    const parsed = parseMarkdown('---\ntitle: Hello\ntags: [a, b]\n---\n\nbody')
    expect(parsed.frontmatterKeys).toEqual(['title', 'tags'])
  })

  it('blanks frontmatter but preserves every downstream offset', () => {
    const text = '---\ntitle: x\n---\nhello'
    const parsed = parseMarkdown(text)
    expect(parsed.body.length).toBe(text.length)
    expect(parsed.body.endsWith('hello')).toBe(true)
    expect(parsed.body).not.toContain('title:')
  })

  it('reads frontmatter tags in every Obsidian form, through one parser', () => {
    const tags = (text: string): string[] => parseMarkdown(text).frontmatterTags.map((t) => t.tag)
    expect(tags('---\ntags: [a, b]\n---\n')).toEqual(['#a', '#b'])
    expect(tags('---\ntags:\n  - a\n  - b\n---\n')).toEqual(['#a', '#b'])
    // The vault's legacy space-separated shapes, flow and block.
    expect(tags('---\ntags: [composition testing]\n---\n')).toEqual(['#composition', '#testing'])
    expect(tags('---\ntags:\n  - functional-programming composition\n---\n')).toEqual([
      '#functional-programming',
      '#composition',
    ])
    expect(tags('---\ntag: solo\n---\n')).toEqual(['#solo'])
  })

  it('holds frontmatter tags to the SAME grammar as inline ones', () => {
    // `#2026` is an issue number in the body; `tags: [2026]` is no more a tag.
    expect(parseMarkdown('---\ntags: [2026, real]\n---\n').frontmatterTags).toEqual([
      { tag: '#real', offset: 17 },
    ])
  })

  it('points a frontmatter tag at its text inside the block', () => {
    const text = '---\ntags: [alpha]\n---\nbody'
    const [tag] = parseMarkdown(text).frontmatterTags
    expect(text.slice(tag.offset, tag.offset + 5)).toBe('alpha')
  })

  it('keeps frontmatter tags out of the blanked body', () => {
    const parsed = parseMarkdown('---\ntags: [alpha]\n---\n#beta\n')
    expect(parsed.tags.map((t) => t.tag)).toEqual(['#beta'])
    expect(parsed.frontmatterTags.map((t) => t.tag)).toEqual(['#alpha'])
  })

  it('reads aliases without splitting a phrase on spaces', () => {
    expect(parseMarkdown('---\naliases:\n  - Memory Layout\n---\n').aliases).toEqual([
      'Memory Layout',
    ])
    expect(parseMarkdown('---\nalias: One, Two\n---\n').aliases).toEqual(['One', 'Two'])
    expect(parseMarkdown('# no block').aliases).toEqual([])
  })

  it('leaves a tag inside a code span out, exactly as the editor does (Fork 6)', () => {
    const tags = (text: string): string[] => parseMarkdown(text).tags.map((t) => t.tag)
    // The editor's inline parser consumes a whole code span before any other
    // handler sees it, so `#pool` in one is never a chip. A hit here would be a
    // search result with nothing to click.
    expect(tags('a `#pool` span and a #real tag')).toEqual(['#real'])
    expect(tags('``a `#x` b`` and #y')).toEqual(['#y'])
    // An unmatched backtick is literal text, and the tag after it is a tag.
    expect(tags('one ` backtick and #still a tag')).toEqual(['#still'])
    // A span cannot cross a paragraph break, or one stray backtick would eat
    // the rest of the note's tags.
    expect(tags('a ` tick\n\n#after the break')).toEqual(['#after'])
    // Fences were already out, and still are.
    expect(tags('```\n#no\n```\n\n#yes')).toEqual(['#yes'])
  })

  it('does not treat a frontmatter value as a tag or a heading', () => {
    const parsed = parseMarkdown('---\ntags: [x]\n---\n# Real')
    expect(parsed.headings.map((h) => h.text)).toEqual(['Real'])
  })

  it('parses every wikilink form the vault actually uses', () => {
    const parsed = parseMarkdown('[[Plain]] [[Target|alias]] [[Note#Heading]] ![[img.png]]')
    expect(parsed.links.map((l) => l.target)).toEqual(['Plain', 'Target', 'Note', 'img.png'])
    expect(parsed.links[1].alias).toBe('alias')
    expect(parsed.links[2].anchor).toBe('Heading')
    expect(parsed.links[3].embed).toBe(true)
  })

  it('keeps a block-ref anchor intact even though resolution is deferred', () => {
    const parsed = parseMarkdown('[[Note#^abc123]]')
    expect(parsed.links[0].anchor).toBe('^abc123')
  })

  it('ignores links and tags inside fenced code', () => {
    const parsed = parseMarkdown('```\n[[No]] #nope\n```\n[[Yes]] #yes')
    expect(parsed.links.map((l) => l.target)).toEqual(['Yes'])
    expect(parsed.tags.map((t) => t.tag)).toEqual(['#yes'])
  })

  it('does not mistake a heading or a bare number for a tag', () => {
    const parsed = parseMarkdown('# Heading\n\nissue #123 and #real')
    expect(parsed.tags.map((t) => t.tag)).toEqual(['#real'])
  })

  it('does not mistake a leading thematic break for frontmatter', () => {
    // `---` then content then `---` is a horizontal rule, not YAML. Treating
    // it as frontmatter blanked real prose out of the index while leaving it
    // visible in the editor.
    const parsed = parseMarkdown('---\n\nReal content with [[Link]] and #tag\n\n---\n\nmore\n')
    expect(parsed.frontmatterKeys).toEqual([])
    expect(parsed.bodyOffset).toBe(0)
    expect(parsed.links.map((l) => l.target)).toEqual(['Link'])
    expect(parsed.tags.map((t) => t.tag)).toEqual(['#tag'])
  })

  it('requires the closing delimiter to be a line of its own', () => {
    const parsed = parseMarkdown('---\ntitle: x\n---- not a fence\n---\nbody')
    expect(parsed.frontmatterKeys).toEqual(['title'])
    expect(parsed.body.endsWith('body')).toBe(true)
  })

  it('accepts the `...` YAML terminator', () => {
    expect(parseMarkdown('---\ntitle: x\n...\nbody').frontmatterKeys).toEqual(['title'])
  })

  it('survives an unterminated fence', () => {
    expect(() => parseMarkdown('```\nnever closed')).not.toThrow()
  })
})

describe('PathResolver', () => {
  const paths = [
    'Areas/CS/Systems Programming.md',
    'Areas/CS/Memory Layout.md',
    'Projects/Memory Layout.md',
    'Daily/2-9-2026.md',
  ]

  it('normalises targets', () => {
    expect(normalizeTarget('Note.md')).toBe('Note')
    expect(basename('a/b/Note.md')).toBe('Note')
  })

  it('resolves an exact path', () => {
    const r = new PathResolver(paths)
    expect(r.resolve('Areas/CS/Memory Layout')).toBe('Areas/CS/Memory Layout.md')
  })

  it('breaks a duplicate basename by proximity to the linking note', () => {
    const r = new PathResolver(paths)
    expect(r.resolve('Memory Layout', 'Areas/CS/Systems Programming.md')).toBe(
      'Areas/CS/Memory Layout.md'
    )
    expect(r.resolve('Memory Layout', 'Projects/Something.md')).toBe('Projects/Memory Layout.md')
  })

  it('is deterministic with no linking note', () => {
    const r = new PathResolver(paths)
    expect(r.resolve('Memory Layout')).toBe(r.resolve('Memory Layout'))
  })

  it('never matches a path-prefixed target against a different folder', () => {
    const r = new PathResolver(paths)
    expect(r.resolve('Archive/Memory Layout')).toBeNull()
  })

  it('returns null for an unknown target', () => {
    expect(new PathResolver(paths).resolve('Nope')).toBeNull()
  })
})

describe('fuzzyScore', () => {
  it('rejects a non-subsequence', () => {
    expect(fuzzyScore('zzz', 'notes/a.md')).toBeNull()
  })

  it('prefers a basename match over a folder match', () => {
    const inName = fuzzyScore('note', 'a/b/note.md')!
    const inFolder = fuzzyScore('note', 'note/b/other.md')!
    expect(inName.score).toBeGreaterThan(inFolder.score)
  })

  it('rewards consecutive characters', () => {
    const tight = fuzzyScore('abc', 'abc.md')!
    const loose = fuzzyScore('abc', 'axbxc.md')!
    expect(tight.score).toBeGreaterThan(loose.score)
  })

  it('returns positions that index into the candidate', () => {
    const match = fuzzyScore('ml', 'Memory Layout.md')!
    expect(match.positions.every((p) => p >= 0 && p < 'Memory Layout.md'.length)).toBe(true)
  })

  it('collapses positions into contiguous spans', () => {
    expect(toSpans([0, 1, 2, 5])).toEqual([
      { from: 0, to: 3 },
      { from: 5, to: 6 },
    ])
  })

  it('treats an empty query as a match with no positions', () => {
    expect(fuzzyScore('', 'anything')).toEqual({ score: 0, positions: [] })
  })
})

describe('parseQuery', () => {
  it('extracts tag: and path: filters and leaves the rest as terms', () => {
    expect(parseQuery('tag:todo path:Areas/ memory layout')).toEqual({
      terms: ['memory', 'layout'],
      tag: '#todo',
      pathPrefix: 'Areas/',
    })
  })

  it('accepts a tag written with or without the hash', () => {
    expect(parseQuery('tag:#x').tag).toBe('#x')
    expect(parseQuery('tag:x').tag).toBe('#x')
  })
})
