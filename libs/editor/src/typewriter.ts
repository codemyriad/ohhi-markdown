/**
 * Typewriter scrolling (quiet-shell Decision 5, F1 `editor.typewriter`): while
 * you type, the caret's line stays vertically centred — Typora's F9. Off by
 * default; the layout spec turns it on, and the host toggles it through
 * `typewriterCompartment` so the view is never recreated.
 *
 * The mechanism is a transaction extender, not a second dispatch: a
 * transaction this person made (typing, deleting, moving the caret by key,
 * undo) gains a `scrollIntoView(head, { y: 'center' })` effect, which the
 * view applies after — and in place of — the transaction's own "nearest"
 * scroll. A peer's edit arrives with no user event and never moves the page;
 * a click that places the caret is not typing and does not either.
 *
 * The decision is `centreTarget`, a pure function over the transaction's
 * shape, so it is unit-tested without a DOM.
 */
import { Compartment, EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/** What `centreTarget` reads off a transaction — a structural slice, so a test can hand it a plain object. */
export interface TypewriterInput {
  docChanged: boolean
  /** True when the transaction sets a selection explicitly. */
  selectionSet: boolean
  /** The transaction's `userEvent` annotation (`input.type`, `select.pointer`, …), if any. */
  userEvent: string | undefined
  /** The main selection's head AFTER the transaction. */
  head: number
}

/**
 * The user-event families that count as "typing" for the caret to follow.
 * An edit made from a widget — the properties form's `edit.properties` —
 * is in none of them: the person is in the form, not at the caret.
 */
const FOLLOWS = ['input', 'delete', 'move', 'select', 'undo', 'redo'] as const

/** `input.type.compose` belongs to `input`, as CM6's own `isUserEvent` reads it. */
const inFamily = (event: string, family: string): boolean =>
  event === family || event.startsWith(`${family}.`)

/**
 * Where to centre, or null to leave the scroll alone. Centres on the head of
 * the main selection when this person changed the document or moved the
 * caret; never for a pointer selection (the reader is looking where they
 * clicked) and never for a transaction with no user event (a peer, the
 * reconciler, a programmatic restore).
 */
export function centreTarget(tr: TypewriterInput): number | null {
  if (!tr.docChanged && !tr.selectionSet) return null
  const event = tr.userEvent
  if (!event) return null
  if (inFamily(event, 'select.pointer')) return null
  return FOLLOWS.some((family) => inFamily(event, family)) ? tr.head : null
}

function inputOf(tr: Transaction): TypewriterInput {
  return {
    docChanged: tr.docChanged,
    selectionSet: tr.selection !== undefined,
    userEvent: tr.annotation(Transaction.userEvent),
    head: tr.newSelection.main.head,
  }
}

/**
 * Room below the last line, so the end of a note can sit in the middle of the
 * screen too. A theme module built ONCE (StyleModule dedupes by identity) and
 * scoped by CM6 to views that carry this extension.
 */
const typewriterTheme = EditorView.theme({
  '.cm-content': { paddingBottom: '50vh' },
})

/** The extension: centre the caret line on every typed transaction. */
export function typewriterScrolling(): Extension {
  return [
    typewriterTheme,
    EditorState.transactionExtender.of((tr) => {
      const head = centreTarget(inputOf(tr))
      return head === null ? null : { effects: EditorView.scrollIntoView(head, { y: 'center' }) }
    }),
  ]
}

/** Toggled by reconfigure (`MarkdownEditorHandle.setTypewriter`), never by rebuilding the view. */
export const typewriterCompartment = new Compartment()

/** What the compartment holds for `on`. */
export function typewriterExtension(on: boolean): Extension {
  return on ? typewriterScrolling() : []
}
