/**
 * The ONE definition of what an inline `#tag` is (read-shaping.md Fork 6).
 * The index scans with it and the editor's lezer extension decorates with it,
 * so a chip in the note and a hit in search can never disagree.
 *
 * Obsidian's rule: `#` at the start of a line or after whitespace, then
 * letters, digits, `_`, `-` and `/` (nested tags), at least one non-digit.
 * `#123` is an issue number, not a tag. Case is preserved as written;
 * matching is case-insensitive (see `tagKey`).
 */

/** Characters allowed in a tag body, as a sticky regex anchored at the body. */
const TAG_BODY = /[\p{L}\p{N}][\p{L}\p{N}/_-]*/uy

const WHOLE_BODY = new RegExp(`^(?:${TAG_BODY.source})$`, 'u')

/**
 * Is the whole of `body` (no `#`) spellable as a tag? What `#` completion asks
 * of half-typed input, so it is the character class ALONE — the all-digits
 * rule belongs to `scanTag`, which decides a COMPLETE tag.
 */
export function isTagBody(body: string): boolean {
  return WHOLE_BODY.test(body)
}

/** True when a `#` at `hashAt` sits where a tag may start. */
export function tagBoundary(text: string, hashAt: number): boolean {
  if (text.charCodeAt(hashAt) !== 35 /* # */) return false
  if (hashAt === 0) return true
  return /\s/.test(text[hashAt - 1] ?? '')
}

/**
 * Scan a tag whose `#` is at `hashAt`. Returns the body (without `#`) and
 * the offset just past it, or null when there is no tag there.
 */
export function scanTag(text: string, hashAt: number): { tag: string; end: number } | null {
  if (!tagBoundary(text, hashAt)) return null
  TAG_BODY.lastIndex = hashAt + 1
  const m = TAG_BODY.exec(text)
  if (!m) return null
  if (/^\d+$/.test(m[0])) return null
  return { tag: m[0], end: hashAt + 1 + m[0].length }
}

/** The form tags are compared and stored under: `#` + lower-cased body. */
export function tagKey(tag: string): string {
  return '#' + (tag.startsWith('#') ? tag.slice(1) : tag).toLowerCase()
}

/** Every tag in `text` (outside nothing — callers exclude fences themselves). */
export function scanTags(text: string): { tag: string; offset: number }[] {
  const out: { tag: string; offset: number }[] = []
  for (let i = text.indexOf('#'); i !== -1; i = text.indexOf('#', i + 1)) {
    const hit = scanTag(text, i)
    if (hit) {
      out.push({ tag: hit.tag, offset: i })
      i = hit.end - 1
    }
  }
  return out
}
