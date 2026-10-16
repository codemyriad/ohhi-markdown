/**
 * `[[wikilink]]` support for @codemirror/lang-markdown.
 *
 * shaping D3 planned a FORK of `lezer-markdown-obsidian`. This is a ~120
 * line `MarkdownConfig` on the upstream grammar instead — see
 * v2-shaping Fork 3. The reasoning: the forms this vault actually
 * uses are 929 plain targets, 22 aliases and 34 heading refs, all of which an
 * inline parser on `[[` handles; a grammar fork is a permanently maintained
 * third-party surface for the same result. The repo's vendoring rule exists
 * for DORMANT upstreams (y-codemirror.next, diff-match-patch), and
 * @codemirror/lang-markdown is neither dormant nor being modified.
 *
 * Node shape, so decorations and completion can address the parts:
 *
 *   [[ Target | Alias ]]        [[ Target # Anchor ]]
 *   ^^ WikiLinkMark             ^^ WikiLinkMark
 *      ^^^^^^ WikiLinkTarget       ^^^^^^ WikiLinkTarget
 *              ^^^^^ WikiLinkAlias        ^^^^^^ WikiLinkAnchor
 *
 * Block refs (`#^id`, 29 occurrences) parse into WikiLinkAnchor like any other
 * anchor but are deliberately NOT resolved: that needs a block-id index which
 * D8 forbids until the views trigger fires.
 */
import type { MarkdownConfig } from '@lezer/markdown'
import { tags as t, Tag } from '@lezer/highlight'

/** Our own highlight tags, so themes can colour wikilinks distinctly. */
export const wikiLinkTag = Tag.define(t.link)
export const wikiLinkMarkTag = Tag.define(t.processingInstruction)

const OPEN = 91 // '['
const BANG = 33 // '!'
const PIPE = 124 // '|'
const HASH = 35 // '#'
const CLOSE = 93 // ']'
const NEWLINE = 10

export const WikiLink: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: wikiLinkTag },
    { name: 'WikiLinkMark', style: wikiLinkMarkTag },
    { name: 'WikiLinkTarget' },
    { name: 'WikiLinkAlias' },
    { name: 'WikiLinkAnchor' },
    { name: 'WikiLinkEmbed', style: wikiLinkTag },
  ],
  parseInline: [
    {
      name: 'WikiLink',
      // Before Link so `![[x]]` is not consumed as an image by the standard
      // rules, and so `[[x]]` never becomes a nested pair of Links.
      before: 'Link',
      parse(cx, next, pos) {
        const embed = next === BANG
        const start = embed ? pos + 1 : pos
        if (cx.char(start) !== OPEN || cx.char(start + 1) !== OPEN) return -1

        // Scan for `]]` on the same line. Wikilinks never span lines, and
        // bailing at the newline keeps a stray `[[` from swallowing the file.
        let end = -1
        for (let i = start + 2; i < cx.end; i++) {
          const ch = cx.char(i)
          if (ch === NEWLINE) return -1
          if (ch === CLOSE && cx.char(i + 1) === CLOSE) {
            end = i
            break
          }
        }
        if (end === -1 || end === start + 2) return -1

        const children = [cx.elt('WikiLinkMark', start, start + 2)]
        const inner = { from: start + 2, to: end }

        // `|` splits head from alias; `#` splits target from anchor. Both are
        // first-occurrence: a `#` inside an alias is display text, and a `|`
        // inside an anchor is not a thing.
        let pipe = -1
        for (let i = inner.from; i < inner.to; i++) {
          if (cx.char(i) === PIPE) {
            pipe = i
            break
          }
        }
        const headEnd = pipe === -1 ? inner.to : pipe
        let hash = -1
        for (let i = inner.from; i < headEnd; i++) {
          if (cx.char(i) === HASH) {
            hash = i
            break
          }
        }

        const targetEnd = hash === -1 ? headEnd : hash
        if (targetEnd > inner.from) {
          children.push(cx.elt('WikiLinkTarget', inner.from, targetEnd))
        }
        if (hash !== -1) {
          children.push(cx.elt('WikiLinkMark', hash, hash + 1))
          if (headEnd > hash + 1) children.push(cx.elt('WikiLinkAnchor', hash + 1, headEnd))
        }
        if (pipe !== -1) {
          children.push(cx.elt('WikiLinkMark', pipe, pipe + 1))
          if (inner.to > pipe + 1) children.push(cx.elt('WikiLinkAlias', pipe + 1, inner.to))
        }
        children.push(cx.elt('WikiLinkMark', end, end + 2))

        return cx.addElement(
          cx.elt(embed ? 'WikiLinkEmbed' : 'WikiLink', pos, end + 2, children)
        )
      },
    },
  ],
}

export interface WikiLinkParts {
  target: string
  alias: string | null
  anchor: string | null
}

/** Split the inside of `[[…]]` the same way the parser does. */
export function splitWikiLink(inner: string): WikiLinkParts {
  const pipe = inner.indexOf('|')
  const head = pipe === -1 ? inner : inner.slice(0, pipe)
  const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null
  const hash = head.indexOf('#')
  return {
    target: (hash === -1 ? head : head.slice(0, hash)).trim(),
    anchor: hash === -1 ? null : head.slice(hash + 1).trim() || null,
    alias,
  }
}
