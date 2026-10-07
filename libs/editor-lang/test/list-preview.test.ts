/**
 * Lists in Live (Chris, 2026-10-06): the bullet is drawn on the caret's line
 * the moment `- ` is complete — "the space live previews it, not the new
 * line" — and is text again only while the marker itself is being edited.
 * Plus the depth every list line carries for the indent and the guides.
 *
 * All of it is the decoration SET over a real state: the document is never
 * touched by rendering, which the last block asserts outright.
 */
import { ensureSyntaxTree, indentUnit } from '@codemirror/language'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { indentListItem, listMarkerBefore, outdentListItem, selectListMarker } from '../src/index.js'
import { buildPreview } from '../src/preview/build.js'
import { decorations, hidden, makeState, type FlatDeco } from './support.js'

const bullets = (decos: FlatDeco[]): string[] =>
  decos.filter((d) => d.value === 'BulletWidget').map((d) => d.text)
/** Is this exact text hidden (replaced, with or without a widget)? */
const hides = (decos: FlatDeco[], text: string): boolean =>
  decos.some((d) => d.text === text && (d.kind === 'hide' || d.kind === 'widget'))
/** The `--cm-list-depth` of every list line, by the line's text. */
function depths(state: EditorState): Record<string, number> {
  const out: Record<string, number> = {}
  buildPreview(state).decorations.between(0, state.doc.length, (from, to, deco) => {
    const spec = deco.spec as { class?: string; attributes?: { style?: string } }
    if (from !== to || spec.class !== 'cm-list-line') return
    out[state.doc.lineAt(from).text] = Number(/--cm-list-depth: (\d+)/.exec(spec.attributes?.style ?? '')?.[1])
  })
  return out
}

/** Type at the caret, as a keystroke does: the caret ends after the text. */
function type(state: EditorState, text: string): EditorState {
  const at = state.selection.main.head
  const next = state.update({ changes: { from: at, insert: text }, selection: { anchor: at + text.length } }).state
  ensureSyntaxTree(next, next.doc.length, 10_000)
  return next.update({}).state
}

/** A view that is only a state and a dispatch — all a Command touches. */
function fakeView(state: EditorState): { view: EditorView; get: () => EditorState; changed: () => boolean } {
  let current = state
  let changed = false
  const view = {
    get state() {
      return current
    },
    dispatch(spec: TransactionSpec) {
      const tr = current.update(spec)
      changed ||= tr.docChanged
      current = tr.state
    },
  } as unknown as EditorView
  return { view, get: () => current, changed: () => changed }
}

describe('the bullet on the caret line', () => {
  it('appears when the space after `-` is typed — not before', () => {
    let state = makeState('')
    state = type(state, '-')
    expect(bullets(decorations(state))).toEqual([])
    expect(hidden(state)).toEqual([])
    state = type(state, ' ')
    // Drawn now. While the item is empty only the `-` is replaced: the space
    // stays text, so the caret has a text node after the dot (see the depth
    // block below for why that matters).
    expect(bullets(decorations(state))).toEqual(['-'])
    // …and the replaced range is atomic, so the caret cannot fall into it.
    expect(hidden(state)).toEqual([{ from: 0, to: 1 }])
    state = type(state, 'item')
    expect(bullets(decorations(state))).toEqual(['- '])
    expect(hidden(state)).toEqual([{ from: 0, to: 2 }])
    expect(state.doc.toString()).toBe('- item')
  })

  it('stays drawn wherever the caret is after the marker', () => {
    for (const at of [2, 3, 6]) {
      expect(bullets(decorations(makeState('- item\n', { at }))), `caret at ${at}`).toEqual(['- '])
    }
  })

  it('is raw text while the caret is inside the marker or immediately before it', () => {
    for (const at of [0, 1]) {
      const decos = decorations(makeState('- item\n', { at }))
      expect(bullets(decos), `caret at ${at}`).toEqual([])
      expect(hides(decos, '- '), `caret at ${at}`).toBe(false)
    }
    // A selection over the marker is editing it too.
    const selected = decorations(makeState('- item\n', { at: { anchor: 4, head: 0 } }))
    expect(bullets(selected)).toEqual([])
  })

  it('keeps every OTHER line\'s bullet drawn — the rule is per marker, not per line', () => {
    const decos = decorations(makeState('- one\n- two\n', { at: 6 })) // before the second `-`
    expect(bullets(decos)).toEqual(['- '])
    expect(decos.find((d) => d.value === 'BulletWidget')?.from).toBe(0)
  })

  it('draws a nested item\'s bullet after its indent, and is raw just before its `-`', () => {
    const note = '- a\n\t- b\n'
    expect(bullets(decorations(makeState(note, { at: note.length - 1 })))).toEqual(['- ', '- '])
    // The tab is indentation, not marker: a caret before it is not editing `-`.
    expect(bullets(decorations(makeState(note, { at: 4 })))).toEqual(['- ', '- '])
    expect(bullets(decorations(makeState(note, { at: 5 })))).toEqual(['- '])
  })

  it('hides a task\'s `- ` on the caret line and keeps the checkbox', () => {
    const decos = decorations(makeState('- [ ] todo\n', { at: 10 }))
    expect(decos.some((d) => d.text === '- ' && d.kind === 'hide')).toBe(true)
    expect(decos.some((d) => d.value === 'CheckboxWidget')).toBe(true)
    // At the start of the line the dash is being edited: text again.
    const raw = decorations(makeState('- [ ] todo\n', { at: 0 }))
    expect(raw.some((d) => d.text === '- ')).toBe(false)
  })

  it('leaves ordered numbers as styled text', () => {
    const decos = decorations(makeState('1. one\n', { at: 6 }))
    expect(decos.some((d) => d.text === '1.' && d.value === 'cm-list-num')).toBe(true)
    expect(decos.some((d) => d.kind === 'hide' || d.kind === 'widget')).toBe(false)
  })
})

describe('depth 1–4, tab-indented (Chris, 2026-10-06: it broke at the third bullet)', () => {
  const note = '- a\n\t- b\n\t\t- c\n\t\t\t- d'

  it('draws every level\'s bullet, with the caret after its marker at each', () => {
    for (let n = 1; n <= 4; n++) {
      const state = makeState(note, { at: 0 })
      const line = state.doc.line(n)
      const at = line.to - 1 // just after the marker, before the letter
      const caret = makeState(note, { at })
      expect(bullets(decorations(caret)), `line ${n}`).toEqual(['- ', '- ', '- ', '- '])
      // The marker's hidden range ends exactly at the caret: atomic, and the
      // caret is AFTER it, never inside or before it.
      const range = hidden(caret).find((r) => r.from >= line.from && r.to <= line.to)!
      expect(range, `line ${n}`).toEqual({ from: line.to - 3, to: at })
      expect(markerSelectedAt(caret, range), `line ${n}`).toBe(false)
    }
  })

  it('keeps the widget while typing after the marker, at every depth', () => {
    for (let n = 1; n <= 4; n++) {
      let state = makeState(note, { at: makeState(note).doc.line(n).to - 1 })
      state = type(state, 'xy')
      expect(state.doc.line(n).text.endsWith(`- xy${'abcd'[n - 1]}`), `line ${n}`).toBe(true)
      expect(bullets(decorations(state)), `line ${n}`).toEqual(['- ', '- ', '- ', '- '])
    }
  })

  it('leaves a text node after the dot on an EMPTY item at every depth, so no browser can put the caret before it', () => {
    // The Firefox failure: an item just opened by Enter is `\t\t- ` with the
    // caret at the end. Were the whole `- ` replaced, the line would END in
    // the widget, Firefox would normalise the DOM caret into the indent
    // before it, and CM6 would adopt that as the selection.
    for (let depth = 0; depth <= 3; depth++) {
      // The parents, one per level, then the empty item at `depth`.
      const parents = Array.from({ length: depth }, (_, i) => `${'\t'.repeat(i)}- p${i}\n`).join('')
      const doc = `${parents}${'\t'.repeat(depth)}- `
      let state = makeState(doc, { at: doc.length })
      expect(bullets(decorations(state)), `depth ${depth}`).toEqual([...Array(depth).fill('- '), '-'])
      for (const r of hidden(state)) expect(r.to, `depth ${depth}`).toBeLessThan(doc.length)
      state = type(state, 'c')
      expect(state.doc.toString()).toBe(`${doc}c`)
      expect(bullets(decorations(state))).toEqual(Array(depth + 1).fill('- '))
    }
  })
})

/** The marker rule, asked of a hidden range: is the selection editing it? */
function markerSelectedAt(state: EditorState, r: { from: number; to: number }): boolean {
  return state.selection.ranges.some((s) => s.from < r.to && s.to >= r.from)
}

describe('Backspace from the start of the text', () => {
  it('first selects the marker — raw again — then deletes it like any selection', () => {
    const { view, get, changed } = fakeView(makeState('- item\n', { at: 2 }))
    expect(selectListMarker(view)).toBe(true)
    expect(changed()).toBe(false)
    expect(get().selection.main).toMatchObject({ from: 0, to: 2, head: 0 })
    expect(bullets(decorations(get()))).toEqual([])
    expect(hides(decorations(get()), '- ')).toBe(false)
    // The second press finds a selection, so this binding steps aside and the
    // default delete takes the selected `- `.
    expect(selectListMarker(view)).toBe(false)
    view.dispatch(get().replaceSelection(''))
    expect(get().doc.toString()).toBe('item\n')
  })

  it('does the same for a nested item, leaving its indent', () => {
    const { view, get } = fakeView(makeState('- a\n\t- b\n', { at: 7 }))
    expect(selectListMarker(view)).toBe(true)
    expect(get().selection.main).toMatchObject({ from: 5, to: 7 })
    view.dispatch(get().replaceSelection(''))
    expect(get().doc.toString()).toBe('- a\n\tb\n')
  })

  it('selects an empty item\'s `- ` too — the space is text there, but it is the marker', () => {
    const { view, get } = fakeView(makeState('- a\n\t- ', { at: 7 }))
    expect(selectListMarker(view)).toBe(true)
    expect(get().selection.main).toMatchObject({ from: 5, to: 7 })
  })

  it('takes a task\'s whole `- [ ] ` from after the box', () => {
    expect(listMarkerBefore(makeState('- [ ] todo\n'), 6)).toEqual({ from: 0, to: 6 })
    const { view, get } = fakeView(makeState('- [ ] todo\n', { at: 6 }))
    expect(selectListMarker(view)).toBe(true)
    const decos = decorations(get())
    expect(decos.some((d) => d.kind === 'hide' || d.kind === 'widget')).toBe(false)
  })

  it('is not the binding anywhere else — mid-text, Source, or an ordered item', () => {
    expect(selectListMarker(fakeView(makeState('- item\n', { at: 4 })).view)).toBe(false)
    expect(selectListMarker(fakeView(makeState('- item\n', { at: 2, mode: 'source' })).view)).toBe(false)
    expect(selectListMarker(fakeView(makeState('1. item\n', { at: 3 })).view)).toBe(false)
  })
})

describe('depth', () => {
  const note = '- a\n\t- b\n\t\t- c\n\t\tmore c\n\t- d\n1. one\n\t1. two\n'

  it('gives every list line its nesting depth, continuation lines included', () => {
    expect(depths(makeState(note, { at: 0 }))).toEqual({
      '- a': 0,
      '\t- b': 1,
      '\t\t- c': 2,
      '\t\tmore c': 2,
      '\t- d': 1,
      '1. one': 0,
      '\t1. two': 1,
    })
  })

  it('draws in Reading as in Live, and not at all in Source', () => {
    expect(depths(makeState(note, { mode: 'reading' }))['\t\t- c']).toBe(2)
    expect(bullets(decorations(makeState(note, { at: 0, mode: 'reading' })))).toHaveLength(4)
    const source = decorations(makeState(note, { mode: 'source' }))
    expect(source.some((d) => d.value === 'cm-list-line')).toBe(false)
    expect(bullets(source)).toEqual([])
  })
})

describe('the document is never touched', () => {
  it('holds the same text through every mode and caret position', () => {
    const note = '- a\n\t- [ ] b\n\t\t- c\n1. d\n'
    for (const mode of ['live', 'source', 'reading'] as const) {
      for (let at = 0; at <= note.length; at++) {
        const state = makeState(note, { at, mode })
        decorations(state)
        expect(state.doc.toString()).toBe(note)
      }
    }
  })
})

describe('Tab and Shift+Tab on a list line', () => {
  // As libs/editor configures it: the vault indents with tabs, read at four.
  const editor = [indentUnit.of('\t'), EditorState.tabSize.of(4)]
  const run = (doc: string, at: number | { anchor: number; head: number }, cmd = indentListItem) => {
    const v = fakeView(makeState(doc, { at, extensions: editor }))
    const handled = cmd(v.view)
    return { handled, doc: v.get().doc.toString(), state: v.get() }
  }

  it('indents the item one unit at the line start, caret anywhere on the line', () => {
    for (const at of [0, 2, 5]) {
      const r = run('- a\n- item\n', 4 + at)
      expect(r.state.doc.line(2).text, `caret at ${at}`).toBe('\t- item')
      expect(r.handled).toBe(true)
      expect(r.doc).toBe('- a\n\t- item\n')
    }
  })

  it('keeps a caret after a drawn bullet after it — Tab is never eaten by the atomic range', () => {
    const r = run('- a\n- item\n', 6) // right after the second `- `
    expect(r.state.selection.main.head).toBe(7)
    expect(bullets(decorations(r.state))).toEqual(['- ', '- '])
  })

  it('outdents by one unit, a tab or a unit of spaces, and is a no-op at the top', () => {
    expect(run('- a\n\t- b\n\t\t- c\n', 12, outdentListItem).doc).toBe('- a\n\t- b\n\t- c\n')
    expect(run('- a\n    - b\n', 9, outdentListItem).doc).toBe('- a\n- b\n')
    const top = run('- a\n', 2, outdentListItem)
    // Still the list's key — focus does not leave from the middle of a list.
    expect(top).toMatchObject({ handled: true, doc: '- a\n' })
  })

  it('moves every selected list line', () => {
    const doc = '- a\n- b\n- c\n- d\n'
    // From inside `b` to inside `c`: b and c move; a and d stay.
    expect(run(doc, { anchor: 5, head: 10 }).doc).toBe('- a\n\t- b\n\t- c\n- d\n')
    // A selection ending at a line's very start does not take that line.
    expect(run(doc, { anchor: 4, head: 8 }).doc).toBe('- a\n\t- b\n- c\n- d\n')
  })

  it('indents ordered items the same way', () => {
    expect(run('1. a\n2. b\n', 8).doc).toBe('1. a\n\t2. b\n')
  })

  it('never indents a list\'s first item — it has nothing to nest under, and would become code', () => {
    expect(run('- a\n- b\n', 2)).toMatchObject({ handled: true, doc: '- a\n- b\n' })
    expect(run('- a\n\t- b\n', 7)).toMatchObject({ handled: true, doc: '- a\n\t- b\n' })
  })

  it('leaves a non-list line to Tab\'s existing behaviour', () => {
    expect(run('plain\n', 2)).toMatchObject({ handled: false, doc: 'plain\n' })
    expect(run('```\n- not a list\n```\n', 6)).toMatchObject({ handled: false })
    expect(run('plain\n', 2, outdentListItem).handled).toBe(false)
  })

  it('keeps a task\'s box', () => {
    const r = run('- a\n- [ ] todo\n', 12)
    expect(r.doc).toBe('- a\n\t- [ ] todo\n')
    expect(decorations(r.state).some((d) => d.value === 'CheckboxWidget')).toBe(true)
  })

  it('does nothing in a read-only view (Reading)', () => {
    const v = fakeView(makeState('- a\n', { at: 2, extensions: [...editor, EditorState.readOnly.of(true)] }))
    expect(indentListItem(v.view)).toBe(false)
    expect(outdentListItem(v.view)).toBe(false)
  })
})
