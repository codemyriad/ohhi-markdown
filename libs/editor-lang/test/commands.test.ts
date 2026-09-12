/**
 * `Mod+L` and the checkbox click: one edit, one path. A toggle has to be a text
 * change like any other, or it does not reach the peer, the disk or the diff
 * (R2.3) — so these tests assert the document, never the widget.
 */
import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { toggleTask } from '../src/index.js'
import { toggleTaskAt } from '../src/preview/commands.js'
import { taskOnLine } from '../src/preview/tasks.js'
import { makeState } from './support.js'

/** What libs/editor's mode compartment installs for Reading. */
const readOnlyState = (doc: string): EditorState =>
  EditorState.create({ doc, extensions: [EditorState.readOnly.of(true)] })

/** Commands touch `view.state` and `view.dispatch` and nothing else. */
function fakeView(state: EditorState): { view: EditorView; text: () => string } {
  let current = state
  const view = {
    get state() {
      return current
    },
    dispatch: (spec: TransactionSpec) => {
      current = current.update(spec).state
    },
  }
  return { view: view as unknown as EditorView, text: () => current.doc.toString() }
}

describe('taskOnLine', () => {
  const state = makeState('- [ ] todo\n\t1. [x] done\n- plain\n* [X] upper\n')

  it('finds the state character of a task, whatever the list marker', () => {
    expect(taskOnLine(state.doc.line(1))).toEqual({ at: 3, done: false })
    expect(taskOnLine(state.doc.line(2))).toEqual({ at: 16, done: true })
    expect(taskOnLine(state.doc.line(4))).toEqual({ at: 35, done: true })
  })

  it('is null on a line that is not a task', () => {
    expect(taskOnLine(state.doc.line(3))).toBe(null)
    expect(taskOnLine(makeState('[ ] not in a list\n').doc.line(1))).toBe(null)
  })
})

describe('toggleTask', () => {
  it('flips the task on the caret’s line', () => {
    const { view, text } = fakeView(makeState('- [ ] todo\n', { at: 8 }))
    expect(toggleTask(view)).toBe(true)
    expect(text()).toBe('- [x] todo\n')
    expect(toggleTask(view)).toBe(true)
    expect(text()).toBe('- [ ] todo\n')
  })

  it('flips every task the selection touches, and leaves the rest alone', () => {
    const doc = '- [ ] one\n- plain\n- [x] two\n- [ ] three\n'
    const { view, text } = fakeView(makeState(doc, { at: { anchor: 2, head: 30 } }))
    expect(toggleTask(view)).toBe(true)
    expect(text()).toBe('- [x] one\n- plain\n- [ ] two\n- [x] three\n')
  })

  it('is false — so the key falls through — when there is no task', () => {
    const { view, text } = fakeView(makeState('just a paragraph\n', { at: 2 }))
    expect(toggleTask(view)).toBe(false)
    expect(text()).toBe('just a paragraph\n')
  })

  it('refuses on a read-only document — Reading edits through the checkbox, not the key', () => {
    const { view, text } = fakeView(readOnlyState('- [ ] todo\n'))
    expect(toggleTask(view)).toBe(false)
    expect(text()).toBe('- [ ] todo\n')
  })
})

describe('toggleTaskAt (the checkbox click)', () => {
  it('flips the task on the clicked line', () => {
    const { view, text } = fakeView(makeState('- [ ] one\n- [ ] two\n'))
    expect(toggleTaskAt(view, 12)).toBe(true)
    expect(text()).toBe('- [ ] one\n- [x] two\n')
  })

  it('is false when the click lands on a line with no task', () => {
    const { view } = fakeView(makeState('- plain\n'))
    expect(toggleTaskAt(view, 3)).toBe(false)
  })

  it('still edits a read-only document — Reading is about markers, not edits', () => {
    // EditorState.readOnly gates COMMANDS; a widget's own dispatch applies, so
    // a checkbox in Reading is still a checkbox (R2.3).
    const { view, text } = fakeView(readOnlyState('- [ ] todo\n'))
    expect(toggleTaskAt(view, 0)).toBe(true)
    expect(text()).toBe('- [x] todo\n')
  })
})
