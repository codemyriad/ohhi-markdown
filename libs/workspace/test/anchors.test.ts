/**
 * `anchors.ts`: a range pinned by a relative-position pair follows every edit
 * around it, keeps inserts at its edges outside, survives JSON, and answers
 * null — never a wrong range — when it cannot be resolved.
 */
import { createYjsEngine } from '@ohhi/sync'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { decodeRange, encodeRange, ytextOf } from '../src/index.js'

function textDoc(text: string): { doc: Y.Doc; ytext: Y.Text } {
  const doc = new Y.Doc()
  const ytext = ytextOf(doc)
  ytext.insert(0, text)
  return { doc, ytext }
}

const slice = (ytext: Y.Text, r: { from: number; to: number } | null): string | null =>
  r ? ytext.toString().slice(r.from, r.to) : null

describe('encodeRange / decodeRange', () => {
  it('round-trips through JSON and follows edits before and after the range', () => {
    const { doc, ytext } = textDoc('alpha beta gamma')
    const pair = JSON.parse(JSON.stringify(encodeRange(ytext, 6, 10))) as [unknown, unknown]
    expect(slice(ytext, decodeRange(doc, pair))).toBe('beta')
    ytext.insert(0, '>> ')
    ytext.insert(ytext.length, ' <<')
    expect(decodeRange(doc, pair)).toEqual({ from: 9, to: 13 })
    expect(slice(ytext, decodeRange(doc, pair))).toBe('beta')
  })

  it('keeps an insert AT either edge outside the range, and one inside it in', () => {
    const { doc, ytext } = textDoc('alpha beta gamma')
    const pair = encodeRange(ytext, 6, 10)
    ytext.insert(6, '[')
    ytext.insert(11, ']')
    expect(slice(ytext, decodeRange(doc, pair))).toBe('beta')
    ytext.insert(9, 'X')
    expect(slice(ytext, decodeRange(doc, pair))).toBe('beXta')
  })

  it('an empty range (an insertion point) never crosses itself', () => {
    const { doc, ytext } = textDoc('ab')
    const pair = encodeRange(ytext, 1, 1)
    ytext.insert(1, 'zz')
    expect(decodeRange(doc, pair)).toEqual({ from: 3, to: 3 })
    const end = encodeRange(ytext, ytext.length, ytext.length)
    ytext.insert(ytext.length, '!')
    expect(decodeRange(doc, end)).toEqual({ from: ytext.length, to: ytext.length })
  })

  it('collapses to where the text was when the range is deleted, and clamps offsets', () => {
    const { doc, ytext } = textDoc('alpha beta gamma')
    const pair = encodeRange(ytext, 6, 10)
    ytext.delete(4, 8)
    expect(decodeRange(doc, pair)).toEqual({ from: 4, to: 4 })
    expect(decodeRange(doc, encodeRange(ytext, -5, 999))).toEqual({ from: 0, to: ytext.length })
  })

  it('resolves on another replica, and is null for content that replica has not seen', () => {
    const a = textDoc('one two three')
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc))
    const pair = encodeRange(a.ytext, 4, 7)
    expect(slice(ytextOf(b), decodeRange(b, pair))).toBe('two')
    a.ytext.insert(4, 'NEW ')
    const later = encodeRange(a.ytext, 4, 7)
    expect(decodeRange(new Y.Doc(), later)).toBeNull()
  })

  it('is null for a malformed pair, never a throw', () => {
    const { doc } = textDoc('x')
    expect(decodeRange(doc, [null, null])).toBeNull()
    expect(decodeRange(doc, [{ item: 'nope' }, 3])).toBeNull()
  })

  it('accepts an engine doc as well as a Y.Doc', () => {
    const engine = createYjsEngine()
    const doc = engine.createDoc('g')
    doc.transact((t) => t.insert(0, 'hello world'), 'local')
    const pair = encodeRange(ytextOf(doc), 6, 11)
    expect(decodeRange(doc, pair)).toEqual({ from: 6, to: 11 })
  })
})
