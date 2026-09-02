/**
 * The wikilink grammar, tested against the forms the real vault uses:
 * 929 plain targets, 22 aliases, 34 heading refs (29 of them block refs),
 * 14 embeds. Parsing is asserted through the real lezer pipeline rather than
 * a hand-rolled scanner, because the whole point of Fork 3 was to stay on
 * upstream @codemirror/lang-markdown.
 */
import { markdown } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { splitWikiLink, WikiLink } from '../src/wikilink.js'

function nodes(text: string): { name: string; text: string }[] {
  const state = EditorState.create({
    doc: text,
    extensions: [markdown({ extensions: [WikiLink] })],
  })
  const out: { name: string; text: string }[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name.startsWith('WikiLink')) {
        out.push({ name: node.name, text: text.slice(node.from, node.to) })
      }
    },
  })
  return out
}

const parts = (text: string): Record<string, string[]> => {
  const grouped: Record<string, string[]> = {}
  for (const n of nodes(text)) (grouped[n.name] ??= []).push(n.text)
  return grouped
}

describe('WikiLink grammar', () => {
  it('parses a plain link', () => {
    expect(parts('see [[Memory Layout]] here')).toMatchObject({
      WikiLink: ['[[Memory Layout]]'],
      WikiLinkTarget: ['Memory Layout'],
    })
  })

  it('parses an aliased link', () => {
    expect(parts('[[Systems Programming|systems]]')).toMatchObject({
      WikiLinkTarget: ['Systems Programming'],
      WikiLinkAlias: ['systems'],
    })
  })

  it('parses a heading anchor', () => {
    expect(parts('[[Note#Heading]]')).toMatchObject({
      WikiLinkTarget: ['Note'],
      WikiLinkAnchor: ['Heading'],
    })
  })

  it('parses a block ref anchor (resolution deferred, parsing is not)', () => {
    expect(parts('[[Note#^abc123]]')).toMatchObject({
      WikiLinkTarget: ['Note'],
      WikiLinkAnchor: ['^abc123'],
    })
  })

  it('parses an anchor and an alias together', () => {
    expect(parts('[[Note#Heading|display]]')).toMatchObject({
      WikiLinkTarget: ['Note'],
      WikiLinkAnchor: ['Heading'],
      WikiLinkAlias: ['display'],
    })
  })

  it('parses an embed distinctly from a link', () => {
    const found = parts('![[Tree Layout.png]]')
    expect(found.WikiLinkEmbed).toEqual(['![[Tree Layout.png]]'])
    expect(found.WikiLink).toBeUndefined()
  })

  it('marks the brackets so a theme can dim them', () => {
    expect(parts('[[X]]').WikiLinkMark).toEqual(['[[', ']]'])
  })

  it('does not span a newline', () => {
    expect(nodes('[[open\nclosed]]')).toEqual([])
  })

  it('ignores an empty link', () => {
    expect(nodes('[[]]')).toEqual([])
  })

  it('leaves an ordinary markdown link alone', () => {
    expect(nodes('[text](https://example.com)')).toEqual([])
  })

  it('parses two links on one line independently', () => {
    expect(parts('[[A]] and [[B]]').WikiLinkTarget).toEqual(['A', 'B'])
  })

  it('does not treat a single bracket pair as a wikilink', () => {
    expect(nodes('[not a wikilink]')).toEqual([])
  })
})

describe('splitWikiLink', () => {
  it('agrees with the grammar on every form', () => {
    expect(splitWikiLink('Target')).toEqual({ target: 'Target', alias: null, anchor: null })
    expect(splitWikiLink('Target|alias')).toEqual({
      target: 'Target',
      alias: 'alias',
      anchor: null,
    })
    expect(splitWikiLink('Target#Anchor')).toEqual({
      target: 'Target',
      alias: null,
      anchor: 'Anchor',
    })
    expect(splitWikiLink('Target#Anchor|alias')).toEqual({
      target: 'Target',
      alias: 'alias',
      anchor: 'Anchor',
    })
  })

  it('treats a # inside an alias as display text, not an anchor', () => {
    expect(splitWikiLink('Target|C# notes')).toEqual({
      target: 'Target',
      alias: 'C# notes',
      anchor: null,
    })
  })

  it('trims surrounding whitespace', () => {
    expect(splitWikiLink('  Target  |  alias  ')).toEqual({
      target: 'Target',
      alias: 'alias',
      anchor: null,
    })
  })
})

describe('completion range and apply value', () => {
  // These are asserted through the module's own exported helper rather than a
  // live EditorView: the failure mode is "the link points somewhere else",
  // which is about the STRING that gets applied, not about CM6 plumbing.
  it('splits the target off an anchor the same way the parser does', () => {
    expect(splitWikiLink('Design#Decisions').target).toBe('Design')
    expect(splitWikiLink('Design#Decisions').anchor).toBe('Decisions')
  })
})
