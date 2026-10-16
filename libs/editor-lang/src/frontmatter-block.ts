/**
 * The `---` YAML block at the top of a note, as a syntax node.
 *
 * Neither @lezer/markdown nor @codemirror/lang-markdown parses frontmatter, and
 * without a node the block is actively WRONG on screen: `---` becomes a
 * thematic break, `title: x` under it becomes a setext heading, and
 * `tags: [a b]` becomes a markdown link. So the block gets one leaf node whose
 * contents are opaque — the YAML is read by @ohhi/frontmatter, never by this
 * grammar (read-shaping B4.2, R4.1.1: the block is ordinary text).
 *
 *   ---           FrontmatterMark
 *   tags: [a b]   (no children: opaque to markdown)
 *   ---           FrontmatterMark
 *
 * A block is recognised ONLY at offset 0, and only when a closing `---`/`...`
 * line follows within FM_MAX_LINES. This grammar is deliberately the NARROWER
 * of the two readers — it refuses shapes @ohhi/frontmatter accepts (FIRST),
 * because a false start here costs a note its rendering. What a note HAS is
 * decided by @ohhi/frontmatter, in preview/build.ts and in libs/index, so
 * the strip, search and the CLI still agree with each other.
 */
import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

/**
 * The delimiters, exported because preview/build.ts draws the same block from
 * the TEXT when this parser's tree is stale (`restoreFrontmatter`): two
 * readers that disagreed about where the block ends would put the strip over
 * the wrong lines. Opening `---`, then a line that is `---` or `...`.
 */
export const FM_OPEN = /^-{3}\s*$/
export const FM_CLOSE = /^(?:-{3}|\.{3})\s*$/

/**
 * What the line under the opening `---` has to look like before the scan below
 * starts: a top-level YAML key, or the closing delimiter of an empty block.
 *
 * This is the guard that keeps the cost of a false start at zero. `---` above
 * a heading, a bullet or a sentence is a thematic break — which is what a
 * reader typing `---` at the top of an existing note has written — and this
 * says so without consuming a single line.
 *
 * A block whose first line is a YAML comment is therefore not a node here,
 * because `# comment` and `# Heading` are the same line and the heading is the
 * one that exists (the vault's 37 frontmatter lines are all `key: value`). It
 * is still a block: @ohhi/frontmatter reads one, and preview/build.ts draws
 * the strip from the text when the tree and the text disagree.
 */
const FIRST = /^[^\s#][^:]*:([ \t]|$)|^(?:-{3}|\.{3})\s*$/

/**
 * What a line inside the block may be: blank, a comment, a top-level key, or
 * an indented continuation. The scan stops at the first line that is none of
 * them, so a note whose block is not closed yet loses its rendering for the
 * two lines you have typed rather than for FM_MAX_LINES of body.
 */
const CONTINUES = /^\s*$|^#|^[^\s][^:]*:([ \t]|$)|^\s+\S/

/**
 * How far the parser will look for the closing delimiter.
 *
 * A block parser cannot rewind: every line it looks at with `nextLine()` is
 * consumed whether or not it ends up emitting a node. Scanning to the end of
 * the file would mean that the instant you type `---` at the top of a long
 * note — before the closing `---` exists — the whole note stops parsing as
 * markdown. Bounding the scan bounds that damage to a window instead. Real
 * frontmatter is a handful of lines (the vault's 17 blocks hold 37 lines
 * between them); a block longer than this renders as plain text and shows no
 * strip, which is honest and self-correcting.
 */
export const FM_MAX_LINES = 64

export const Frontmatter: MarkdownConfig = {
  defineNodes: [
    { name: 'Frontmatter', block: true, style: t.meta },
    { name: 'FrontmatterMark', style: t.processingInstruction },
  ],
  parseBlock: [
    {
      name: 'Frontmatter',
      // Before HorizontalRule, which would otherwise claim the opening `---`.
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !FM_OPEN.test(line.text)) return false
        // Peeked, not consumed: `nextLine` cannot be undone, so the cheap
        // rejection has to happen before the scan (see FM_MAX_LINES).
        if (!FIRST.test(cx.peekLine())) return false
        const from = cx.lineStart
        const marks = [cx.elt('FrontmatterMark', from, from + line.text.length)]
        let to = -1
        for (let scanned = 0; scanned < FM_MAX_LINES && cx.nextLine(); scanned++) {
          if (FM_CLOSE.test(line.text)) {
            to = cx.lineStart + line.text.length
            marks.push(cx.elt('FrontmatterMark', cx.lineStart, to))
            break
          }
          if (!CONTINUES.test(line.text)) break
        }
        // Unterminated: the lines this scan consumed stay unparsed (there is no
        // way to give them back), but the rest of the note still parses.
        if (to === -1) return false
        cx.nextLine()
        cx.addElement(cx.elt('Frontmatter', from, to, marks))
        return true
      },
    },
  ],
}
