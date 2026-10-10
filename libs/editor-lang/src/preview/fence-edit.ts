/**
 * Editing a code fence (editor-usability E3): the info string completes to a
 * language name, Enter on a fresh opening fence closes it, and the code card's
 * header can copy the block or reopen the language. The rules are fence.ts's;
 * this module only adapts them to a state and a view.
 */
import { startCompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { Facet, Prec, type EditorState, type Extension, type Text } from '@codemirror/state'
import { keymap, type Command, type EditorView } from '@codemirror/view'
import {
  autoCloseFence,
  closingLineOf,
  fenceContent,
  opensFenceAt,
  rankLanguages,
  type FenceLanguage,
  type LineSource,
} from './fence.js'

/**
 * The languages a fence can name. libs/editor fills it from
 * `@codemirror/language-data` (the same list that highlights the fences);
 * this package does not depend on that list, so without a host it is empty
 * and the completion simply offers nothing.
 */
export const fenceLanguages = Facet.define<readonly FenceLanguage[], readonly FenceLanguage[]>({
  combine: (values) => values[values.length - 1] ?? [],
})

function linesOf(doc: Text): LineSource {
  return { length: doc.lines, at: (i) => (i >= 0 && i < doc.lines ? doc.line(i + 1).text : undefined) }
}

const INFO_CHAR = /[\w+#.-]/
const BEFORE = /^([ \t]*)(`{3,}|~{3,})([\w+#.-]*)$/

/**
 * Language names at a fence's info string, prefix-ranked: ``` at the start of
 * a line plus letters (or an explicit request — the chip, Ctrl-Space — with
 * nothing typed yet, which lists them all). Never inside an existing block,
 * where a ```py line is code.
 */
export function fenceLanguageCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context
  const line = state.doc.lineAt(pos)
  const m = BEFORE.exec(line.text.slice(0, pos - line.from))
  if (!m) return null
  const typed = m[3]
  if (!typed && !context.explicit) return null
  if (!opensFenceAt(linesOf(state.doc), line.number - 1)) return null
  const languages = state.facet(fenceLanguages)
  if (!languages.length) return null
  // The whole word under the caret is replaced, so picking from the chip
  // (caret at the start of the word) swaps the language rather than
  // prefixing it.
  let to = pos
  while (to < line.to && INFO_CHAR.test(line.text[to - line.from])) to++
  const options = rankLanguages(languages, typed, typed ? 50 : 500).map((lang) => ({
    label: lang.label,
    detail: lang.name === lang.label ? undefined : lang.name,
    type: 'constant',
  }))
  if (!options.length) return null
  return { from: pos - typed.length, to, options, filter: false }
}

/**
 * Enter at the end of a fresh opening fence (```lang with nothing closing it
 * below): the fence is closed for you, the caret on the empty line between.
 * Anything else — mid-line, a selection, a fence that is already closed, a
 * line inside a block — is left to the next Enter binding.
 */
export const autoCloseFenceOnEnter: Command = (view) => {
  const { state } = view
  if (state.readOnly || state.selection.ranges.length > 1) return false
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.to) return false
  const plan = autoCloseFence(linesOf(state.doc), line.number - 1)
  if (!plan) return false
  view.dispatch({
    changes: { from: line.to, insert: `\n${plan.indent}\n${plan.indent}${plan.fence}` },
    selection: { anchor: line.to + 1 + plan.indent.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}

/**
 * The block's code, for the copy button: the lines between the fence that
 * opens on the line at `pos` and the one that closes it (or the end of the
 * note, for an unclosed fence). Null when `pos` is not on an opening fence.
 */
export function codeBlockText(state: EditorState, pos: number): string | null {
  const lines = linesOf(state.doc)
  const index = state.doc.lineAt(pos).number - 1
  const open = opensFenceAt(lines, index)
  if (!open) return null
  const close = closingLineOf(lines, index, open)
  const end = close === -1 ? lines.length : close
  const body: string[] = []
  for (let i = index + 1; i < end; i++) body.push(lines.at(i) ?? '')
  return fenceContent(body, open.indent)
}

/**
 * The language chip: put the caret at the start of the info string — which
 * reveals the fence line — and open the language list there.
 */
export function openFenceLanguage(view: EditorView, pos: number): void {
  const line = view.state.doc.lineAt(pos)
  const m = /^[ \t]*(?:`{3,}|~{3,})/.exec(line.text)
  if (!m) return
  view.dispatch({ selection: { anchor: line.from + m[0].length }, scrollIntoView: true })
  view.focus()
  startCompletion(view)
}

/**
 * Enter's auto-close, above lang-markdown's own Enter (Prec.high,
 * insertNewlineContinueMarkup) so it is asked first; it declines everywhere
 * but a fresh opening fence.
 */
export function fenceKeymap(): Extension {
  return Prec.highest(keymap.of([{ key: 'Enter', run: autoCloseFenceOnEnter }]))
}
