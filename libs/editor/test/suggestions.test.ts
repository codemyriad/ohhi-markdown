/**
 * The suggestions extension (writing-harness B7) over a bare EditorState, in
 * node: what it draws, how it follows typing between pushes, and what the
 * keys do. Nothing it draws is ever in the document.
 */
import { EditorSelection, EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it, vi } from 'vitest'
import {
  acceptSuggestionAtCaret,
  buildDecorations,
  INTRA_DIFF_MIN,
  rejectSuggestionAtCaret,
  setSuggestions,
  suggestionAt,
  suggestionField,
  suggestions,
  suggestionsIn,
  type EditorSuggestion,
  type SuggestionsHost,
} from '../src/index.js'

const sug = (over: Partial<EditorSuggestion> = {}): EditorSuggestion => ({
  id: 's1',
  from: 6,
  to: 10,
  baseText: 'beta',
  proposedText: 'BETA',
  status: 'pending',
  name: 'Tighten',
  ...over,
})

function host(list: EditorSuggestion[] = []): SuggestionsHost & { accept: ReturnType<typeof vi.fn>; reject: ReturnType<typeof vi.fn> } {
  return { current: () => list, subscribe: () => () => {}, accept: vi.fn(), reject: vi.fn() }
}

function state(doc: string, h: SuggestionsHost, head = 0): EditorState {
  return EditorState.create({ doc, extensions: suggestions(h), selection: EditorSelection.cursor(head) })
}

/** What a decoration set holds, as plain rows. */
function rows(list: readonly EditorSuggestion[]) {
  const out: { from: number; to: number; kind: string; text?: string; cls?: string }[] = []
  const set = buildDecorations(list)
  const cursor = set.iter()
  for (; cursor.value; cursor.next()) {
    const spec = cursor.value.spec as { class?: string; widget?: { text: string; stale: boolean } }
    if (spec.widget) out.push({ from: cursor.from, to: cursor.to, kind: 'add', text: spec.widget.text, cls: spec.widget.stale ? 'stale' : '' })
    else out.push({ from: cursor.from, to: cursor.to, kind: 'del', cls: spec.class ?? '' })
  }
  return out
}

/** A command needs only `state` and `dispatch` of a view. */
const fakeView = (s: EditorState): EditorView => ({ state: s, dispatch: () => {} }) as unknown as EditorView

describe('buildDecorations', () => {
  it('strikes the base and inserts the proposal after it', () => {
    expect(rows([sug()])).toEqual([
      { from: 6, to: 10, kind: 'del', cls: 'ed-suggest-del' },
      { from: 10, to: 10, kind: 'add', text: 'BETA', cls: '' },
    ])
  })

  it('marks a stale one stale on both halves; an insertion has no strike, a deletion no widget', () => {
    expect(rows([sug({ status: 'stale' })]).map((r) => r.cls)).toEqual(['ed-suggest-del ed-suggest-stale', 'stale'])
    expect(rows([sug({ from: 3, to: 3, baseText: '', proposedText: 'x' })])).toEqual([{ from: 3, to: 3, kind: 'add', text: 'x', cls: '' }])
    expect(rows([sug({ proposedText: '' })])).toEqual([{ from: 6, to: 10, kind: 'del', cls: 'ed-suggest-del' }])
  })

  it('diffs a long pending proposal inside the range: only the changed words', () => {
    const baseText = 'The quick brown fox jumps over the lazy dog.'
    const proposedText = 'The quick red fox jumps over the sleepy dog.'
    expect(baseText.length).toBeGreaterThanOrEqual(INTRA_DIFF_MIN)
    const r = rows([sug({ from: 10, to: 10 + baseText.length, baseText, proposedText })])
    const struck = r.filter((x) => x.kind === 'del').map((x) => baseText.slice(x.from - 10, x.to - 10))
    const added = r.filter((x) => x.kind === 'add').map((x) => x.text)
    expect(struck.join('|')).toMatch(/brown/)
    expect(struck.join('|')).toMatch(/lazy/)
    expect(struck.join('')).not.toMatch(/quick|jumps/)
    expect(added.join('|')).toMatch(/red/)
    expect(added.join('|')).toMatch(/sleepy/)
    // A stale long one is struck whole: its text is no longer the base.
    expect(rows([sug({ from: 10, to: 10 + baseText.length, baseText, proposedText, status: 'stale' })])).toHaveLength(2)
  })
})

describe('suggestionField', () => {
  it("starts from the host's records and never changes the document", () => {
    const s = state('alpha beta gamma', host([sug()]))
    expect(suggestionsIn(s)).toEqual([sug()])
    expect(s.doc.toString()).toBe('alpha beta gamma')
  })

  it('follows typing between pushes: edges stay outside, inside stretches', () => {
    let s = state('alpha beta gamma', host([sug()]))
    s = s.update({ changes: { from: 0, insert: '# ' } }).state
    expect(suggestionsIn(s)[0]).toMatchObject({ from: 8, to: 12 })
    s = s.update({ changes: [{ from: 8, insert: '[' }, { from: 12, insert: ']' }] }).state
    expect(suggestionsIn(s)[0]).toMatchObject({ from: 9, to: 13 })
    s = s.update({ changes: { from: 11, insert: 'X' } }).state
    expect(suggestionsIn(s)[0]).toMatchObject({ from: 9, to: 14 })
    s = s.update({ changes: { from: 0, to: s.doc.length } }).state
    expect(suggestionsIn(s)[0]).toMatchObject({ from: 0, to: 0 })
  })

  it('a push replaces the list, clamped to the document', () => {
    let s = state('short', host())
    s = s.update({ effects: setSuggestions.of([sug({ from: 2, to: 99 })]) }).state
    expect(suggestionsIn(s)[0]).toMatchObject({ from: 2, to: 5 })
    expect(s.field(suggestionField)).toHaveLength(1)
  })
})

describe('the keys', () => {
  it('Mod-Enter / Mod-Backspace act on the suggestion under the caret and fall through elsewhere', () => {
    const h = host([sug()])
    const inside = state('alpha beta gamma', h, 8)
    expect(suggestionAt(inside, 8)?.id).toBe('s1')
    expect(acceptSuggestionAtCaret(fakeView(inside))).toBe(true)
    expect(h.accept).toHaveBeenCalledWith('s1')
    expect(rejectSuggestionAtCaret(fakeView(inside))).toBe(true)
    expect(h.reject).toHaveBeenCalledWith('s1')
    const outside = state('alpha beta gamma', h, 1)
    expect(acceptSuggestionAtCaret(fakeView(outside))).toBe(false)
    expect(rejectSuggestionAtCaret(fakeView(outside))).toBe(false)
    expect(h.accept).toHaveBeenCalledTimes(1)
  })

  it('without the extension there is nothing under any caret', () => {
    const plain = EditorState.create({ doc: 'abc' })
    expect(suggestionAt(plain, 1)).toBeNull()
    expect(suggestionsIn(plain)).toEqual([])
    expect(acceptSuggestionAtCaret(fakeView(plain))).toBe(false)
  })
})
