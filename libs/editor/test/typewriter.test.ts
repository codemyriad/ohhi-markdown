/**
 * Typewriter scrolling (quiet-shell Decision 5): the decision is pure, so it
 * is tested over the transaction's shape — and once over a real CM6 state, so
 * the extender is known to add the effect to the transactions it should.
 */
import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { centreTarget, typewriterExtension, type TypewriterInput } from '../src/typewriter.js'

const tr = (over: Partial<TypewriterInput>): TypewriterInput => ({
  docChanged: false,
  selectionSet: false,
  userEvent: undefined,
  head: 7,
  ...over,
})

describe('centreTarget', () => {
  it('centres on the head when this person types, deletes or pastes', () => {
    expect(centreTarget(tr({ docChanged: true, userEvent: 'input.type' }))).toBe(7)
    expect(centreTarget(tr({ docChanged: true, userEvent: 'input.type.compose' }))).toBe(7)
    expect(centreTarget(tr({ docChanged: true, userEvent: 'input.paste' }))).toBe(7)
    expect(centreTarget(tr({ docChanged: true, userEvent: 'delete.backward' }))).toBe(7)
    expect(centreTarget(tr({ docChanged: true, userEvent: 'input.format' }))).toBe(7)
  })

  it('follows a caret moved by key, and undo / redo', () => {
    expect(centreTarget(tr({ selectionSet: true, userEvent: 'select' }))).toBe(7)
    expect(centreTarget(tr({ selectionSet: true, userEvent: 'move.line' }))).toBe(7)
    expect(centreTarget(tr({ docChanged: true, userEvent: 'undo' }))).toBe(7)
    expect(centreTarget(tr({ docChanged: true, userEvent: 'redo' }))).toBe(7)
  })

  it('leaves the page alone for a click, a peer, or a transaction that changes nothing', () => {
    expect(centreTarget(tr({ selectionSet: true, userEvent: 'select.pointer' }))).toBeNull()
    // A peer's edit (y-sync) and a programmatic restore carry no user event.
    expect(centreTarget(tr({ docChanged: true }))).toBeNull()
    expect(centreTarget(tr({ selectionSet: true }))).toBeNull()
    expect(centreTarget(tr({ userEvent: 'input.type' }))).toBeNull()
  })

  it('does not mistake a family prefix for a family', () => {
    expect(centreTarget(tr({ docChanged: true, userEvent: 'inputx' }))).toBeNull()
  })

  it('leaves the page alone for an edit made from the properties form (collections DB4)', () => {
    // The form's commit is a document change with the caret elsewhere; the
    // person is in the form, so the caret line must not scroll into view.
    expect(centreTarget(tr({ docChanged: true, userEvent: 'edit.properties' }))).toBeNull()
  })
})

describe('typewriterExtension', () => {
  const centreEffects = (on: boolean, spec: TransactionSpec): number => {
    const state = EditorState.create({ doc: 'one\ntwo\nthree', extensions: typewriterExtension(on) })
    // The only effect anything here adds is the extender's scroll.
    return state.update(spec).effects.length
  }

  it('adds one centre effect to a typed transaction when on, none when off', () => {
    const typed = { changes: { from: 3, insert: '!' }, userEvent: 'input.type' }
    expect(centreEffects(true, typed)).toBe(1)
    expect(centreEffects(false, typed)).toBe(0)
  })

  it('adds none to a remote change', () => {
    expect(centreEffects(true, { changes: { from: 0, insert: 'x' } })).toBe(0)
  })
})
