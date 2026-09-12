/**
 * The active-region rule (Spike S12). Pure, so it is tested exhaustively here
 * and the decoration tests can assume it.
 */
import { EditorSelection, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { activeLines } from '../src/index.js'
import { activeSpans, inActiveRegion, isRendered } from '../src/preview/active-lines.js'
import { makeState } from './support.js'

const doc = Text.of(['one', 'two', 'three', 'four'])
const lines = (sel: EditorSelection): number[] => [...activeLines(sel, doc)].sort((a, b) => a - b)

describe('activeLines', () => {
  it('is the caret’s line', () => {
    expect(lines(EditorSelection.single(0))).toEqual([1])
    expect(lines(EditorSelection.single(5))).toEqual([2])
  })

  it('counts a line the caret sits at either end of', () => {
    expect(lines(EditorSelection.single(3))).toEqual([1]) // end of "one"
    expect(lines(EditorSelection.single(4))).toEqual([2]) // start of "two"
  })

  it('is every line a range touches, including both ends', () => {
    expect(lines(EditorSelection.single(2, 9))).toEqual([1, 2, 3])
  })

  it('unions multiple ranges without duplicating', () => {
    const sel = EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(15)])
    expect(lines(sel)).toEqual([1, 4])
  })
})

describe('activeSpans', () => {
  it('gives the caret’s whole line as a range', () => {
    expect(activeSpans(EditorSelection.single(5), doc)).toEqual([{ from: 4, to: 7 }])
  })

  it('merges ranges that touch, so two carets on one line are one span', () => {
    const sel = EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(6)])
    expect(activeSpans(sel, doc)).toEqual([{ from: 4, to: 7 }])
  })

  it('merges adjacent lines into one span', () => {
    const sel = EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(5)])
    expect(activeSpans(sel, doc)).toEqual([{ from: 0, to: 7 }])
  })

  it('keeps distant ranges apart', () => {
    const sel = EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(15)])
    expect(activeSpans(sel, doc)).toEqual([
      { from: 0, to: 3 },
      { from: 14, to: 18 },
    ])
  })
})

describe('inActiveRegion', () => {
  const spans = [{ from: 4, to: 7 }]

  it('is true for anything overlapping, including at the edges', () => {
    expect(inActiveRegion(spans, 4, 5)).toBe(true)
    expect(inActiveRegion(spans, 0, 4)).toBe(true)
    expect(inActiveRegion(spans, 7, 9)).toBe(true)
    expect(inActiveRegion(spans, 0, 16)).toBe(true)
  })

  it('is false for anything clear of it', () => {
    expect(inActiveRegion(spans, 0, 3)).toBe(false)
    expect(inActiveRegion(spans, 8, 12)).toBe(false)
    expect(inActiveRegion([], 0, 3)).toBe(false)
  })
})

describe('isRendered', () => {
  const note = '# One\n\nsome **bold** text\n'

  it('is false everywhere in Source', () => {
    expect(isRendered(makeState(note, { mode: 'source', at: 0 }), 14, 22)).toBe(false)
  })

  it('is true everywhere in Reading, caret or no caret', () => {
    expect(isRendered(makeState(note, { mode: 'reading', at: 16 }), 14, 22)).toBe(true)
  })

  it('in Live, follows the active region', () => {
    expect(isRendered(makeState(note, { at: 0 }), 14, 22)).toBe(true)
    expect(isRendered(makeState(note, { at: 16 }), 14, 22)).toBe(false)
  })
})
