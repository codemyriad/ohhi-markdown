/**
 * A note's frontmatter as the contract's `Frontmatter` document: the ONE
 * reader (`@ohhi/frontmatter`, read-shaping B4) for the block's shape and
 * positions, and the index's typing rules (`typeScalar`) for what each
 * value is — so `ohhi fm`, `ohhi rows` and the app's table all say a cell
 * is a number, a date or text for the same reasons. A quoted scalar is
 * text whatever it looks like: `"8"` is the string `8`, as YAML means it.
 *
 * Nothing here writes YAML; `ops/fm.ts` writes through the patcher.
 */
import { parseFrontmatter, type FmEntry } from '@ohhi/frontmatter'
import { typeScalar, type PropScalar } from '@ohhi/index'
import type { z } from 'zod'
import type { Frontmatter, FrontmatterEntry } from './contract.js'

type Entry = z.infer<typeof FrontmatterEntry>
type Scalar = Extract<Entry['value'], string | number | boolean | null>
export type FrontmatterRead = z.infer<typeof Frontmatter>

const absent: FrontmatterRead = { present: false, supported: true }

/** The contract's scalar for one written value. A quoted wikilink is still a link's text. */
function scalarOf(raw: string, quoted: boolean): { value: Scalar; type: Entry['type'] } {
  const typed: PropScalar = typeScalar(raw)
  if (quoted && typed.kind !== 'link') return { value: raw, type: 'string' }
  switch (typed.kind) {
    case 'null':
      return { value: null, type: 'null' }
    case 'number':
      return { value: typed.value, type: 'number' }
    case 'boolean':
      return { value: typed.value, type: 'boolean' }
    case 'date':
      return { value: typed.value, type: 'date' }
    // A link is the text written (`[[x]]`): `resolve` says where it points.
    case 'link':
    case 'string':
      return { value: raw.trim(), type: 'string' }
  }
}

function entryOf(e: FmEntry): Entry {
  const line = e.lines[0] + 1
  if (Array.isArray(e.value)) {
    const quoted = Array.isArray(e.quoted) ? e.quoted : []
    return { key: e.key, value: e.value.map((item, i) => scalarOf(item, quoted[i] === true).value), type: 'list', line }
  }
  const { value, type } = scalarOf(e.value, e.quoted === true)
  return { key: e.key, value, type, line }
}

/**
 * Read the frontmatter block of a note. `text` is the whole note (decoded,
 * LF-normalized); entry `line` numbers are 1-based lines OF THE NOTE, so a
 * caller can go straight from a key to `read --lines`.
 */
export function readFrontmatter(text: string): FrontmatterRead {
  const fm = parseFrontmatter(text)
  if (!fm.present) return absent
  const raw = text.slice(0, fm.end)
  if (!fm.supported) return { present: true, raw, supported: false }
  return { present: true, raw, entries: fm.entries.map(entryOf), supported: true }
}
