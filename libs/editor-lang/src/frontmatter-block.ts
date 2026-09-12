/**
 * The `---` YAML block at the top of a note, as a syntax node.
 *
 * Neither @lezer/markdown nor @codemirror/lang-markdown parses frontmatter, and
 * without a node the block is actively WRONG on screen: `---` becomes a
 * thematic break, `title: x` under it becomes a setext heading, and
 * `tags: [a b]` becomes a markdown link. So the block gets one leaf node whose
 * contents are opaque — the YAML is read by @editor/frontmatter, never by this
 * grammar (read-shaping.md B4.2, R4.1.1: the block is ordinary text).
 *
 *   ---           FrontmatterMark
 *   tags: [a b]   (no children: opaque to markdown)
 *   ---           FrontmatterMark
 *
 * A block is recognised ONLY at offset 0, and only when a closing `---`/`...`
 * line follows — the same rule libs/index/src/parse.ts applies, so the strip
 * and the index always agree about whether a note has frontmatter.
 */
import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const OPEN = /^-{3}\s*$/

function isClose(text: string): boolean {
  const trimmed = text.trimEnd()
  return trimmed === '---' || trimmed === '...'
}

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
const MAX_LINES = 64

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
        if (cx.lineStart !== 0 || !OPEN.test(line.text)) return false
        const from = cx.lineStart
        const marks = [cx.elt('FrontmatterMark', from, from + line.text.length)]
        let to = -1
        for (let scanned = 0; scanned < MAX_LINES && cx.nextLine(); scanned++) {
          if (!isClose(line.text)) continue
          to = cx.lineStart + line.text.length
          marks.push(cx.elt('FrontmatterMark', cx.lineStart, to))
          break
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
