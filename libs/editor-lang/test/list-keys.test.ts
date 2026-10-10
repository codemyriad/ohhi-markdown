/**
 * Tab and Shift+Tab SET the selection (E2, Chris 2026-10-10: the caret
 * flashed before the bullet on Tab). The caret is moved by what was inserted
 * before it and kept on the text side of the drawn marker — `assoc: 1`, tied
 * to the text after it rather than the widget before it.
 */
import { indentUnit } from '@codemirror/language'
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { indentListItem, insertIndent, outdentListItem } from '../src/index.js'
import { markerEnd, selectionAfterListEdit } from '../src/preview/commands.js'
import { makeState } from './support.js'

const editor = [indentUnit.of('\t'), EditorState.tabSize.of(4)]

function run(doc: string, at: number | { anchor: number; head: number }, cmd = indentListItem) {
  let current = makeState(doc, { at, extensions: editor })
  let explicit = false
  const view = {
    get state() {
      return current
    },
    dispatch(spec: TransactionSpec) {
      explicit ||= spec.selection !== undefined
      current = current.update(spec).state
    },
  } as unknown as EditorView
  cmd(view)
  const main = current.selection.main
  return { doc: current.doc.toString(), main, explicit, state: current }
}

describe('markerEnd', () => {
  it('is where an item\'s text starts: indent, markers, a task box and its space', () => {
    expect(markerEnd('- a')).toBe(2)
    expect(markerEnd('\t\t- deep')).toBe(4)
    expect(markerEnd('- [ ] todo')).toBe(6)
    expect(markerEnd('\t- [x] done')).toBe(7)
    expect(markerEnd('12. twelve')).toBe(4)
    expect(markerEnd('- - nested on one line')).toBe(4)
    expect(markerEnd('plain')).toBe(0)
  })
})

describe('Tab sets the selection on the text side of the bullet', () => {
  it('moves a caret after the marker by the inserted unit, associated forward', () => {
    const r = run('- a\n- item\n', 6) // right after the second `- `
    expect(r.doc).toBe('- a\n\t- item\n')
    expect(r.explicit).toBe(true)
    expect(r.main.head).toBe(7)
    expect(r.main.assoc).toBe(1)
  })

  it('keeps a caret in the text where it was in the text', () => {
    const r = run('- a\n- item\n', 8) // `- it|em`
    expect(r.main.head).toBe(9)
  })

  it('puts a caret that was in the marker after it, at the text', () => {
    for (const at of [4, 5]) {
      const r = run('- a\n- item\n', at) // before or inside `- `
      expect(r.main.head, `caret at ${at}`).toBe(7)
    }
  })

  it('lands after an empty item\'s marker — the third-level case Chris hit', () => {
    const r = run('- a\n\t- b\n\t- \n', 12)
    expect(r.doc).toBe('- a\n\t- b\n\t\t- \n')
    expect(r.main.head - r.state.doc.lineAt(r.main.head).from).toBe(4)
  })

  it('lands after a task\'s box', () => {
    const r = run('- a\n- [ ] todo\n', 4)
    expect(r.doc).toBe('- a\n\t- [ ] todo\n')
    expect(r.main.head).toBe(4 + 7)
  })

  it('moves a range by the unit at both ends and keeps its direction', () => {
    const r = run('- a\n- b\n- c\n', { anchor: 10, head: 6 })
    expect(r.doc).toBe('- a\n\t- b\n\t- c\n')
    expect(r.main.anchor).toBe(12)
    expect(r.main.head).toBe(7)
  })

  it('leaves the selection alone when nothing could nest', () => {
    const r = run('- a\n- b\n', 2)
    expect(r.doc).toBe('- a\n- b\n')
    expect(r.explicit).toBe(false)
    expect(r.main.head).toBe(2)
  })
})

describe('Shift+Tab sets the selection the same way', () => {
  it('moves a caret back by the removed unit, still after the marker', () => {
    const r = run('- a\n\t- b\n', 7, outdentListItem) // after `\t- `
    expect(r.doc).toBe('- a\n- b\n')
    expect(r.main.head).toBe(6)
    expect(r.main.assoc).toBe(1)
  })

  it('collapses a caret inside the removed indent to the text', () => {
    const r = run('- a\n    - b\n', 6, outdentListItem) // two spaces into the indent
    expect(r.doc).toBe('- a\n- b\n')
    expect(r.main.head).toBe(6)
  })

  it('shifts positions on later lines by every edit above them', () => {
    const r = run('- a\n\t- b\n\t- c\n', { anchor: 8, head: 13 }, outdentListItem)
    expect(r.doc).toBe('- a\n- b\n- c\n')
    expect(r.main.anchor).toBe(7)
    expect(r.main.head).toBe(11)
  })
})

describe('selectionAfterListEdit', () => {
  it('is a function of the old state and the edits only', () => {
    const state = makeState('- a\n- b\n', { at: 6, extensions: editor })
    const sel = selectionAfterListEdit(state, [{ line: state.doc.line(2), delta: 1 }])
    expect(sel.main.head).toBe(7)
    // The state is untouched.
    expect(state.selection.main.head).toBe(6)
  })
})

describe('Tab off a list line (insertIndent)', () => {
  it('inserts the indent unit at the caret, and the caret follows it', () => {
    const r = run('plain text\n', 5, insertIndent)
    expect(r.doc).toBe('plain\t text\n')
    expect(r.main.head).toBe(6)
  })

  it('is what Tab falls through to: the list command declines a paragraph', () => {
    expect(run('plain\n', 2).doc).toBe('plain\n')
    expect(run('```\ncode\n```\n', 6, insertIndent).doc).toBe('```\nco\tde\n```\n')
  })

  it('indents every selected line when text is selected', () => {
    const r = run('one\ntwo\nthree\n', { anchor: 1, head: 6 }, insertIndent)
    expect(r.doc).toBe('\tone\n\ttwo\nthree\n')
  })

  it('declines in a read-only view, so Tab is the browser\'s in Reading', () => {
    let current = makeState('plain\n', { at: 2, extensions: [...editor, EditorState.readOnly.of(true)] })
    const view = { get state() { return current }, dispatch: (s: TransactionSpec) => { current = current.update(s).state } }
    expect(insertIndent(view as unknown as EditorView)).toBe(false)
  })
})
