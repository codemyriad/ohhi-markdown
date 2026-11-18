/**
 * The platform's typing aids on the editing surface: spell checking,
 * autocorrect and sentence capitalisation. CM6 turns all three off on its
 * content element by default; the host chooses (Settings › Editor, device
 * config) and changes them through `typingCompartment`, so a change reaches
 * an open note without recreating its view.
 *
 * Each maps to one content attribute — `spellcheck`, `autocorrect` (Safari
 * and the mobile keyboards) and `autocapitalize` (virtual keyboards) — set
 * explicitly either way, so a "no" is a no and never CM6's or the browser's
 * default.
 */
import { Compartment, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export interface TypingAids {
  spellcheck: boolean
  autocorrect: boolean
  /** Capitalise the first letter of a sentence (`autocapitalize="sentences"`). */
  autocapitalize: boolean
}

/** All three on: how a text field behaves everywhere else on the device. */
export const TYPING_DEFAULTS: TypingAids = { spellcheck: true, autocorrect: true, autocapitalize: true }

export const typingCompartment = new Compartment()

/** The content attributes for a choice of aids. */
export function typingAttributes(aids: TypingAids): Record<string, string> {
  return {
    spellcheck: aids.spellcheck ? 'true' : 'false',
    autocorrect: aids.autocorrect ? 'on' : 'off',
    autocapitalize: aids.autocapitalize ? 'sentences' : 'off',
  }
}

export function typingExtension(aids: TypingAids): Extension {
  return EditorView.contentAttributes.of(typingAttributes(aids))
}

export const sameTypingAids = (a: TypingAids, b: TypingAids): boolean =>
  a.spellcheck === b.spellcheck && a.autocorrect === b.autocorrect && a.autocapitalize === b.autocapitalize
