/**
 * The agent's working highlight (writing-harness B10): the field draws the
 * ranges it is sent, follows edits between sends, and a host keeps it current.
 */
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { setWorking, workingField, workingHighlight, workingRanges, type WorkingHost } from '../src/working-highlight.js'

const TEXT = 'The plan is to ship in March.'

function marks(s: EditorState): [number, number, string][] {
  const out: [number, number, string][] = []
  s.field(workingField).marks.between(0, s.doc.length, (from, to, d) => {
    out.push([from, to, String(d.spec.class)])
  })
  return out
}

describe('working highlight', () => {
  it('shades each non-empty range with the agent working class; an insertion point draws nothing', () => {
    const s = EditorState.create({ doc: TEXT, extensions: workingHighlight() }).update({
      effects: setWorking.of([
        { from: 23, to: 28, name: 'Agent (agent)' },
        { from: 4, to: 8, name: 'Agent (agent)' },
        { from: 10, to: 10, name: 'Agent (agent)' },
      ]),
    }).state
    expect(marks(s)).toEqual([
      [4, 8, 'ed-agent-working'],
      [23, 28, 'ed-agent-working'],
    ])
  })

  it('follows edits between sends: an insert at an edge lands outside', () => {
    let s = EditorState.create({ doc: TEXT, extensions: workingHighlight() }).update({
      effects: setWorking.of([{ from: 4, to: 8, name: 'A' }]),
    }).state
    s = s.update({ changes: { from: 0, insert: '>> ' } }).state
    expect(workingRanges(s)).toEqual([{ from: 7, to: 11, name: 'A' }])
    s = s.update({ changes: { from: 11, insert: '!' } }).state
    expect(workingRanges(s)).toEqual([{ from: 7, to: 11, name: 'A' }])
  })

  it('clamps to the document, orders and normalises reversed ranges; a new send replaces the old', () => {
    let s = EditorState.create({ doc: 'abc', extensions: workingHighlight() }).update({
      effects: setWorking.of([{ from: 2, to: 99, name: 'A' }, { from: 1, to: 0, name: 'B' }]),
    }).state
    expect(workingRanges(s)).toEqual([
      { from: 0, to: 1, name: 'B' },
      { from: 2, to: 3, name: 'A' },
    ])
    s = s.update({ effects: setWorking.of([]) }).state
    expect(marks(s)).toEqual([])
  })

  it('accepts a host (the shell’s awareness adapter) without a view', () => {
    const host: WorkingHost = { current: () => [], subscribe: () => () => {} }
    const s = EditorState.create({ doc: TEXT, extensions: workingHighlight(host) })
    expect(workingRanges(s)).toEqual([])
  })
})
