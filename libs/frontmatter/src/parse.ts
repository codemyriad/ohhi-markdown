/**
 * Reading the block: where it is, what is in it, and whether the patcher may
 * write to it. `yaml` is used ONLY here, and only to read — it gives node
 * positions and scalar typing that a regex cannot (quoting, flow lists,
 * comments). Every byte offset below indexes the ORIGINAL document.
 *
 * Never throws: a note is text the user is in the middle of typing, and the
 * editor asks this question on every keystroke.
 */
import { isAlias, isMap, isScalar, isSeq, parseDocument, type Node, type Scalar } from 'yaml'
import type { FmEntry, FmReason, Frontmatter } from './types.js'

/** Keys Obsidian reads as tags / aliases, matched case-insensitively. */
export const TAG_KEYS = new Set(['tags', 'tag'])
const ALIAS_KEYS = new Set(['aliases', 'alias'])

/** The `---` block itself: where it ends, and the YAML between the fences. */
interface Block {
  /** 0-based line index of the closing `---`/`...` line. */
  closeLine: number
  /** Offset of the first body character, past the closing line's newline. */
  end: number
  inner: string
  /** Offset of `inner` in the document. */
  innerFrom: number
}

/**
 * An entry plus the positions the patcher writes through. Internal: the
 * public `FmEntry` carries line numbers, because line ranges are the only
 * thing a caller may address (Fork 4-A).
 */
export interface RawEntry {
  entry: FmEntry
  keyFrom: number
  keyTo: number
  /** Offset of the `:` that makes this pair a pair. */
  colonAt: number
  /**
   * Offset just past the value's bytes. With no value it is where a trailing
   * comment or the line break begins, so `key:` and `key:  # why` both take a
   * value without disturbing what follows.
   */
  valueTo: number
}

export interface ReadResult {
  block: Block | null
  entries: RawEntry[]
  supported: boolean
  reason?: FmReason
  /** Offsets at which each line of the document begins. */
  lineStarts: number[]
}

/**
 * Offsets at which each line begins. Exported with `lineIndexAt` because the
 * index needs the same two over the same note: a line number that disagreed
 * between the two readers would put a search hit on the wrong line.
 */
export function lineStartsOf(text: string): number[] {
  const starts = [0]
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1)
  return starts
}

/** 0-based line for an offset. Binary search — this runs per entry, per parse. */
export function lineIndexAt(starts: number[], offset: number): number {
  let lo = 0
  let hi = starts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (starts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Offset of the line break ending `line` (or the end of the text). */
function lineEndOf(starts: number[], line: number, length: number): number {
  return line + 1 < starts.length ? starts[line + 1] - 1 : length
}

/** Offset at which the line AFTER `line` begins — a line-range end, exclusive. */
export function lineLimitOf(starts: number[], line: number, length: number): number {
  return line + 1 < starts.length ? starts[line + 1] : length
}

export function parseFrontmatter(text: string): Frontmatter {
  const read = readBlock(text)
  const entries = read.entries.map((e) => e.entry)
  return {
    present: read.block !== null,
    supported: read.supported,
    ...(read.reason ? { reason: read.reason } : {}),
    end: read.block?.end ?? 0,
    entries,
    tags: dedupe(collect(entries, TAG_KEYS, splitTagScalar).map(stripHash)),
    // Aliases are phrases ("Systems Programming"), so a scalar splits on
    // commas only — splitting on spaces would shred every multi-word alias.
    aliases: dedupe(collect(entries, ALIAS_KEYS, (v) => v.split(','))),
  }
}

/** The parse both `parseFrontmatter` and the patcher run on. */
export function readBlock(text: string): ReadResult {
  // The index asks this of every note on every keystroke, and 1,021 of the
  // vault's 1,038 notes have no block at all: reject those on one comparison,
  // before scanning the text for line starts.
  if (!text.startsWith('---')) return { block: null, entries: [], supported: true, lineStarts: [0] }
  const lineStarts = lineStartsOf(text)
  const block = findBlock(text, lineStarts)
  if (!block) return { block: null, entries: [], supported: true, lineStarts }
  const read = readEntries(text, block, lineStarts)
  return { block, ...read, lineStarts }
}

/** A `---` at offset 0 closed by a line that is exactly `---` or `...`. */
function findBlock(text: string, lineStarts: number[]): Block | null {
  if (!text.startsWith('---')) return null
  const firstNl = text.indexOf('\n')
  // `---abc` is not a fence, and a `---` with no line break has no block.
  if (firstNl === -1 || text.slice(3, firstNl).trim() !== '') return null
  for (let line = 1; line < lineStarts.length; line++) {
    const start = lineStarts[line]
    const end = lineEndOf(lineStarts, line, text.length)
    const trimmed = text.slice(start, end).trimEnd()
    if (trimmed === '---' || trimmed === '...') {
      return {
        closeLine: line,
        end: Math.min(end + 1, text.length),
        inner: text.slice(firstNl + 1, start),
        innerFrom: firstNl + 1,
      }
    }
  }
  return null
}

function readEntries(
  text: string,
  block: Block,
  lineStarts: number[]
): { entries: RawEntry[]; supported: boolean; reason?: FmReason } {
  // uniqueKeys off so a duplicate key is reported as itself rather than as a
  // generic parse error — the widget and the CLI say different things about it.
  const doc = parseDocument(block.inner, { uniqueKeys: false })
  const entries: RawEntry[] = []
  let reason: FmReason | undefined = doc.errors.length ? 'invalid' : undefined
  const fail = (r: FmReason): void => {
    reason ??= r
  }

  const contents: unknown = doc.contents
  // An empty block (blank lines, comments only) is a supported block with no
  // entries; anything that is not a mapping is not frontmatter at all.
  if (contents === null || contents === undefined) return { entries, supported: !reason, reason }
  if (!isMap(contents)) return { entries, supported: false, reason: reason ?? 'invalid' }

  const seen = new Set<string>()
  for (const pair of contents.items) {
    const key = pair.key
    if (!isScalar(key) || typeof key.value !== 'string' || !key.range) {
      fail('invalid')
      continue
    }
    const keyFrom = block.innerFrom + key.range[0]
    const keyTo = block.innerFrom + key.range[1]
    const colonAt = colonAfter(text, keyTo)
    // No colon means the "pair" is error recovery over a line that is not a
    // mapping at all (`--- not a fence`); it is not a key, so it is not an entry.
    if (colonAt === -1) {
      fail('invalid')
      continue
    }
    let own: FmReason | undefined
    if (seen.has(key.value)) own = 'duplicate-key'
    seen.add(key.value)
    if (key.anchor) own ??= 'anchor'

    const value = (pair.value ?? null) as Node | null
    const read = readValue(text, block, key.value, value)
    if (read.reason) own ??= read.reason
    if (own) fail(own)
    const endOffset = value?.range ? block.innerFrom + value.range[1] : keyTo
    const lines: [number, number] = [
      lineIndexAt(lineStarts, keyFrom),
      lineIndexAt(lineStarts, Math.max(endOffset - 1, keyFrom)),
    ]
    entries.push({
      entry: {
        key: key.value,
        value: read.value,
        kind: read.kind,
        ...(read.legacy ? { legacy: true } : {}),
        ...(read.quoted !== undefined ? { quoted: read.quoted } : {}),
        ...(own ? { reason: own } : {}),
        lines,
      },
      keyFrom,
      keyTo,
      colonAt,
      valueTo: valueEndOf(text, block, colonAt, value, lineStarts, lines[0]),
    })
  }
  return { entries, supported: !reason, reason }
}

interface ValueRead {
  value: string | string[]
  kind: FmEntry['kind']
  /** Which written scalars were quoted: one flag, or one per item. */
  quoted?: boolean | boolean[]
  legacy?: boolean
  reason?: FmReason
}

function readValue(text: string, block: Block, key: string, value: Node | null): ValueRead {
  if (value === null) return { value: '', kind: 'scalar' }
  if (isAlias(value) || value.anchor) return { value: '', kind: 'scalar', reason: 'anchor' }
  if (isScalar(value)) {
    const scalar = scalarText(text, block, value)
    if (scalar === null) return { value: '', kind: 'scalar', reason: 'multiline' }
    return quotedNode(value) ? { value: scalar, kind: 'scalar', quoted: true } : { value: scalar, kind: 'scalar' }
  }
  if (isSeq(value)) {
    const kind = value.flow ? 'flow-list' : 'block-list'
    const items: string[] = []
    const quoted: boolean[] = []
    for (const item of value.items) {
      if (!isScalar(item)) return { value: [], kind, reason: 'nested' }
      const scalar = scalarText(text, block, item)
      if (scalar === null) return { value: [], kind, reason: 'multiline' }
      items.push(scalar)
      quoted.push(quotedNode(item))
    }
    // Obsidian before 1.4 split frontmatter tags on whitespace, and the vault
    // still holds both shapes (`tags: [a b]`, `- a b`). Only PLAIN items split:
    // a quoted item is an explicit single value, which is also how the writer
    // says "this space belongs to the value".
    const plainSpaced = value.items.some(
      (i) => isScalar(i) && i.type === 'PLAIN' && /\s/.test(String(i.value ?? ''))
    )
    if (TAG_KEYS.has(key.toLowerCase()) && plainSpaced) {
      return { value: items.flatMap((i) => i.split(/\s+/).filter(Boolean)), kind, legacy: true }
    }
    return quoted.some(Boolean) ? { value: items, kind, quoted } : { value: items, kind }
  }
  return { value: sourceOf(text, block, value), kind: 'scalar', reason: 'nested' }
}

/** Was the scalar written in quotes? Quoted text is text whatever it looks like. */
function quotedNode(node: Scalar): boolean {
  return node.type === 'QUOTE_SINGLE' || node.type === 'QUOTE_DOUBLE'
}

/** A scalar's text as written, or null when it spans lines (outside the subset). */
function scalarText(text: string, block: Block, node: Scalar): string | null {
  if (node.type === 'BLOCK_LITERAL' || node.type === 'BLOCK_FOLDED') return null
  const source = sourceOf(text, block, node)
  if (source.includes('\n')) return null
  // Quoted scalars read as their VALUE (quotes stripped, escapes resolved);
  // plain ones read as their bytes, so `1.50` and `2023-09-01` survive
  // whatever the YAML schema would have made of them.
  if (node.type === 'QUOTE_SINGLE' || node.type === 'QUOTE_DOUBLE') return String(node.value ?? '')
  return node.value === null ? '' : source.trimEnd()
}

function sourceOf(text: string, block: Block, node: Node): string {
  if (!node.range) return ''
  return text.slice(block.innerFrom + node.range[0], block.innerFrom + node.range[1])
}

/**
 * Where the value's bytes end. A missing value ends where its whitespace run
 * does — at a trailing comment or the line break — so writing one into
 * `due-date: ` or `milestone:  # tbd` disturbs neither.
 */
function valueEndOf(
  text: string,
  block: Block,
  colonAt: number,
  value: Node | null,
  lineStarts: number[],
  keyLine: number
): number {
  const lineEnd = lineEndOf(lineStarts, keyLine, text.length)
  let end: number
  if (value === null || !value.range) end = lineEnd
  else if (isScalar(value) && value.value === null) end = block.innerFrom + value.range[0]
  else end = block.innerFrom + value.range[1]
  end = Math.min(Math.max(end, colonAt + 1), lineEnd)
  // CRLF: the carriage return belongs to the line break, not to the value.
  return text[end - 1] === '\r' && end > colonAt + 1 ? end - 1 : end
}

/** The `:` immediately after a key, skipping spaces and tabs. Not found → -1. */
function colonAfter(text: string, from: number): number {
  let i = from
  while (text[i] === ' ' || text[i] === '\t') i++
  return text[i] === ':' ? i : -1
}

/** Every value of the entries under `keys`, flattened; scalars split by `split`. */
function collect(
  entries: FmEntry[],
  keys: Set<string>,
  split: (value: string) => string[]
): string[] {
  const out: string[] = []
  for (const entry of entries) {
    if (!keys.has(entry.key.toLowerCase())) continue
    if (Array.isArray(entry.value)) out.push(...entry.value)
    else out.push(...split(entry.value))
  }
  return out.map((v) => v.trim())
}

/** `tags: a, b` and `tags: a b` are both N tags — Obsidian reads both. */
function splitTagScalar(value: string): string[] {
  return value.split(/[,\s]+/)
}

const stripHash = (tag: string): string => (tag.startsWith('#') ? tag.slice(1) : tag)

/** Case-insensitive dedupe that keeps the first spelling and the order. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}
