/**
 * `==highlight==` for @codemirror/lang-markdown — Obsidian's mark syntax.
 *
 * Three occurrences in the vault, and it is ~25 lines: the reason to parse it
 * is that an unparsed `==` renders as literal text in Live preview, which
 * looks like a bug rather than like a construct we chose not to support.
 *
 * Modelled on @lezer/markdown's own Strikethrough: a delimiter pair, so the
 * standard machinery does the matching and nesting.
 */
import { tags as t, Tag as HighlightTag } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

/**
 * Our own tag: the mark's fill/ink are --ed-mark-bg / --ed-mark-fg. Derived
 * from `emphasis` (a highlight is emphasis you can see) rather than from
 * `special(emphasis)`, which @lezer/highlight refuses as a parent — a modified
 * tag cannot be derived from.
 */
export const highlightTag = HighlightTag.define(t.emphasis)

const EQUALS = 61 // '='

const HighlightDelim = { resolve: 'Highlight', mark: 'HighlightMark' }

/** Same class @lezer/markdown uses to decide whether a delimiter can open/close. */
const PUNCTUATION =
  /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~\xA1‐-‧]/

export const Highlight: MarkdownConfig = {
  defineNodes: [
    { name: 'Highlight', style: { 'Highlight/...': highlightTag } },
    { name: 'HighlightMark', style: t.processingInstruction },
  ],
  parseInline: [
    {
      name: 'Highlight',
      after: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== EQUALS || cx.char(pos + 1) !== EQUALS || cx.char(pos + 2) === EQUALS) {
          return -1
        }
        const before = cx.slice(pos - 1, pos)
        const after = cx.slice(pos + 2, pos + 3)
        const spaceBefore = /\s|^$/.test(before)
        const spaceAfter = /\s|^$/.test(after)
        const punctBefore = PUNCTUATION.test(before)
        const punctAfter = PUNCTUATION.test(after)
        return cx.addDelimiter(
          HighlightDelim,
          pos,
          pos + 2,
          !spaceAfter && (!punctAfter || spaceBefore || punctBefore),
          !spaceBefore && (!punctBefore || spaceAfter || punctAfter)
        )
      },
    },
  ],
}
