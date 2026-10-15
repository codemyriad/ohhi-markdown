/**
 * Writing the block, one line-range at a time (Fork 4-A).
 *
 * Golden rule 2 in one sentence: an op produces AT MOST ONE `FmChange`, over
 * the bytes of one value or one entry's lines, and every other byte of the
 * document — key order, quoting, comments, blank lines, the body — comes out
 * identical. `yaml` is never asked to serialize a document; only single
 * scalars go through `stringify`, so nothing can re-flow.
 *
 * Refusal is a feature (R4.4): a block outside the flat subset is left alone
 * rather than repaired, and the caller shows it as the text it is.
 */
import { stringify } from 'yaml'
import { lineLimitOf, readBlock, TAG_KEYS, type RawEntry } from './parse.js'
import type { FmChange, FmOp, FmPatchResult, FmScalar } from './types.js'

export function patchFrontmatter(text: string, op: FmOp): FmPatchResult {
  const bad = rejectOp(op)
  if (bad) return { ok: false, reason: bad }

  const read = readBlock(text)
  if (read.block && !read.supported) return { ok: false, reason: read.reason ?? 'unsupported' }
  const find = (key: string): RawEntry | undefined =>
    read.entries.find((e) => e.entry.key === key)
  const lineRange = (entry: RawEntry): [number, number] => [
    read.lineStarts[entry.entry.lines[0]],
    lineLimitOf(read.lineStarts, entry.entry.lines[1], text.length),
  ]

  if (op.op === 'remove') {
    // Unset is idempotent: a key that is not there is already unset, and
    // saying so with zero changes keeps the no-churn promise.
    const entry = find(op.key)
    if (!entry) return { ok: true, text, changes: [] }
    const [from, to] = lineRange(entry)
    return edit(text, { from, to, insert: '' })
  }

  if (op.op === 'rename') {
    const entry = find(op.key)
    if (!entry) return { ok: false, reason: 'missing-key' }
    if (op.to === op.key) return { ok: true, text, changes: [] }
    if (find(op.to)) return { ok: false, reason: 'duplicate-key' }
    return edit(text, { from: entry.keyFrom, to: entry.keyTo, insert: renderScalar(op.to) })
  }

  const entry = find(op.key)
  if (!entry) {
    const block = renderEntry(renderScalar(op.key), op.value)
    // No block at all: the note gets one, and nothing else moves.
    if (!read.block) return edit(text, { from: 0, to: 0, insert: `---\n${block}---\n` })
    const at = read.lineStarts[read.block.closeLine]
    return edit(text, { from: at, to: at, insert: block })
  }

  if (!Array.isArray(op.value) && entry.entry.kind === 'scalar') {
    // The one-line case: only the value's bytes move. The key's spelling, the
    // `:`, the spacing and any trailing comment are untouched.
    const spacer = text[entry.valueTo] === '#' ? ' ' : ''
    const insert = (op.value === '' ? '' : ` ${renderScalar(op.value)}`) + spacer
    return edit(text, { from: entry.colonAt + 1, to: entry.valueTo, insert })
  }

  // A list, or a scalar replacing a list: the entry's whole line range is
  // rewritten — with its key's source bytes, so the spelling survives.
  const [from, to] = lineRange(entry)
  const insert = renderEntry(text.slice(entry.keyFrom, entry.keyTo), op.value)
  return edit(text, { from, to, insert })
}

/** Ops the flat subset cannot express, rejected before anything is read. */
function rejectOp(op: FmOp): string | null {
  const keys = op.op === 'rename' ? [op.key, op.to] : [op.key]
  for (const key of keys) {
    if (!key.trim()) return 'invalid-key'
    if (/[\n\r]/.test(key)) return 'multiline'
  }
  if (op.op === 'set') {
    const values = Array.isArray(op.value) ? op.value : [op.value]
    // A value with a line break is a block scalar, which the subset refuses
    // on read; writing one would make the note unpatchable by its own writer.
    if (values.some((v) => typeof v === 'string' && /[\n\r]/.test(v))) return 'multiline'
    if (values.some((v) => typeof v === 'number' && !Number.isFinite(v))) return 'invalid-value'
  }
  return null
}

/** `key: value\n`, or `key:` + one `  - item` line each (Obsidian's own shape). */
function renderEntry(key: string, value: FmScalar | FmScalar[]): string {
  if (!Array.isArray(value)) return value === '' ? `${key}:\n` : `${key}: ${renderScalar(value)}\n`
  // An empty list must read back as a list, not as an empty scalar.
  if (value.length === 0) return `${key}: []\n`
  const quoteSpaces = TAG_KEYS.has(key.replace(/^['"]|['"]$/g, '').toLowerCase())
  return (
    `${key}:\n` +
    value.map((item) => `  - ${renderScalar(item, quoteSpaces)}\n`).join('')
  )
}

/**
 * One scalar, quoted only where a plain one would read back as something else
 * (`1.50`, `true`, `#ccc`, a leading space). `quoteSpaces` additionally quotes
 * a value containing whitespace, which is how a tag list says "one item" —
 * a plain `- a b` is Obsidian's pre-1.4 pair of tags (see parse.ts). A number
 * or a boolean is written plain: it is MEANT to read back as one.
 */
function renderScalar(value: FmScalar, quoteSpaces = false): string {
  if (typeof value !== 'string') return String(value)
  const quoted = quoteSpaces && /\s/.test(value)
  return stringify(value, {
    lineWidth: 0,
    ...(quoted ? { defaultStringType: 'QUOTE_DOUBLE' as const } : {}),
  }).trimEnd()
}

/** Apply one change — or none, when the bytes it would write are already there. */
function edit(text: string, change: FmChange): FmPatchResult {
  if (text.slice(change.from, change.to) === change.insert) return { ok: true, text, changes: [] }
  return {
    ok: true,
    text: text.slice(0, change.from) + change.insert + text.slice(change.to),
    changes: [change],
  }
}
