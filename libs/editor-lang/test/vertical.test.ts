/**
 * ArrowUp / ArrowDown next to a line a block widget draws. CM6's vertical
 * motion steps over block widgets, so the arrow used to land past a fence
 * edge, a callout title, a picture's line, or — from the first line of a
 * note's body — all the way up to line 1 over the frontmatter. These cases
 * hand `blockLineStep` the head CM6's own move gives in a browser (measured
 * with Playwright in chromium and webkit) and assert where the caret goes
 * instead. The key in a real editor is in apps/web/e2e/editing.spec.ts.
 */
import { EditorSelection, type EditorState, type SelectionRange, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { blockDrawsLine, blockLineDown, blockLineStep, blockLineUp } from '../src/preview/vertical.js'
import { makeState } from './support.js'

const lineStart = (doc: string, n: number): number => doc.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0)

describe('blockLineStep: one line, even when a block widget draws it', () => {
  it('ArrowUp from the first body line lands on the frontmatter’s last line, not line 1', () => {
    const doc = '---\ntags: [a]\nstatus: draft\nowner: someone\n---\nbody text'
    const at = doc.indexOf('body') + 3
    const state = makeState(doc, { at })
    expect(blockDrawsLine(state, 5)).toBe(true)
    // CM6 skips the strip and, with nothing above it, lands at the very start.
    const to = blockLineStep(state, at, 0, -1)
    expect(to).toBe(lineStart(doc, 5) + 3)
    expect(state.doc.lineAt(to!).number).toBe(5)
  })

  it('ArrowUp from below a code fence lands on its closing line; ArrowDown from above, on its opening line', () => {
    const doc = 'intro\n```js\nlet x = 1\n```\nafter'
    const below = makeState(doc, { at: doc.indexOf('after') + 2 })
    // CM6's move skips the cap and lands in the code.
    const up = blockLineStep(below, doc.indexOf('after') + 2, doc.indexOf('let') + 2, -1)
    expect(below.doc.lineAt(up!).number).toBe(4)
    const above = makeState(doc, { at: 2 })
    const down = blockLineStep(above, 2, doc.indexOf('let') + 2, 1)
    expect(above.doc.lineAt(down!).number).toBe(2)
    expect(down).toBe(lineStart(doc, 2) + 2)
  })

  it('ArrowUp from a callout’s body lands on its title', () => {
    const doc = 'before\n\n> [!tip] A title\n> the body'
    const at = doc.indexOf('the body') + 4
    const state = makeState(doc, { at })
    expect(blockDrawsLine(state, 3)).toBe(true)
    const to = blockLineStep(state, at, lineStart(doc, 2), -1)
    expect(state.doc.lineAt(to!).number).toBe(3)
  })

  it('ArrowUp from below a picture on its own line lands on the picture’s line', () => {
    const doc = 'top\n![[shot.png]]\nbelow it'
    const state = makeState(doc, { at: doc.length })
    const to = blockLineStep(state, doc.length, 1, -1)
    expect(state.doc.lineAt(to!).number).toBe(2)
    // The column is clamped to the shorter line.
    expect(to).toBe(lineStart(doc, 2) + Math.min('below it'.length, '![[shot.png]]'.length))
  })

  it('leaves CM6’s move alone inside a wrapped line, onto the next line, and next to plain text', () => {
    const doc = 'intro\n```js\nlet x = 1\n```\nafter\nlast'
    const state = makeState(doc, { at: doc.indexOf('last') })
    const at = doc.indexOf('last')
    // A wrapped line: the move stays on the caret's line.
    expect(blockLineStep(state, at + 3, at + 1, -1)).toBe(null)
    // The next line up is plain text: CM6 lands on it.
    expect(blockLineStep(state, at, doc.indexOf('after'), -1)).toBe(null)
    // Plain text above even if CM6 jumped further (nothing a widget hides).
    expect(blockLineStep(state, at, doc.indexOf('let'), -1)).toBe(null)
  })

  it('does nothing in Source, where no line is a widget', () => {
    const doc = 'intro\n```js\nlet x = 1\n```\nafter'
    const at = doc.indexOf('after')
    const state = makeState(doc, { at, mode: 'source' })
    expect(blockDrawsLine(state, 4)).toBe(false)
    expect(blockLineStep(state, at, doc.indexOf('let'), -1)).toBe(null)
  })
})

/**
 * A stand-in for the view the commands need: its `moveVertically` is CM6's in
 * miniature (one column per pixel, the goal column carried on the range, block
 * widget lines stepped over), and `dispatch` applies the spec to the state.
 */
function fakeView(start: EditorState) {
  let state = start
  const moveVertically = (range: SelectionRange, forward: boolean): SelectionRange => {
    const line = state.doc.lineAt(range.head)
    const goal = range.goalColumn ?? range.head - line.from
    let n = line.number + (forward ? 1 : -1)
    while (n >= 1 && n <= state.doc.lines && blockDrawsLine(state, n)) n += forward ? 1 : -1
    if (n < 1) return EditorSelection.cursor(0, 0, undefined, goal)
    if (n > state.doc.lines) return EditorSelection.cursor(state.doc.length, 0, undefined, goal)
    const target = state.doc.line(n)
    return EditorSelection.cursor(target.from + Math.min(goal, target.length), 0, undefined, goal)
  }
  const view = {
    get state() {
      return state
    },
    moveVertically,
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state
    },
  }
  /** The key: the widget-line step first, CM6's own move when it declines. */
  const press = (dir: 'up' | 'down'): void => {
    const ran = (dir === 'up' ? blockLineUp : blockLineDown)(view as unknown as EditorView)
    if (!ran) {
      const moved = moveVertically(state.selection.main, dir === 'down')
      state = state.update({ selection: EditorSelection.create([moved]) }).state
    }
  }
  const caret = (): { line: number; col: number } => {
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    return { line: line.number, col: head - line.from }
  }
  return { press, caret }
}

describe('the goal column across a widget line', () => {
  it('ArrowUp over a fence’s closing edge returns to the starting column on the lines above', () => {
    const doc = 'a long first line\n```js\nlet value = 12345\n```\nthe line after it'
    const at = doc.indexOf('the line after') + 10
    const { press, caret } = fakeView(makeState(doc, { at }))
    press('up')
    // Onto the fence's three backticks, clamped.
    expect(caret()).toEqual({ line: 4, col: 3 })
    press('up')
    expect(caret()).toEqual({ line: 3, col: 10 })
  })

  it('ArrowDown over a fence’s opening edge returns to the starting column on the lines below', () => {
    const doc = 'a long first line\n```\nlet value = 12345\n```\nthe line after it'
    const { press, caret } = fakeView(makeState(doc, { at: 12 }))
    press('down')
    expect(caret()).toEqual({ line: 2, col: 3 })
    press('down')
    expect(caret()).toEqual({ line: 3, col: 12 })
  })
})
