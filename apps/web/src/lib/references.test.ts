import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { decodeRange, encodeRange } from '@ohhi/workspace'
import { captureSelection, linesOfRange, mentionLabel, mentionOf, rangeOfLines, resolveMention, sliceLines } from './references.js'

const NOTE = '# Plan\n\nalpha\nbeta\ngamma\n\n## Decisions\nship it\n'

describe('references', () => {
  it('labels every kind the way the chip shows it', () => {
    expect(mentionLabel({ kind: 'file', path: 'notes/plan.md' })).toBe('plan.md')
    expect(mentionLabel({ kind: 'folder', path: 'notes' })).toBe('notes/')
    expect(mentionLabel({ kind: 'section', path: 'notes/plan.md', section: 'Plan/Decisions' })).toBe('plan.md › Decisions')
    expect(mentionLabel({ kind: 'lines', path: 'plan.md', lines: { from: 12, to: 20 } })).toBe('plan.md (12–20)')
    expect(mentionLabel({ kind: 'lines', path: 'plan.md', lines: { from: 4, to: 4 } })).toBe('plan.md (4)')
  })

  it('slices whole lines, 1-based and clamped, as `ohhi read --lines`', () => {
    expect(sliceLines(NOTE, 3, 4)).toEqual({ text: 'alpha\nbeta\n', from: 3, to: 4 })
    expect(sliceLines(NOTE, 8, 99)).toEqual({ text: 'ship it\n', from: 8, to: 8 })
    // The agent's slice (`ohhi read --lines`) ends every line it returns with a newline.
    expect(sliceLines('no newline', 1, 1).text).toBe('no newline\n')
  })

  it('maps 1-based lines to their character range, the last terminator left out', () => {
    const r = rangeOfLines(NOTE, { from: 3, to: 4 })
    expect(NOTE.slice(r.from, r.to)).toBe('alpha\nbeta')
    expect(rangeOfLines('one', { from: 1, to: 9 })).toEqual({ from: 0, to: 3 })
  })

  it('a range ending at a line start does not take that line', () => {
    const from = NOTE.indexOf('alpha')
    const to = NOTE.indexOf('gamma') // the caret sits at gamma's start
    expect(linesOfRange(NOTE, from, to)).toEqual({ from: 3, to: 4 })
    expect(linesOfRange(NOTE, to, from)).toEqual({ from: 3, to: 4 })
  })

  it('captures a selection as a lines mention with the snapshot and the hash', () => {
    const from = NOTE.indexOf('pha')
    const to = NOTE.indexOf('beta') + 2
    const m = captureSelection({ path: 'notes/plan.md', text: NOTE, from, to, hash: 'h1' })
    expect(m.ref).toEqual({ kind: 'lines', path: 'notes/plan.md', lines: { from: 3, to: 4 } })
    expect(m.label).toBe('plan.md (3–4)')
    expect(m.snapshot).toBe('alpha\nbeta\n')
    expect(m.hash).toBe('h1')
    expect(m.anchor).toBeUndefined() // no pair given: a tracked note
    const anchored = captureSelection({ path: 'p.md', text: NOTE, from, to, anchor: [{ a: 1 }, { b: 2 }] })
    expect(anchored.anchor).toEqual({ yjs: [{ a: 1 }, { b: 2 }] })
  })

  it('resolves unchanged lines as unchanged', () => {
    const m = captureSelection({ path: 'p.md', text: NOTE, from: NOTE.indexOf('alpha'), to: NOTE.indexOf('beta') + 4 })
    const r = resolveMention(m, NOTE)
    expect(r).toEqual({ mention: m, text: 'alpha\nbeta\n', changed: false })
  })

  it('flags a lines mention whose text moved under it, and still carries the snapshot', () => {
    const m = captureSelection({ path: 'p.md', text: NOTE, from: NOTE.indexOf('alpha'), to: NOTE.indexOf('beta') + 4 })
    const edited = NOTE.replace('# Plan\n', '# Plan\nnew first line\n')
    const r = resolveMention(m, edited)
    expect(r.changed).toBe(true)
    expect(r.text).toBe('\nalpha\n')
    expect(r.mention.snapshot).toBe('alpha\nbeta\n')
  })

  it('re-pins to a decoded anchor range when one is given', () => {
    const m = captureSelection({ path: 'p.md', text: NOTE, from: NOTE.indexOf('alpha'), to: NOTE.indexOf('beta') + 4 })
    const edited = NOTE.replace('# Plan\n', '# Plan\nnew first line\n')
    const from = edited.indexOf('alpha')
    const r = resolveMention(m, edited, { anchorRange: { from, to: edited.indexOf('beta') + 4 } })
    expect(r.changed).toBe(false)
    expect(r.mention.ref).toEqual({ kind: 'lines', path: 'p.md', lines: { from: 4, to: 5 } })
    expect(r.mention.label).toBe('p.md (4–5)')
  })

  it('a deleted note is changed when there was a snapshot', () => {
    const m = captureSelection({ path: 'p.md', text: NOTE, from: 0, to: 3 })
    expect(resolveMention(m, null)).toMatchObject({ text: null, changed: true })
  })

  it('lazy kinds compare hashes only', () => {
    const m = mentionOf({ kind: 'file', path: 'p.md' }, 'h1')
    expect(resolveMention(m, NOTE, { currentHash: 'h1' }).changed).toBe(false)
    expect(resolveMention(m, NOTE, { currentHash: 'h2' }).changed).toBe(true)
    expect(resolveMention(mentionOf({ kind: 'folder', path: 'notes' }), null).changed).toBe(false)
  })

  it('an anchored mention follows its text through an edit above it (the workspace anchors)', () => {
    const doc = new Y.Doc()
    const ytext = doc.getText('content')
    ytext.insert(0, NOTE)
    const from = NOTE.indexOf('alpha')
    const to = NOTE.indexOf('beta') + 4
    const m = captureSelection({ path: 'p.md', text: NOTE, from, to, anchor: encodeRange(ytext, from, to) })
    ytext.insert(0, 'a new first line\n')
    const range = decodeRange(doc, m.anchor!.yjs!)
    const r = resolveMention(m, ytext.toString(), { anchorRange: range })
    expect(r.changed).toBe(false)
    expect(r.mention.label).toBe('p.md (4–5)')
    expect(r.text).toBe('alpha\nbeta\n')
  })
})
