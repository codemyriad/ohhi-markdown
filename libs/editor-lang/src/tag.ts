/**
 * `#tag` support for @codemirror/lang-markdown (read-shaping B5, Fork 6).
 *
 * The grammar itself is NOT defined here: `scanTag` in @ohhi/index is the
 * one definition of what a tag is, and the index scans with the same function.
 * A chip in the note and a hit in `tag:#x` search can therefore never
 * disagree — the failure V2c's review caught with wikilink resolution
 * ("one resolver"), avoided by construction.
 *
 * Node shape:  `#edible/roadmap`
 *               ^^^^^^^^^^^^^^^ Tag  (the `#` is part of the chip)
 */
import { scanTag } from '@ohhi/index'
import { tags as t, Tag as HighlightTag } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

/** Our own tag so a theme can colour `#tags` distinctly from other labels. */
export const tagTag = HighlightTag.define(t.labelName)

const HASH = 35 // '#'

/**
 * How far past the `#` the scanner may look. A tag body has no whitespace, so
 * this only ever truncates a pathological run of 256 tag characters; bounding
 * it keeps the per-`#` cost constant in a note with thousands of `#` (the
 * vault has 55 issue refs like `#123` that are rejected one by one).
 */
const MAX_TAG = 256

export const Tag: MarkdownConfig = {
  defineNodes: [{ name: 'Tag', style: tagTag }],
  parseInline: [
    {
      name: 'Tag',
      parse(cx, next, pos) {
        if (next !== HASH) return -1
        // scanTag needs the character before the `#` to apply Obsidian's
        // boundary rule, so the window starts one character early where there
        // is one. At the very start of an inline section there is nothing
        // before it, which is a boundary.
        const from = pos > cx.offset ? pos - 1 : pos
        const window = cx.slice(from, Math.min(cx.end, pos + 1 + MAX_TAG))
        const hit = scanTag(window, pos - from)
        if (!hit) return -1
        return cx.addElement(cx.elt('Tag', pos, from + hit.end))
      },
    },
  ],
}
