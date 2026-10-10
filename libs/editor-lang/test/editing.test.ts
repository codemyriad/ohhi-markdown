/**
 * Bracket pairs and wrap-the-selection (E2). `insertBracket` is exactly what
 * closeBrackets' input handler dispatches, so driving it over a state with our
 * language data is driving the typed key.
 */
import { insertBracket } from '@codemirror/autocomplete'
import type { EditorState, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { proseEditing, wrapSelection } from '../src/index.js'
import { makeState } from './support.js'

const state = (doc: string, at: number | { anchor: number; head: number }) =>
  makeState(doc, { at, extensions: [proseEditing()] })

/** Type `keys` one at a time, as closeBrackets would; plain insert otherwise. */
function type(start: EditorState, keys: string): { doc: string; head: number } {
  let s = start
  for (const ch of keys) {
    const tr: Transaction | null = insertBracket(s, ch) ?? wrapSelection(s, ch)
    s = tr ? tr.state : s.update(s.replaceSelection(ch)).state
  }
  return { doc: s.doc.toString(), head: s.selection.main.head }
}
const show = (r: { doc: string; head: number }) => r.doc.slice(0, r.head) + '|' + r.doc.slice(r.head)

describe('closeBrackets in a note', () => {
  it('pairs ( [ { and the backtick', () => {
    for (const [ch, out] of [
      ['(', '(|)'],
      ['[', '[|]'],
      ['{', '{|}'],
      ['`', '`|`'],
    ]) {
      expect(show(type(state('', 0), ch)), ch).toBe(out)
    }
  })

  it('never pairs a quote — it is an apostrophe in prose', () => {
    expect(show(type(state('', 0), "don't"))).toBe("don't|")
    expect(show(type(state('', 0), '"hi'))).toBe('"hi|')
  })

  it('pairs `[[` to `[[|]]`, where the link completion opens, and steps over typed closers', () => {
    expect(show(type(state('', 0), '[['))).toBe('[[|]]')
    expect(show(type(state('', 0), '[[Note]]'))).toBe('[[Note]]|')
  })

  it('types a fence opener as three backticks', () => {
    expect(show(type(state("", 0), "```"))).toBe("```|")
  })

  it('types inline code and a link through to the end, stepping over each closer', () => {
    expect(show(type(state('', 0), 'a `code` b'))).toBe('a `code` b|')
    expect(show(type(state('', 0), '[text](url)'))).toBe('[text](url)|')
  })

  it('wraps a selection in a pair', () => {
    expect(type(state('pick me', { anchor: 0, head: 4 }), '(').doc).toBe('(pick) me')
  })
})

describe('wrapSelection', () => {
  it('wraps the selected text and keeps it selected, so a second key nests', () => {
    const s = state('make bold now', { anchor: 5, head: 9 })
    const once = wrapSelection(s, '*')!
    expect(once.state.doc.toString()).toBe('make *bold* now')
    expect(once.state.sliceDoc(once.state.selection.main.from, once.state.selection.main.to)).toBe('bold')
    expect(type(s, '**').doc).toBe('make **bold** now')
    expect(type(s, '==').doc).toBe('make ==bold== now')
    expect(type(s, '~~').doc).toBe('make ~~bold~~ now')
    expect(type(s, '_').doc).toBe('make _bold_ now')
  })

  it('keeps a backward selection backward', () => {
    const tr = wrapSelection(state('ab cd', { anchor: 5, head: 3 }), '_')!
    expect(tr.state.selection.main).toMatchObject({ anchor: 6, head: 4 })
  })

  it('does nothing with no selection, for other keys, or inside code', () => {
    expect(wrapSelection(state('text', 2), '*')).toBeNull()
    expect(wrapSelection(state('text', { anchor: 0, head: 4 }), 'x')).toBeNull()
    const fence = '```\ncode\n```\n'
    expect(wrapSelection(state(fence, { anchor: 4, head: 8 }), '*')).toBeNull()
    expect(wrapSelection(state('a `code` b', { anchor: 3, head: 7 }), '*')).toBeNull()
  })

  it('a `*` with nothing selected is a bullet or an emphasis mark, typed as is', () => {
    expect(show(type(state('', 0), '* '))).toBe('* |')
  })
})
