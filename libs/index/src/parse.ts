/**
 * Markdown extraction for the index: wikilinks, tags, headings, frontmatter
 * keys, tags and aliases — all in ONE pass over the text, because the whole cost argument for
 * an in-memory index rests on not walking the corpus repeatedly.
 *
 * This is a scanner, not a parser, and deliberately so: it must never throw
 * on malformed input, and it must agree with what CodeMirror's lezer
 * extension decorates (libs/editor-lang) on the forms that matter. Where they
 * could disagree — nested brackets, links inside code fences — the rule is
 * "index generously, decorate conservatively": a stray backlink entry is a
 * cosmetic surprise, a missing one is a broken navigation graph.
 *
 * Frontmatter is READ ONLY — keys, tags and aliases, through the one parser
 * in @editor/frontmatter. Golden rule 2 (never reserialize what you didn't
 * change) means nothing here ever writes YAML; the patcher lives there, and
 * the index never calls it.
 */

import { parseFrontmatter } from '@editor/frontmatter'
import { scanTag, scanTags } from './tag-syntax.js'

export interface RawLink {
  target: string
  alias: string | null
  anchor: string | null
  offset: number
  /** Whether the occurrence was an `![[embed]]` rather than a `[[link]]`. */
  embed: boolean
}

export interface RawTag {
  tag: string
  offset: number
}

export interface RawHeading {
  level: number
  text: string
  offset: number
}

export interface ParsedDoc {
  links: RawLink[]
  tags: RawTag[]
  headings: RawHeading[]
  frontmatterKeys: string[]
  /**
   * Tags from the block's `tags`/`tag` entry — every Obsidian form, including
   * the vault's legacy `[a b]`. Offsets point at the tag's text inside the
   * block so a caller can highlight it.
   */
  frontmatterTags: RawTag[]
  /** `aliases`/`alias`, as written. Nothing consumes them yet; the CLI will. */
  aliases: string[]
  /** Text with the frontmatter block blanked out — what gets tokenized. */
  body: string
  /** Offset of `body` within the original text (0 when there's no frontmatter). */
  bodyOffset: number
}

/** `[[target|alias]]`, `[[target#anchor]]`, `![[embed]]`. */
const WIKILINK = /(!?)\[\[([^\]\n]*)\]\]/g

const ATX_HEADING = /^(#{1,6})[ \t]+(.*)$/

/** Fenced code — ``` or ~~~, any indent, optional info string. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/

export function parseMarkdown(text: string): ParsedDoc {
  const { keys, bodyOffset, frontmatterTags, aliases } = readFrontmatter(text)
  // Blank the frontmatter rather than slicing it, so every offset below is an
  // offset into the ORIGINAL text and callers never have to rebase. NEWLINES
  // ARE PRESERVED — blanking them too would merge the frontmatter into the
  // first body line and hide a heading that immediately follows the block.
  const body =
    bodyOffset > 0
      ? text.slice(0, bodyOffset).replace(/[^\n]/g, ' ') + text.slice(bodyOffset)
      : text

  const fenced = fencedRanges(body)
  const inFence = (offset: number): boolean =>
    fenced.some(([from, to]) => offset >= from && offset < to)
  // Tags are the one thing that must also stay out of `#code spans`: the
  // editor's inline parser never looks inside one (the code-span parser
  // consumes the whole run), so a tag counted here would be a chip that does
  // not exist and a search hit with nothing to click (Fork 6 — one grammar).
  const spans = inlineCodeRanges(body, inFence)
  const inCode = (offset: number): boolean =>
    inFence(offset) || spans.some(([from, to]) => offset >= from && offset < to)

  const links: RawLink[] = []
  WIKILINK.lastIndex = 0
  for (let m = WIKILINK.exec(body); m; m = WIKILINK.exec(body)) {
    if (inFence(m.index)) continue
    const inner = m[2]
    if (!inner.trim()) continue
    const pipe = inner.indexOf('|')
    const head = pipe === -1 ? inner : inner.slice(0, pipe)
    const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null
    const hash = head.indexOf('#')
    const target = (hash === -1 ? head : head.slice(0, hash)).trim()
    const anchor = hash === -1 ? null : head.slice(hash + 1).trim() || null
    // `[[#heading]]` is a same-note anchor; it has no target to resolve.
    if (!target && !anchor) continue
    links.push({ target, alias, anchor, offset: m.index, embed: m[1] === '!' })
  }

  // One tag grammar for the index and the editor: tag-syntax.ts.
  const tags: RawTag[] = []
  for (const hit of scanTags(body)) {
    if (inCode(hit.offset)) continue
    tags.push({ tag: `#${hit.tag}`, offset: hit.offset })
  }

  const headings: RawHeading[] = []
  let offset = 0
  for (const line of body.split('\n')) {
    if (!inFence(offset)) {
      const m = ATX_HEADING.exec(line)
      if (m) headings.push({ level: m[1].length, text: m[2].trim(), offset })
    }
    offset += line.length + 1
  }

  return {
    links,
    tags,
    headings,
    frontmatterKeys: keys,
    frontmatterTags,
    aliases,
    body,
    bodyOffset,
  }
}

/**
 * What the leading `---` block contributes to the index: its key names, its
 * tags and aliases, and where the body starts. `@editor/frontmatter` owns the
 * reading (one parser for the index, the editor's strip and the CLI — R4.5).
 */
function readFrontmatter(text: string): {
  keys: string[]
  bodyOffset: number
  frontmatterTags: RawTag[]
  aliases: string[]
} {
  const none = { keys: [], bodyOffset: 0, frontmatterTags: [], aliases: [] }
  const fm = parseFrontmatter(text)
  // A block with no top-level key is far more likely to be a thematic break
  // than real frontmatter, so index it as content rather than hiding it: the
  // alternative blanked links, tags, headings and prose out of the index
  // while leaving them perfectly visible in the editor.
  if (!fm.present || fm.entries.length === 0) return none

  const frontmatterTags: RawTag[] = []
  for (const raw of fm.tags) {
    // The ONE tag grammar (tag-syntax.ts) decides here too, so `tags: [2026]`
    // is no more a tag in the block than `#2026` is in the body.
    const hit = scanTag(`#${raw}`, 0)
    if (!hit || hit.end !== raw.length + 1) continue
    const at = text.indexOf(raw, 3)
    frontmatterTags.push({ tag: `#${raw}`, offset: at >= 0 && at < fm.end ? at : 0 })
  }

  return {
    keys: fm.entries.map((e) => e.key),
    bodyOffset: fm.end,
    frontmatterTags,
    aliases: fm.aliases,
  }
}

/**
 * [from, to) ranges covered by inline code spans.
 *
 * CommonMark's rule, and @lezer/markdown's: a run of N backticks opens a span
 * that the next run of exactly N closes; an unmatched run is literal text. The
 * search for the closer stops at a blank line, because inline parsing never
 * crosses a paragraph — without that, one stray backtick would swallow the
 * rest of the note's tags.
 */
function inlineCodeRanges(
  text: string,
  inFence: (offset: number) => boolean
): [number, number][] {
  const ranges: [number, number][] = []
  /** End of the backtick run that starts at `at`. */
  const runEnd = (at: number): number => {
    let end = at
    while (text.charCodeAt(end) === 96 /* ` */) end++
    return end
  }
  let i = text.indexOf('`')
  while (i !== -1) {
    if (inFence(i)) {
      i = text.indexOf('`', i + 1)
      continue
    }
    const open = runEnd(i)
    const para = text.indexOf('\n\n', open)
    const stop = para === -1 ? text.length : para
    let closed = -1
    for (let next = text.indexOf('`', open); next !== -1 && next < stop; ) {
      const end = runEnd(next)
      if (end - next === open - i) {
        closed = end
        break
      }
      next = text.indexOf('`', end)
    }
    if (closed === -1) {
      // An unmatched run is literal text; carry on from just past it.
      i = text.indexOf('`', open)
      continue
    }
    ranges.push([i, closed])
    i = text.indexOf('`', closed)
  }
  return ranges
}

/** [from, to) ranges covered by fenced code blocks. */
function fencedRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  let offset = 0
  let open: { at: number; marker: string } | null = null
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line)
    if (m) {
      if (!open) {
        open = { at: offset, marker: m[1][0] }
      } else if (line.trimStart().startsWith(open.marker.repeat(3))) {
        ranges.push([open.at, offset + line.length])
        open = null
      }
    }
    offset += line.length + 1
  }
  if (open) ranges.push([open.at, text.length])
  return ranges
}
