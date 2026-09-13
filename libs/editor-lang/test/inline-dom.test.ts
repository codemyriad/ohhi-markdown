/**
 * Reading's table cells are built from the syntax tree, not from a second
 * markdown parser (Fork 3-A) — this is the extraction half, which is pure.
 */
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { describe, expect, it } from 'vitest'
import { extractInline, type InlinePiece } from '../src/preview/inline-dom.js'
import { makeState } from './support.js'

function cells(doc: string): InlinePiece[][] {
  const state = makeState(doc, { mode: 'reading' })
  const out: InlinePiece[][] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name === 'TableCell') out.push(extractInline(state, node.node as SyntaxNode))
    },
  })
  return out
}

describe('extractInline', () => {
  it('keeps plain text as text', () => {
    expect(cells('| a | b |\n| --- | --- |\n| one | two |\n')[2]).toEqual([
      { kind: 'text', text: 'one' },
    ])
  })

  it('unwraps emphasis, code and highlight, dropping their markers', () => {
    const cell = cells('| x |\n| --- |\n| **b** and `c` and ==m== |\n')[1]
    expect(cell).toEqual([
      { kind: 'strong', children: [{ kind: 'text', text: 'b' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'code', children: [{ kind: 'text', text: 'c' }] },
      { kind: 'text', text: ' and ' },
      { kind: 'mark', children: [{ kind: 'text', text: 'm' }] },
    ])
  })

  it('carries a link’s target, and never its markup', () => {
    expect(cells('| x |\n| --- |\n| [docs](https://ex.dev) |\n')[1]).toEqual([
      { kind: 'link', url: 'https://ex.dev', children: [{ kind: 'text', text: 'docs' }] },
    ])
  })

  it('carries a bare URL as its own link', () => {
    expect(cells('| x |\n| --- |\n| https://ex.dev |\n')[1]).toEqual([
      {
        kind: 'link',
        url: 'https://ex.dev',
        children: [{ kind: 'text', text: 'https://ex.dev' }],
      },
    ])
  })

  it('carries a tag and a wikilink as what a click needs', () => {
    const cell = cells('| x |\n| --- |\n| #tag and [[Note]] |\n')[1]
    expect(cell).toEqual([
      { kind: 'tag', tag: 'tag' },
      { kind: 'text', text: ' and ' },
      { kind: 'wikilink', target: 'Note', label: 'Note', resolved: false },
    ])
  })

  it('reads a cell’s escaped pipes as the characters they stand for', () => {
    // A table cell escapes `|`, so an aliased wikilink inside one is written
    // `[[Target\|alias]]` (Obsidian's own instruction). The target is `Target`:
    // with the backslash left on it the link resolves to nothing and the cell
    // renders a broken link over a note that is right there.
    const cell = cells('| x |\n| --- |\n| [[Target\\|alias]] and a \\| pipe |\n')[1]
    expect(cell).toEqual([
      { kind: 'wikilink', target: 'Target', label: 'alias', resolved: false },
      { kind: 'text', text: ' and a ' },
      { kind: 'text', text: '|' },
      { kind: 'text', text: ' pipe' },
    ])
  })
})
