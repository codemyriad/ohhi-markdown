/**
 * The typing aids (Settings › Editor): spelling, autocorrect and sentence
 * capitalisation as the content element's attributes, set explicitly either
 * way, and changed through the compartment without rebuilding the state.
 * The attributes are read off the state's `contentAttributes` facet — what
 * CM6 writes onto the content element — so this runs in node; the DOM half
 * is `apps/web/src/lib/typing.test.ts`.
 */
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { TYPING_DEFAULTS, typingAttributes, typingCompartment, typingExtension } from '../src/typing.js'

/** The merged content attributes a state would put on the element. */
function attrs(state: EditorState): Record<string, string> {
  return Object.assign({}, ...state.facet(EditorView.contentAttributes).map((a) => (typeof a === 'function' ? {} : a)))
}

describe('typing aids', () => {
  it('are all on by default', () => {
    expect(TYPING_DEFAULTS).toEqual({ spellcheck: true, autocorrect: true, autocapitalize: true })
    expect(typingAttributes(TYPING_DEFAULTS)).toEqual({
      spellcheck: 'true',
      autocorrect: 'on',
      autocapitalize: 'sentences',
    })
  })

  it('say "off" explicitly when off, never leaving it to a default', () => {
    expect(typingAttributes({ spellcheck: false, autocorrect: false, autocapitalize: false })).toEqual({
      spellcheck: 'false',
      autocorrect: 'off',
      autocapitalize: 'off',
    })
  })

  it('toggle in place through the compartment', () => {
    const state = EditorState.create({ extensions: [typingCompartment.of(typingExtension(TYPING_DEFAULTS))] })
    expect(attrs(state)).toMatchObject({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences' })
    const next = state.update({
      effects: typingCompartment.reconfigure(
        typingExtension({ spellcheck: false, autocorrect: true, autocapitalize: false })
      ),
    }).state
    expect(attrs(next)).toMatchObject({ spellcheck: 'false', autocorrect: 'on', autocapitalize: 'off' })
  })
})
