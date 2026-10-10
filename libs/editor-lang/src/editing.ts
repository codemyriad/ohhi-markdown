/**
 * Typing aids for prose (E2): bracket pairs and wrap-the-selection.
 *
 * - `closeBrackets()` pairs `(`, `[`, `{` and `` ` `` — and NOT the quotes:
 *   in prose `'` is an apostrophe ("don't") and `"` opens dialogue far more
 *   often than it wants a twin. The set is markdown's language data at the
 *   LOWEST precedence, so a fenced language with its own pairs (JS's quotes)
 *   keeps them inside its fence. `[` twice is `[[|]]`, which is where the
 *   wikilink completion opens; accepting a target steps over the `]]`.
 * - With text selected, typing `*`, `_`, `=` or `~` wraps it instead of
 *   replacing it, and keeps the text selected — so `**` is bold, `==` a
 *   highlight, `~~` a strike, one keystroke a side. Not inside code, where a
 *   typed character replaces the selection as anywhere else.
 */
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { ancestorNamed } from './tree.js'

/** What `closeBrackets` pairs in a note (and in a fence with no language data). */
export const PROSE_BRACKETS: readonly string[] = ['(', '[', '{', '`']

/** The characters that wrap a selection instead of replacing it. */
export const WRAP_CHARS = '*_=~'

const CODE = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText'])

const inCode = (state: EditorState, pos: number): boolean => ancestorNamed(state, pos, CODE) !== null

/**
 * The transaction typing `ch` over the selection should be, when it wraps:
 * every non-empty range wrapped and still selected (inside the new marks),
 * every empty one given the character as typing would. Null when the
 * character does not wrap here — no range selected, a range in code, or not
 * a wrap character at all. Pure: a function of the state.
 */
export function wrapSelection(state: EditorState, ch: string) {
  if (ch.length !== 1 || !WRAP_CHARS.includes(ch)) return null
  const { ranges } = state.selection
  if (!ranges.some((r) => !r.empty)) return null
  if (ranges.some((r) => !r.empty && inCode(state, r.from))) return null
  return state.update(
    state.changeByRange((r) =>
      r.empty
        ? { changes: { from: r.from, insert: ch }, range: EditorSelection.cursor(r.from + 1) }
        : {
            changes: [
              { from: r.from, insert: ch },
              { from: r.to, insert: ch },
            ],
            range: EditorSelection.range(r.anchor + 1, r.head + 1),
          }
    ),
    { scrollIntoView: true, userEvent: 'input.type' }
  )
}

const wrapInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.composing || view.state.readOnly) return false
  const main = view.state.selection.main
  if (from !== main.from || to !== main.to) return false
  const tr = wrapSelection(view.state, text)
  if (!tr) return false
  view.dispatch(tr)
  return true
})

/** Bracket pairing and wrap-the-selection, as libs/editor installs them. */
export function proseEditing(): Extension {
  return [
    closeBrackets(),
    // Lowest: a nested language's own `closeBrackets` data wins in its fence.
    Prec.lowest(EditorState.languageData.of(() => [{ closeBrackets: { brackets: [...PROSE_BRACKETS] } }])),
    // Backspace between a pair takes both. Above the default Backspace; the
    // list marker's Backspace (Prec.highest) and markdown's own markup
    // Backspace still come first, and both decline away from a marker.
    Prec.high(keymap.of(closeBracketsKeymap)),
    wrapInput,
  ]
}
