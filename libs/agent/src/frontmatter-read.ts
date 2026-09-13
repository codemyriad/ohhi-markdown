/**
 * A READ-ONLY flat-subset frontmatter reader — A TEMPORARY STAND-IN.
 *
 * `libs/frontmatter` (read-shaping X3) is the real thing: a surgical,
 * byte-preserving patcher built around golden rule 2. When it lands, DELETE
 * this file and point `ops/fm.ts` and `ops/read.ts` at it; the `Frontmatter`
 * shape in `contract.ts` was written to be what that package will produce.
 *
 * Nothing here ever writes YAML, and nothing here ever will: `fm` is a read
 * op, and the skill says so. A vault has one authority on its own bytes and
 * it is not a reader's guess at how to re-emit them.
 *
 * "Flat subset" is measured, not arbitrary: 17 of the real vault's 1,037
 * notes carry frontmatter at all, and every one of them is `key: scalar`,
 * `key: [a, b]` or a `-` block list. Anything else — a nested map, an anchor,
 * a multi-line literal — sets `supported: false` and hands back the raw block
 * only, which is honest and costs the caller one extra read.
 */
import type { z } from 'zod'
import type { Frontmatter, FrontmatterEntry } from './contract.js'

type Entry = z.infer<typeof FrontmatterEntry>
type Scalar = Extract<Entry['value'], string | number | boolean | null>
export type FrontmatterRead = z.infer<typeof Frontmatter>

const FENCE = '---'
/** `2024-05-02`, and the same with a time — the only dates the vault writes. */
const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/
const KEY_LINE = /^([A-Za-z_][\w .-]*):(.*)$/
const LIST_ITEM = /^-[ \t]*(.*)$/

const absent: FrontmatterRead = { present: false, supported: true }

/** The block's own text (fences included) plus the line it starts on, or null. */
function fencedBlock(text: string): { raw: string; lines: string[] } | null {
  const all = text.split('\n')
  if (all[0]?.trimEnd() !== FENCE) return null
  const end = all.findIndex((line, i) => i > 0 && line.trimEnd() === FENCE)
  if (end === -1) return null
  return { raw: `${all.slice(0, end + 1).join('\n')}\n`, lines: all.slice(1, end) }
}

function scalar(raw: string): { value: Scalar; type: Entry['type'] } | null {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null') return { value: null, type: 'null' }
  if (text === 'true' || text === 'false') return { value: text === 'true', type: 'boolean' }
  const quoted = /^"(.*)"$/.exec(text) ?? /^'(.*)'$/.exec(text)
  if (quoted) return { value: quoted[1], type: 'string' }
  if (/^-?\d+(\.\d+)?$/.test(text)) return { value: Number(text), type: 'number' }
  if (DATE.test(text)) return { value: text, type: 'date' }
  // A bare `{` or an inline map is outside the subset; the caller refuses.
  if (text.startsWith('{') || text.startsWith('&') || text.startsWith('*') || text === '|' || text === '>') {
    return null
  }
  return { value: text, type: 'string' }
}

/** `[a, b, c]` — flow lists of scalars only. */
function flowList(raw: string): Scalar[] | null {
  const inner = raw.trim().slice(1, -1).trim()
  if (inner === '') return []
  const items: Scalar[] = []
  for (const part of inner.split(',')) {
    const parsed = scalar(part)
    if (!parsed) return null
    items.push(parsed.value)
  }
  return items
}

/**
 * Read the frontmatter block of a note. `text` is the whole note (decoded,
 * LF-normalized); entry `line` numbers are 1-based lines OF THE NOTE, so a
 * caller can go straight from a key to `read --lines`.
 */
export function readFrontmatter(text: string): FrontmatterRead {
  const block = fencedBlock(text)
  if (!block) return absent
  const { raw, lines } = block
  const unsupported: FrontmatterRead = { present: true, raw, supported: false }

  const entries: Entry[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    // Indentation at top level means a nested map (or a continuation): refuse.
    if (/^\s/.test(line)) return unsupported
    const m = KEY_LINE.exec(line)
    if (!m) return unsupported
    const key = m[1].trim()
    const rest = m[2]
    // Line of the key in the NOTE: line 1 is the opening fence, so +2.
    const at = i + 2

    if (rest.trim().startsWith('[')) {
      const items = flowList(rest)
      if (!items) return unsupported
      entries.push({ key, value: items, type: 'list', line: at })
      continue
    }
    if (rest.trim() === '') {
      // Either a null value or a `-` block list on the following lines. A
      // following line that is neither ends the list; the outer loop then
      // sees it, finds it indented, and refuses the whole block.
      const items: Scalar[] = []
      let j = i + 1
      while (j < lines.length) {
        const next = lines[j]
        if (next.trim() === '') {
          j++
          continue
        }
        const item = LIST_ITEM.exec(next.trim())
        if (!item) break
        const parsed = scalar(item[1])
        if (!parsed) return unsupported
        items.push(parsed.value)
        j++
      }
      if (items.length > 0) {
        entries.push({ key, value: items, type: 'list', line: at })
        i = j - 1
        continue
      }
      entries.push({ key, value: null, type: 'null', line: at })
      continue
    }
    const parsed = scalar(rest)
    if (!parsed) return unsupported
    entries.push({ key, value: parsed.value, type: parsed.type, line: at })
  }
  return { present: true, raw, entries, supported: true }
}
