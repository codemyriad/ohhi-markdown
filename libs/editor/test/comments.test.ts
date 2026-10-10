/**
 * The comment marks (writing-harness B8): the field draws what the host
 * sends, follows edits between sends, and marks one thread active.
 */
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  activeThread,
  commentRanges,
  commentsExtension,
  commentsField,
  setActiveThread,
  hasCommentGutter,
  setThreads,
  threadAt,
} from '../src/comments.js'

const TEXT = 'The plan is to ship in March.'

function state() {
  return EditorState.create({ doc: TEXT, extensions: commentsExtension() })
}

/** Every mark's [from, to, class]. */
function marks(s: EditorState): [number, number, string][] {
  const out: [number, number, string][] = []
  s.field(commentsField).marks.between(0, s.doc.length, (from, to, d) => {
    out.push([from, to, String(d.spec.class)])
  })
  return out
}

describe('comments extension', () => {
  it('draws an open and a resolved thread with their two classes', () => {
    const s = state().update({
      effects: setThreads.of([
        { id: 'b', from: 15, to: 19, resolved: true },
        { id: 'a', from: 4, to: 8, resolved: false },
      ]),
    }).state
    expect(marks(s)).toEqual([
      [4, 8, 'ed-comment'],
      [15, 19, 'ed-comment-resolved'],
    ])
    expect(commentRanges(s).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('maps the ranges through edits before, inside and after', () => {
    let s = state().update({ effects: setThreads.of([{ id: 'a', from: 4, to: 8, resolved: false }]) }).state
    s = s.update({ changes: { from: 0, insert: 'So. ' } }).state // before
    expect(commentRanges(s)[0]).toMatchObject({ from: 8, to: 12 })
    s = s.update({ changes: { from: 10, insert: '--' } }).state // inside
    expect(commentRanges(s)[0]).toMatchObject({ from: 8, to: 14 })
    s = s.update({ changes: { from: 14, insert: 'X' } }).state // at the end: outside
    s = s.update({ changes: { from: 8, insert: 'Y' } }).state // at the start: outside
    expect(commentRanges(s)[0]).toMatchObject({ from: 9, to: 15 })
    expect(s.doc.sliceString(9, 15)).toBe('pl--an')
  })

  it('draws the active thread stronger, and clears it', () => {
    let s = state().update({
      effects: [setThreads.of([{ id: 'a', from: 4, to: 8, resolved: false }]), setActiveThread.of('a')],
    }).state
    expect(activeThread(s)).toBe('a')
    expect(marks(s)[0][2]).toBe('ed-comment ed-comment-active')
    s = s.update({ effects: setActiveThread.of(null) }).state
    expect(marks(s)[0][2]).toBe('ed-comment')
  })

  it('clamps ranges past the end and draws no mark for a point comment', () => {
    const s = state().update({
      effects: setThreads.of([
        { id: 'p', from: 3, to: 3, resolved: false },
        { id: 'x', from: 20, to: 999, resolved: false },
      ]),
    }).state
    expect(commentRanges(s).find((r) => r.id === 'x')).toMatchObject({ from: 20, to: TEXT.length })
    expect(marks(s)).toEqual([[20, TEXT.length, 'ed-comment']])
  })

  it('finds the open thread under a position before a resolved one', () => {
    const s = state().update({
      effects: setThreads.of([
        { id: 'old', from: 0, to: 12, resolved: true },
        { id: 'new', from: 4, to: 8, resolved: false },
      ]),
    }).state
    expect(threadAt(s, 5)?.id).toBe('new')
    expect(threadAt(s, 1)?.id).toBe('old')
    expect(threadAt(s, 20)).toBeNull()
  })

  it('reads as empty in a state without the extension', () => {
    const bare = EditorState.create({ doc: TEXT })
    expect(commentRanges(bare)).toEqual([])
    expect(activeThread(bare)).toBeNull()
  })
})

describe('the comment gutter takes no room on a note without threads', () => {
  it('is installed with the first thread and removed with the last, in the same transaction', () => {
    let s = state()
    expect(hasCommentGutter(s)).toBe(false)
    s = s.update({ effects: setThreads.of([{ id: 'a', from: 4, to: 8, resolved: false }]) }).state
    expect(hasCommentGutter(s)).toBe(true)
    s = s.update({ effects: setThreads.of([{ id: 'a', from: 4, to: 8, resolved: true }]) }).state
    expect(hasCommentGutter(s)).toBe(true)
    s = s.update({ effects: setThreads.of([]) }).state
    expect(hasCommentGutter(s)).toBe(false)
    expect(commentRanges(s)).toEqual([])
  })
})
