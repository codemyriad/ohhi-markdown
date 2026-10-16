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
  currentSuggestion,
  hasSuggestionGutter,
  INTRA_DIFF_MIN,
  pairDecorations,
  rejectSuggestionAtCaret,
  setSuggestions,
  suggestionAt,
  suggestionField,
  suggestionMarkers,
  suggestions,
  suggestionsIn,
  suggestionStep,
  type EditorSuggestion,
  type SuggestionLabels,
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

const LABELS: SuggestionLabels = {
  accept: 'Accept',
  reject: 'Reject',
  acceptKeys: 'Ctrl+Enter',
  rejectKeys: 'Ctrl+Backspace',
  pair: (s) => `Suggestion by ${s.name}`,
  marker: (s, n, total) => `Suggestion ${n} of ${total} by ${s.name}`,
}

/** Three proposals over `one two three four`: at 4–7, 8–13 and 14–18. */
const THREE = [
  sug({ id: 'a', from: 4, to: 7, baseText: 'two', proposedText: '2' }),
  sug({ id: 'b', from: 8, to: 13, baseText: 'three', proposedText: '3' }),
  sug({ id: 'c', from: 14, to: 18, baseText: 'four', proposedText: '4' }),
]
const labelled = (list: EditorSuggestion[]): SuggestionsHost => ({ ...host(list), labels: () => LABELS })

/** The pair widgets a state draws: [at, id, current]. */
function pairsOf(s: EditorState): [number, string, boolean][] {
  const out: [number, string, boolean][] = []
  const cursor = pairDecorations(s).iter()
  for (; cursor.value; cursor.next()) {
    const w = cursor.value.spec.widget as { s: EditorSuggestion; current: boolean }
    out.push([cursor.from, w.s.id, w.current])
  }
  return out
}

describe('the current suggestion and stepping', () => {
  it('current is the one under the caret, else the next after it, else the first', () => {
    expect(currentSuggestion(state('one two three four', labelled(THREE), 9))?.id).toBe('b')
    expect(currentSuggestion(state('one two three four', labelled(THREE), 0))?.id).toBe('a')
    expect(currentSuggestion(state('one two three four', labelled([THREE[0]]), 18))?.id).toBe('a')
    expect(currentSuggestion(state('one two three four', labelled([]), 0))).toBeNull()
  })

  it('next and previous step from the caret and wrap round', () => {
    const at = (head: number) => state('one two three four', labelled(THREE), head)
    expect(suggestionStep(at(5), 1)?.id).toBe('b')
    expect(suggestionStep(at(16), 1)?.id).toBe('a') // wraps
    expect(suggestionStep(at(5), -1)?.id).toBe('c') // wraps
    expect(suggestionStep(at(0), 1)?.id).toBe('a') // caret in none: the first after it
    expect(suggestionStep(at(0), -1)?.id).toBe('c') // none before it: the last
    expect(suggestionStep(state('one', labelled([]), 0), 1)).toBeNull()
  })
})

describe('the pair', () => {
  it('is drawn after the current proposal only, and moves with the caret', () => {
    expect(pairsOf(state('one two three four', labelled(THREE), 0))).toEqual([[7, 'a', true]])
    expect(pairsOf(state('one two three four', labelled(THREE), 15))).toEqual([[18, 'c', true]])
  })

  it('is not drawn without the host’s words, nor with no suggestion', () => {
    expect(pairsOf(state('one two three four', host(THREE), 0))).toEqual([])
    expect(pairsOf(state('one two three four', labelled([]), 0))).toEqual([])
  })

  it('never enters the document', () => {
    const s = state('one two three four', labelled(THREE), 0)
    expect(s.doc.toString()).toBe('one two three four')
  })
})

describe('the gutter marks', () => {
  /** [line start, label, number shown] per mark. */
  function marksOf(s: EditorState): [number, string, string][] {
    const out: [number, string, string][] = []
    const cursor = suggestionMarkers(s).iter()
    for (; cursor.value; cursor.next()) {
      const m = cursor.value as unknown as { label: string; total: number; n: number }
      out.push([cursor.from, m.label, m.total > 1 ? String(m.n) : ''])
    }
    return out
  }

  it('one proposal is a dot; several are numbered, one mark per line', () => {
    expect(marksOf(state('one two three four', labelled([THREE[1]]), 0))).toEqual([[0, 'Suggestion 1 of 1 by Tighten', '']])
    // All three start on line 1: one mark, for the first.
    expect(marksOf(state('one two three four', labelled(THREE), 0))).toEqual([[0, 'Suggestion 1 of 3 by Tighten', '1']])
    const lines = [sug({ id: 'x', from: 0, to: 3, baseText: 'one' }), sug({ id: 'y', from: 4, to: 7, baseText: 'two' })]
    expect(marksOf(state('one\ntwo', labelled(lines), 0)).map(([at, , n]) => [at, n])).toEqual([
      [0, '1'],
      [4, '2'],
    ])
  })

  it('the gutter is installed only once a push brings suggestions, and goes when they do', () => {
    let s = state('one two three four', labelled([]), 0)
    expect(hasSuggestionGutter(s)).toBe(false)
    s = s.update({ effects: setSuggestions.of(THREE) }).state
    expect(hasSuggestionGutter(s)).toBe(true)
    s = s.update({ effects: setSuggestions.of([]) }).state
    expect(hasSuggestionGutter(s)).toBe(false)
    // Without the host's words there is nothing to name a mark with: no gutter.
    expect(hasSuggestionGutter(state('x', host(THREE), 0).update({ effects: setSuggestions.of(THREE) }).state)).toBe(false)
  })
})
