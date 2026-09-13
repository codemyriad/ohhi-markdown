/**
 * The three grammar extensions the Read slice adds, asserted through the real
 * lezer pipeline (as wikilink.test.ts does) rather than against a hand-rolled
 * scanner — the point of Fork 3 was to stay on upstream lang-markdown.
 */
import { scanTags } from '@editor/index'
import { describe, expect, it } from 'vitest'
import { makeState } from './support.js'
import { syntaxTree } from '@codemirror/language'

function nodes(text: string, name: string): string[] {
  const state = makeState(text)
  const out: string[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === name) out.push(text.slice(node.from, node.to))
    },
  })
  return out
}

describe('Tag grammar', () => {
  it('parses a plain and a nested tag', () => {
    expect(nodes('see #flashcards and #edible/roadmap', 'Tag')).toEqual([
      '#flashcards',
      '#edible/roadmap',
    ])
  })

  it('takes a tag at the very start of a line', () => {
    expect(nodes('#insp/data-vis-article', 'Tag')).toEqual(['#insp/data-vis-article'])
  })

  it('rejects what Obsidian rejects', () => {
    // 55 issue refs, 2 hex colours and a URL fragment in the real vault.
    expect(nodes('fixes #123 and #456', 'Tag')).toEqual([])
    expect(nodes("colour '#ccc' here", 'Tag')).toEqual([])
    expect(nodes('a#notatag', 'Tag')).toEqual([])
    expect(nodes('see https://example.com/page#frag', 'Tag')).toEqual([])
  })

  it('never fires inside code, where a `#` is a comment or a colour', () => {
    expect(nodes('`#ccc` is grey', 'Tag')).toEqual([])
    expect(nodes('```\n# heading in code\n#tag\n```\n', 'Tag')).toEqual([])
  })

  /**
   * Fork 6: one definition of a tag. The editor's parser and the index's
   * scanner run over the same corpus and must agree, tag for tag — a chip in
   * the note and a hit in `tag:#x` can then never disagree.
   */
  it('agrees with the index scanner over the vault corpus', () => {
    const corpus = [
      '#edible/roadmap in a line',
      'trailing #edible/story',
      '#flashcards/systems #insp/data-vis-article',
      'fixes #123, not a tag',
      "a colour '#ccc' and a key {#key}",
      'a#notatag and https://x.dev/p#frag',
      '#tag_with_underscore #tag-with-dash #Ünïcode',
      'punctuation after: #edible/roadmap.',
      // A code span is not text: the editor's inline parser never looks inside
      // one, so the index must not count what it holds either (Fork 6).
      'a `#pool` span beside a #real tag',
      'an unmatched ` backtick leaves #tags alone',
    ]
    for (const line of corpus) {
      expect(nodes(line, 'Tag')).toEqual(scanTags(line).map((hit) => `#${hit.tag}`))
    }
  })
})

describe('Highlight grammar', () => {
  it('parses `==text==` with its marks', () => {
    expect(nodes('a ==highlighted== word', 'Highlight')).toEqual(['==highlighted=='])
    expect(nodes('a ==highlighted== word', 'HighlightMark')).toEqual(['==', '=='])
  })

  it('leaves a lone or spaced `==` alone', () => {
    expect(nodes('a == b', 'Highlight')).toEqual([])
    expect(nodes('x == y == z', 'Highlight')).toEqual([])
  })

  it('nests other inline markup', () => {
    expect(nodes('==a **bold** one==', 'StrongEmphasis')).toEqual(['**bold**'])
  })
})

describe('Frontmatter grammar', () => {
  const block = '---\ntitle: A note\ntags: [composition testing]\n---\n\n# Body\n'

  it('parses a block at the top of the note, marks and all', () => {
    expect(nodes(block, 'Frontmatter')).toEqual([
      '---\ntitle: A note\ntags: [composition testing]\n---',
    ])
    expect(nodes(block, 'FrontmatterMark')).toEqual(['---', '---'])
  })

  it('keeps markdown out of the YAML: `[a b]` is not a link, `---` is not a rule', () => {
    expect(nodes(block, 'Link')).toEqual([])
    expect(nodes(block, 'HorizontalRule')).toEqual([])
    expect(nodes(block, 'ATXHeading1')).toEqual(['# Body'])
  })

  it('accepts `...` as the closing delimiter', () => {
    expect(nodes('---\nkey: value\n...\n\nbody\n', 'Frontmatter')).toEqual(['---\nkey: value\n...'])
  })

  it('is a Frontmatter node even with no keys — what counts is the index’s call', () => {
    expect(nodes('---\n---\n\nbody\n', 'Frontmatter')).toEqual(['---\n---'])
  })

  it('is only ever the top of the document', () => {
    const later = '# Head\n\n---\nkey: value\n---\n'
    expect(nodes(later, 'Frontmatter')).toEqual([])
    expect(nodes(later, 'HorizontalRule')).toEqual(['---'])
  })

  it('is nothing at all when the block is never closed', () => {
    // Nothing is hidden, and typing the closing `---` restores the block
    // (R4.1.1).
    expect(nodes('---\ntitle: half typed\n\n# Body\n', 'Frontmatter')).toEqual([])
  })

  it('leaves the note parsing while the block is half typed', () => {
    // A block parser cannot rewind: every line it looks at is consumed whether
    // or not a node comes of it. So the scan starts only when the line under
    // the `---` could be YAML, and stops at the first line that could not —
    // otherwise typing `---` at the top of a long note would blank the next
    // sixty-four lines until the closing fence was typed.
    const typing = ['---', 'title: half typed', '', 'Prose about it.', '- a bullet', '# A heading']
    expect(nodes(typing.join('\n'), 'Frontmatter')).toEqual([])
    expect(nodes(typing.join('\n'), 'ATXHeading1')).toEqual(['# A heading'])
    expect(nodes(typing.join('\n'), 'ListMark')).toEqual(['-'])

    // And `---` above ordinary prose is the thematic break it looks like,
    // without a single line consumed.
    const above = ['---', '# A heading', '', 'Some prose.'].join('\n')
    expect(nodes(above, 'HorizontalRule')).toEqual(['---'])
    expect(nodes(above, 'ATXHeading1')).toEqual(['# A heading'])
  })

  it('gives up rather than swallowing a long note that merely starts with `---`', () => {
    const long = ['---', ...Array.from({ length: 200 }, (_, i) => `line ${i}`), '# Late heading'].join('\n')
    expect(nodes(long, 'Frontmatter')).toEqual([])
    expect(nodes(long, 'ATXHeading1')).toEqual(['# Late heading'])
  })
})
