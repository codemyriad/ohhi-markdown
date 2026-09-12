/**
 * Markdown extraction for the index: wikilinks, tags, headings, frontmatter
 * keys — all in ONE pass over the text, because the whole cost argument for
 * an in-memory index rests on not walking the corpus repeatedly.
 *
 * This is a scanner, not a parser, and deliberately so: it must never throw
 * on malformed input, and it must agree with what CodeMirror's lezer
 * extension decorates (libs/editor-lang) on the forms that matter. Where they
 * could disagree — nested brackets, links inside code fences — the rule is
 * "index generously, decorate conservatively": a stray backlink entry is a
 * cosmetic surprise, a missing one is a broken navigation graph.
 *
 * Frontmatter is READ ONLY, and only for key names. Golden rule 2 (never
 * reserialize what you didn't change) means nothing here ever writes YAML.
 */

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
  /** Text with the frontmatter block blanked out — what links/tags/headings are scanned in. */
  body: string
  /**
   * `body` with fenced code and URL-ish runs blanked to spaces as well — what
   * gets TOKENIZED. Same length as the original text, so every token offset is
   * still an offset into it and nothing has to be rebased.
   *
   * Why: measured on the real vault, 71 notes carry ≥20 URLs each and the ten
   * largest notes are link dumps. A 64 KB music list mentioning "html" 39
   * times — every one of them inside a URL — outranked the note actually
   * called `HTML.md`. URL text is not prose and must not compete with it.
   * Fenced code is the same argument for a different reason: a code block full
   * of `testing` is a listing, not a claim about the note's subject.
   *
   * INLINE code (`like this`) stays indexed: it is written in sentences and
   * readers search for it.
   */
  indexBody: string
  /** Offset of `body` within the original text (0 when there's no frontmatter). */
  bodyOffset: number
}

/** `[[target|alias]]`, `[[target#anchor]]`, `![[embed]]`. */
const WIKILINK = /(!?)\[\[([^\]\n]*)\]\]/g

/**
 * An inline `#tag`: preceded by start-of-line or whitespace, at least one
 * non-digit, and not a markdown heading (`# ` has a space after the hash).
 */
const INLINE_TAG = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}/_-]*)/gu

const ATX_HEADING = /^(#{1,6})[ \t]+(.*)$/

/** Fenced code — ``` or ~~~, any indent, optional info string. */
const FENCE = /^[ \t]{0,3}(`{3,}|~{3,})/

/**
 * Runs that are addresses rather than words. Deliberately greedy to the next
 * whitespace: the whole URL goes, not just its scheme, because the terms worth
 * excluding ("html", "docs", "json", "www") live in the host and the path.
 */
const URL_RUN = /(?:https?:\/\/|www\.)\S+/g
/** The target half of a markdown link/image — `[text](target)`. Text is kept. */
const LINK_TARGET = /\]\(([^)\n]*)\)/g

export function parseMarkdown(text: string): ParsedDoc {
  const { keys, bodyOffset } = readFrontmatter(text)
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

  const tags: RawTag[] = []
  INLINE_TAG.lastIndex = 0
  for (let m = INLINE_TAG.exec(body); m; m = INLINE_TAG.exec(body)) {
    const at = m.index + m[1].length
    if (inFence(at)) continue
    // A bare `#123` is a number, not a tag.
    if (/^\d+$/.test(m[2])) continue
    tags.push({ tag: `#${m[2]}`, offset: at })
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
    body,
    indexBody: blankNoise(body, fenced),
    bodyOffset,
  }
}

/**
 * Blank fenced code and URL-ish runs to SPACES (newlines kept), so the tokenizer
 * never sees them and every surviving token keeps the offset it had in the
 * original text. Blanking rather than slicing is the same trick the frontmatter
 * pass uses, and for the same reason: offsets are the contract — spans, snippets
 * and `grep` all index into the raw text.
 */
function blankNoise(body: string, fenced: [number, number][]): string {
  const ranges: [number, number][] = [...fenced]
  URL_RUN.lastIndex = 0
  for (let m = URL_RUN.exec(body); m; m = URL_RUN.exec(body)) {
    ranges.push([m.index, m.index + m[0].length])
  }
  LINK_TARGET.lastIndex = 0
  for (let m = LINK_TARGET.exec(body); m; m = LINK_TARGET.exec(body)) {
    ranges.push([m.index + 2, m.index + 2 + m[1].length])
  }
  if (ranges.length === 0) return body
  ranges.sort((a, b) => a[0] - b[0])
  let out = ''
  let at = 0
  for (const [from, to] of ranges) {
    if (to <= at) continue
    const start = Math.max(from, at)
    out += body.slice(at, start) + body.slice(start, to).replace(NON_NEWLINE, ' ')
    at = to
  }
  return out + body.slice(at)
}

const NON_NEWLINE = /[^\n]/g

/**
 * Top-level keys of a leading `---` YAML block, plus where the body starts.
 * Key extraction only — never a value, never a write (golden rule 2).
 */
function readFrontmatter(text: string): { keys: string[]; bodyOffset: number } {
  const none = { keys: [] as string[], bodyOffset: 0 }
  if (!text.startsWith('---')) return none
  const firstNl = text.indexOf('\n')
  if (firstNl === -1 || text.slice(3, firstNl).trim() !== '') return none

  // The closing delimiter must be a line that is EXACTLY `---` or `...`.
  // Accepting any line that merely starts with three dashes made a leading
  // thematic break plus the next `---` look like frontmatter, and everything
  // between them — links, tags, headings, prose — was blanked out of the index
  // while staying perfectly visible in the editor.
  const lines = text.split('\n')
  let endLine = -1
  for (let i = 1; i < lines.length; i++) {
    const trimmed = lines[i].trimEnd()
    if (trimmed === '---' || trimmed === '...') {
      endLine = i
      break
    }
  }
  if (endLine === -1) return none

  const keys: string[] = []
  for (let i = 1; i < endLine; i++) {
    // Top-level keys only: indented lines are nested values or list items.
    const m = /^([A-Za-z_][\w.-]*)\s*:/.exec(lines[i])
    if (m) keys.push(m[1])
  }
  // A block with no top-level key is far more likely to be a thematic break
  // than real frontmatter, so index it as content rather than hiding it.
  if (keys.length === 0) return none

  let bodyOffset = 0
  for (let i = 0; i <= endLine; i++) bodyOffset += lines[i].length + 1
  return { keys, bodyOffset: Math.min(bodyOffset, text.length) }
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
