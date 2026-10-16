/**
 * The selection bar's host (selection explorations SW1) over a bare
 * EditorState, in node: when the bar may show, what takes it down, and the
 * settle rule on a fake scheduler. Where it sits needs a layout, so the
 * e2e (`apps/web/e2e/editing.spec.ts`) measures that.
 */
import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  barEligible,
  handlePlacement,
  createSettle,
  isTyping,
  selectionBar,
  selectionBarField,
  selectionBarForm,
  setSuggestions,
  showSelectionBar,
  suggestions,
  type EditorSuggestion,
  type Schedule,
  type SuggestionsHost,
} from '../src/index.js'

const DOC = 'alpha beta gamma\nsecond line here'

const noHost: SuggestionsHost = { current: () => [], subscribe: () => () => {}, accept: () => {}, reject: () => {} }

function state(selection = EditorSelection.single(0, 5)): EditorState {
  return EditorState.create({
    doc: DOC,
    selection,
    extensions: [suggestions(noHost), selectionBar({ host: { mount: () => ({}) } })],
  })
}

const apply = (s: EditorState, spec: TransactionSpec): EditorState => s.update(spec).state
const shown = (s: EditorState): EditorState => apply(s, { effects: showSelectionBar.of('fine') })

const sug = (from: number, to: number): EditorSuggestion => ({
  id: 's1',
  from,
  to,
  baseText: DOC.slice(from, to),
  proposedText: 'X',
  status: 'pending',
  name: 'Tighten',
})

/** A scheduler the test advances by hand. */
function fakeSchedule() {
  let now = 0
  let jobs: { at: number; fn: () => void; id: number }[] = []
  let next = 0
  const schedule: Schedule = (fn, ms) => {
    const id = next++
    jobs.push({ at: now + ms, fn, id })
    return () => void (jobs = jobs.filter((j) => j.id !== id))
  }
  const advance = (ms: number): void => {
    now += ms
    const due = jobs.filter((j) => j.at <= now)
    jobs = jobs.filter((j) => j.at > now)
    for (const j of due) j.fn()
  }
  return { schedule, advance, get size() { return jobs.length } }
}

describe('when a bar may show', () => {
  it('shows for one non-empty range, in the form asked for', () => {
    expect(barEligible(state())).toBe(true)
    expect(selectionBarForm(shown(state()))).toBe('fine')
    expect(selectionBarForm(apply(state(), { effects: showSelectionBar.of('coarse') }))).toBe('coarse')
  })

  it('never for a bare caret or several ranges', () => {
    const caret = state(EditorSelection.single(3))
    expect(barEligible(caret)).toBe(false)
    expect(selectionBarForm(shown(caret))).toBeNull()
    const multi = EditorState.create({
      doc: DOC,
      selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(6, 10)]),
      extensions: [EditorState.allowMultipleSelections.of(true), suggestions(noHost), selectionBar({ host: { mount: () => ({}) } })],
    })
    expect(barEligible(multi)).toBe(false)
    expect(selectionBarForm(shown(multi))).toBeNull()
  })

  it('never while the selection overlaps a proposal (its own pair is the only control there)', () => {
    const s = apply(state(EditorSelection.single(6, 10)), { effects: setSuggestions.of([sug(8, 14)]) })
    expect(barEligible(s)).toBe(false)
    expect(selectionBarForm(shown(s))).toBeNull()
    // Touching its edge from outside is not inside it.
    const beside = apply(state(EditorSelection.single(0, 6)), { effects: setSuggestions.of([sug(6, 10)]) })
    expect(barEligible(beside)).toBe(true)
  })

  it('a proposal arriving under a shown bar takes it down', () => {
    const s = shown(state(EditorSelection.single(6, 10)))
    expect(selectionBarForm(s)).toBe('fine')
    expect(selectionBarForm(apply(s, { effects: setSuggestions.of([sug(6, 10)]) }))).toBeNull()
  })
})

describe('what takes it down', () => {
  it('typing over the selection', () => {
    const s = shown(state())
    const typed = apply(s, { changes: { from: 0, to: 5, insert: 'x' }, userEvent: 'input.type' })
    expect(selectionBarForm(typed)).toBeNull()
  })

  it('deleting, pasting, undoing — every edit the person makes', () => {
    for (const userEvent of ['delete.backward', 'input.paste', 'undo', 'redo', 'move.drop']) {
      const s = shown(state())
      const tr = s.update({ changes: { from: 0, to: 1 }, selection: EditorSelection.single(0, 4), userEvent })
      expect(isTyping(tr)).toBe(true)
      expect(selectionBarForm(tr.state)).toBeNull()
    }
  })

  it('a format command keeps it up, moved with the text (a Bold run while it is up)', () => {
    const s = shown(state())
    const bold = apply(s, {
      changes: [
        { from: 0, insert: '**' },
        { from: 5, insert: '**' },
      ],
      selection: EditorSelection.single(2, 7),
      userEvent: 'input.format',
    })
    expect(selectionBarForm(bold)).toBe('fine')
  })

  it('a peer’s edit elsewhere keeps it up', () => {
    const s = shown(state())
    const remote = apply(s, { changes: { from: DOC.length, insert: '!' } })
    expect(selectionBarForm(remote)).toBe('fine')
  })

  it('a selection change alone (to settle again), and an empty selection', () => {
    const s = shown(state())
    expect(selectionBarForm(apply(s, { selection: EditorSelection.single(0, 8), userEvent: 'select' }))).toBeNull()
    expect(selectionBarForm(apply(s, { selection: EditorSelection.single(2) }))).toBeNull()
  })

  it('the hide effect (Escape)', () => {
    expect(selectionBarForm(apply(shown(state()), { effects: showSelectionBar.of(null) }))).toBeNull()
  })

  it('keeps the same value while it stays up, so CodeMirror keeps its DOM', () => {
    const s = shown(state())
    const again = apply(s, { effects: showSelectionBar.of('fine') })
    const after = apply(again, { changes: { from: DOC.length, insert: '!' } })
    expect(again.field(selectionBarField)).toBe(s.field(selectionBarField))
    expect(after.field(selectionBarField)).toBe(s.field(selectionBarField))
  })
})

describe('the settle rule', () => {
  it('shows once the selection has stayed put for the delay', () => {
    const clock = fakeSchedule()
    let shows = 0
    const settle = createSettle(clock.schedule, 250, () => shows++)
    settle.changed(state())
    clock.advance(200)
    expect(shows).toBe(0)
    // Another change restarts the wait.
    settle.changed(state(EditorSelection.single(0, 8)))
    clock.advance(200)
    expect(shows).toBe(0)
    clock.advance(50)
    expect(shows).toBe(1)
  })

  it('never while a pointer button is down (a drag); the release starts the wait', () => {
    const clock = fakeSchedule()
    let shows = 0
    const settle = createSettle(clock.schedule, 250, () => shows++)
    settle.pointer(true, state())
    settle.changed(state(EditorSelection.single(0, 3)))
    settle.changed(state(EditorSelection.single(0, 9)))
    clock.advance(1000)
    expect(shows).toBe(0)
    expect(settle.pending).toBe(false)
    settle.pointer(false, state(EditorSelection.single(0, 9)))
    expect(settle.pending).toBe(true)
    clock.advance(250)
    expect(shows).toBe(1)
  })

  it('a press while waiting cancels the wait', () => {
    const clock = fakeSchedule()
    let shows = 0
    const settle = createSettle(clock.schedule, 250, () => shows++)
    settle.changed(state())
    settle.pointer(true, state())
    clock.advance(500)
    expect(shows).toBe(0)
  })

  it('no wait for a selection that cannot have a bar', () => {
    const clock = fakeSchedule()
    let shows = 0
    const settle = createSettle(clock.schedule, 250, () => shows++)
    settle.changed(state(EditorSelection.single(4)))
    expect(settle.pending).toBe(false)
    settle.pointer(false, state(EditorSelection.single(4)))
    clock.advance(500)
    expect(shows).toBe(0)
    expect(clock.size).toBe(0)
  })

  it('cancel stops a pending show', () => {
    const clock = fakeSchedule()
    let shows = 0
    const settle = createSettle(clock.schedule, 250, () => shows++)
    settle.changed(state())
    settle.cancel()
    clock.advance(500)
    expect(shows).toBe(0)
  })
})

describe('where the handle sits (handlePlacement)', () => {
  // A line 20px tall, its selection ending at x=300; the handle 120×24; room to 800.
  const end = { left: 300, right: 300, top: 100, bottom: 120 }
  const size = { width: 120, height: 24 }
  const wide = { left: 0, right: 800 }
  const narrow = { left: 0, right: 350 }
  const overlaps = (at: { left: number; top: number }, box: { left: number; right: number; top: number; bottom: number }) =>
    at.left < box.right && box.left < at.left + size.width && at.top < box.bottom && box.top < at.top + size.height
  /** The selected text on the end line: everything left of the end. */
  const selected = { left: 0, right: 300, top: 100, bottom: 120 }

  it('a mouse: beside the end, centred on its line, when the line has room', () => {
    const at = handlePlacement(end, size, wide, 'fine')
    expect(at.left).toBeGreaterThan(end.right)
    expect(at.top + size.height / 2).toBe(110)
    expect(overlaps(at, selected)).toBe(false)
  })

  it('a mouse, no room: just below the end line, never over the selection', () => {
    const at = handlePlacement(end, size, narrow, 'fine')
    expect(at.top).toBeGreaterThanOrEqual(end.bottom)
    expect(overlaps(at, selected)).toBe(false)
  })

  it('a finger: below the end line, clear of the OS end knob, never above the selection (the OS menu’s place)', () => {
    for (const bounds of [wide, narrow]) {
      const at = handlePlacement(end, size, bounds, 'coarse')
      expect(at.top).toBeGreaterThan(end.bottom)
      expect(overlaps(at, selected)).toBe(false)
      // The knob: ~12px around the end, just under the line.
      const knob = { left: end.right - 7, right: end.right + 7, top: end.bottom, bottom: end.bottom + 12 }
      expect(overlaps(at, knob)).toBe(false)
    }
  })
})
