/**
 * Callouts (editor-usability E3): the header parse, and what the reveal engine
 * draws for one — the title row, the box's line classes, and the view-only
 * fold. All decoration sets, no DOM (the engine is a function of the state).
 */
import { describe, expect, it } from 'vitest'
import { calloutCollapsed, calloutType, parseCalloutHeader } from '../src/preview/callout.js'
import { calloutFolds, setCalloutFold } from '../src/preview/callout-fold.js'
import type { CalloutHeaderWidget } from '../src/preview/callout-widgets.js'
import { decorations, hidden, makeState } from './support.js'

describe('parseCalloutHeader', () => {
  it('reads the type, the title and the fold marker', () => {
    expect(parseCalloutHeader('> [!warning] Mind the gap')).toEqual({
      type: 'warning',
      written: 'warning',
      fold: null,
      title: 'Mind the gap',
      titled: true,
    })
    expect(parseCalloutHeader('> [!tip]- Folded')?.fold).toBe('-')
    expect(parseCalloutHeader('> [!tip]+ Open')?.fold).toBe('+')
    expect(parseCalloutHeader('>[!note]')?.type).toBe('note')
    expect(parseCalloutHeader('  > [!note]   ')?.title).toBe('Note')
  })

  it('defaults the title to the capitalised type as written', () => {
    expect(parseCalloutHeader('> [!FAQ]')?.title).toBe('Faq')
    expect(parseCalloutHeader('> [!faq]')?.type).toBe('question')
    expect(parseCalloutHeader('> [!my-thing]')?.title).toBe('My-thing')
  })

  it('resolves every Obsidian alias, and an unknown type to note', () => {
    const cases: Record<string, string> = {
      summary: 'abstract',
      tldr: 'abstract',
      hint: 'tip',
      important: 'tip',
      check: 'success',
      done: 'success',
      help: 'question',
      caution: 'warning',
      attention: 'warning',
      fail: 'failure',
      missing: 'failure',
      error: 'danger',
      cite: 'quote',
      todo: 'todo',
      info: 'info',
      bug: 'bug',
      example: 'example',
      whatever: 'note',
    }
    for (const [written, type] of Object.entries(cases)) expect(calloutType(written)).toBe(type)
    expect(calloutType('DANGER')).toBe('danger')
  })

  it('is not a callout without the bracket form at the start', () => {
    expect(parseCalloutHeader('> plain quote')).toBe(null)
    expect(parseCalloutHeader('> text [!note]')).toBe(null)
    expect(parseCalloutHeader('[!note] no quote')).toBe(null)
    expect(parseCalloutHeader('> [!] empty')).toBe(null)
  })

  it('folds by the marker unless the view chose otherwise', () => {
    const minus = parseCalloutHeader('> [!tip]- x')!
    const plus = parseCalloutHeader('> [!tip]+ x')!
    const none = parseCalloutHeader('> [!tip] x')!
    expect(calloutCollapsed(minus, undefined)).toBe(true)
    expect(calloutCollapsed(plus, undefined)).toBe(false)
    expect(calloutCollapsed(minus, false)).toBe(false)
    expect(calloutCollapsed(plus, true)).toBe(true)
    // Not foldable: a choice cannot collapse it.
    expect(calloutCollapsed(none, true)).toBe(false)
  })
})

const NOTE = 'intro\n\n> [!warning] Careful\n> first line\n> second line\n\nafter\n'

const lineClasses = (state: ReturnType<typeof makeState>, n: number): string[] => {
  const from = state.doc.line(n).from
  return decorations(state)
    .filter((d) => d.kind === 'line' && d.from === from)
    .map((d) => d.value)
}

describe('callouts in the reveal engine', () => {
  it('draws the header as a title row off the caret, and boxes the body', () => {
    const state = makeState(NOTE, { at: 0 })
    const decos = decorations(state)
    const head = decos.find((d) => d.value === 'CalloutHeaderWidget')
    expect(head?.kind).toBe('block-widget')
    expect(head?.text).toBe('> [!warning] Careful')
    const widget = head?.widget as CalloutHeaderWidget
    expect(widget.type).toBe('warning')
    expect(widget.title).toBe('Careful')
    expect(widget.collapsed).toBe(null)
    expect(lineClasses(state, 4)).toEqual(['cm-callout cm-callout-type-warning'])
    expect(lineClasses(state, 5)).toEqual(['cm-callout cm-callout-type-warning', 'cm-callout-last'])
    // A callout is not also a plain quote: no quote rail under the box.
    expect(decos.some((d) => d.value === 'cm-live-quote')).toBe(false)
  })

  it('gives the header line back as text when the caret is on it, styled as the title', () => {
    const state = makeState(NOTE, { at: 10 })
    expect(decorations(state).some((d) => d.value === 'CalloutHeaderWidget')).toBe(false)
    expect(lineClasses(state, 3)).toEqual([
      'cm-callout cm-callout-type-warning',
      'cm-callout-head cm-callout-first',
    ])
  })

  it('keeps the box on a body line the caret is on', () => {
    const state = makeState(NOTE, { at: state0Line(4) })
    expect(lineClasses(state, 4)).toEqual(['cm-callout cm-callout-type-warning'])
    // …and the header stays a title row: it is another line.
    expect(decorations(state).some((d) => d.value === 'CalloutHeaderWidget')).toBe(true)
  })

  it('renders an unknown type as a note', () => {
    const state = makeState('> [!madeup]\n> body\n', { at: 0, mode: 'reading' })
    const head = decorations(state).find((d) => d.value === 'CalloutHeaderWidget')
    expect((head?.widget as CalloutHeaderWidget).type).toBe('note')
    expect((head?.widget as CalloutHeaderWidget).title).toBe('Madeup')
  })

  it('collapses a `-` callout by default, without touching the text', () => {
    const doc = 'top\n\n> [!tip]- Hidden\n> secret\n> more\n'
    const state = makeState(doc, { at: 0 })
    const decos = decorations(state)
    const fold = decos.find((d) => d.value === 'CalloutFoldedWidget')
    expect(fold?.kind).toBe('block-widget')
    expect(fold?.text).toBe('> secret\n> more')
    const head = decos.find((d) => d.value === 'CalloutHeaderWidget')?.widget as CalloutHeaderWidget
    expect(head.collapsed).toBe(true)
    expect(head.last).toBe(true)
    // The folded body is hidden, so the caret steps over it.
    expect(hidden(state).some((r) => state.doc.sliceString(r.from, r.to) === '> secret\n> more')).toBe(true)
  })

  it('opens and folds from the view state, which never edits the document', () => {
    const doc = 'top\n\n> [!tip]+ Open\n> body\n'
    let state = makeState(doc, { at: 0 })
    expect(decorations(state).some((d) => d.value === 'CalloutFoldedWidget')).toBe(false)
    const at = state.doc.line(3).from
    const tr = state.update({ effects: setCalloutFold.of({ at, collapsed: true }) })
    state = tr.state
    expect(tr.docChanged).toBe(false)
    expect(state.doc.toString()).toBe(doc)
    expect(state.field(calloutFolds).get(at)).toBe(true)
    expect(decorations(state).some((d) => d.value === 'CalloutFoldedWidget')).toBe(true)
  })

  it('maps a fold through an edit above it', () => {
    let state = makeState('top\n\n> [!tip]- x\n> body\n', { at: 0 })
    const at = state.doc.line(3).from
    state = state.update({ effects: setCalloutFold.of({ at, collapsed: false }) }).state
    state = state.update({ changes: { from: 0, insert: 'more ' } }).state
    expect(state.field(calloutFolds).get(at + 5)).toBe(false)
  })

  it('shows a collapsed body while the selection is inside it', () => {
    const doc = 'top\n\n> [!tip]- x\n> body\n'
    const state = makeState(doc, { at: doc.indexOf('body') })
    expect(decorations(state).some((d) => d.value === 'CalloutFoldedWidget')).toBe(false)
  })

  it('never folds in Source, and keeps the header as text there', () => {
    const state = makeState('> [!tip]- x\n> body\n', { at: 0, mode: 'source' })
    const decos = decorations(state)
    expect(decos.some((d) => d.value === 'CalloutFoldedWidget' || d.value === 'CalloutHeaderWidget')).toBe(false)
    expect(decos.some((d) => d.value === 'cm-callout cm-callout-type-tip')).toBe(true)
  })

  it('leaves a quote nested inside a quote as quote text', () => {
    const decos = decorations(makeState('> outer\n> > [!note] inner\n', { at: 0, mode: 'reading' }))
    expect(decos.some((d) => d.value === 'CalloutHeaderWidget')).toBe(false)
  })
})

function state0Line(n: number): number {
  return makeState(NOTE).doc.line(n).from + 3
}
