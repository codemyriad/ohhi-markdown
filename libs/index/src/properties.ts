/**
 * Properties as typed values, and the row filter's evaluation (collections
 * DB1, bases-shaping A1 / S17-Q1).
 *
 * Two rules keep this honest:
 *
 *  1. A value's TYPE is inferred from what the note says — `2026-01-05` is a
 *     date, `3` is a number, `[[Clusters]]` is a link — never from a side
 *     table the note does not carry. What the index says a cell is and what
 *     `grep` shows are one thing. (Obsidian keeps a `types.json`; a vault
 *     without one must still read right.)
 *  2. The filter is a closed vocabulary (`RowFilter` in types.ts), evaluated
 *     here for the in-memory backend and compilable to SQL for another.
 *     Nothing here evals a string.
 *
 * Pure and synchronous: no clock (`now` is passed in — golden rule 5), no
 * resolver of its own (`resolve` is passed in).
 */
import type { PropScalar, PropValue, Row, RowExpr, RowFilter, RowKey, RowLiteral, RowSort } from './types.js'

/** `2024-05-02`, optionally with a time and a zone — the ISO forms notes write. */
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/
/** A plain decimal. `007` and `+1` stay strings: a phone number is not a count. */
const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/
/** `[[target]]`, `[[target|alias]]`, `[[target#anchor]]` — the whole value. */
const LINK = /^\[\[([^\]|#\n]*)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]$/

export function typeScalar(raw: string): PropScalar {
  const text = raw.trim()
  if (text === '' || text === '~' || text === 'null') return { kind: 'null' }
  if (text === 'true' || text === 'false') return { kind: 'boolean', value: text === 'true' }
  if (NUMBER.test(text)) return { kind: 'number', value: Number(text) }
  if (DATE.test(text)) {
    const ms = Date.parse(text.replace(' ', 'T'))
    if (Number.isFinite(ms)) return { kind: 'date', value: text, ms }
  }
  const link = LINK.exec(text)
  if (link && link[1].trim()) {
    return { kind: 'link', target: link[1].trim(), alias: link[2]?.trim() || null, resolved: null }
  }
  return { kind: 'string', value: text }
}

/** A frontmatter entry's value, as the flat-subset reader hands it over. */
export function typeProperty(value: string | string[]): PropValue {
  if (Array.isArray(value)) return { kind: 'list', items: value.map(typeScalar) }
  return typeScalar(value)
}

/** The text a scalar compares and displays as. A link is its target. */
export function scalarText(s: PropScalar): string {
  switch (s.kind) {
    case 'null':
      return ''
    case 'string':
      return s.value
    case 'number':
      return String(s.value)
    case 'boolean':
      return s.value ? 'true' : 'false'
    case 'date':
      return s.value
    case 'link':
      return s.target
  }
}

export function propText(v: PropValue | undefined): string {
  if (!v) return ''
  return v.kind === 'list' ? v.items.map(scalarText).join(', ') : scalarText(v)
}

/** What evaluation needs from the index: the instant, and link resolution. */
export interface FilterContext {
  /** Epoch ms for `now()` / `today()`. */
  now: number
  /** A wikilink target → a vault path, or null. */
  resolve(target: string): string | null
}

// ---- evaluation ------------------------------------------------------------

/** An operand's value: a property value, or absent. */
type Val = PropValue | undefined

const NULL: PropScalar = { kind: 'null' }

function fileField(row: Row, field: Extract<RowKey, { file: string }>['file']): Val {
  switch (field) {
    case 'name':
      return { kind: 'string', value: row.name }
    case 'path':
      return { kind: 'string', value: row.path }
    case 'folder':
      return { kind: 'string', value: row.folder }
    case 'ext':
      return { kind: 'string', value: row.ext }
    case 'size':
      return { kind: 'number', value: row.size }
    case 'mtime':
      return row.mtime === null ? NULL : { kind: 'date', value: new Date(row.mtime).toISOString(), ms: row.mtime }
    case 'tags':
      return { kind: 'list', items: row.tags.map((t) => ({ kind: 'string', value: t })) }
    case 'links':
      return { kind: 'list', items: row.links.map((t) => ({ kind: 'string', value: t })) }
  }
}

export function keyValue(row: Row, key: RowKey): Val {
  return 'file' in key ? fileField(row, key.file) : row.props[key.prop]
}

function literal(lit: RowLiteral): PropScalar {
  if (lit === null) return NULL
  if (typeof lit === 'boolean') return { kind: 'boolean', value: lit }
  if (typeof lit === 'number') return { kind: 'number', value: lit }
  return typeScalar(lit)
}

/** Duration units Obsidian's grammar accepts: `7d`, `1 day`, `2 weeks`, `1M`. */
const DURATION = /(-?\d+(?:\.\d+)?)\s*(years?|y|months?|M|weeks?|w|days?|d|hours?|h|minutes?|m|seconds?|s)\b/g

function addDuration(ms: number, duration: string, sign: 1 | -1): number | null {
  DURATION.lastIndex = 0
  let out = new Date(ms)
  let any = false
  for (let m = DURATION.exec(duration); m; m = DURATION.exec(duration)) {
    any = true
    const n = Number(m[1]) * sign
    const unit = m[2]
    if (unit === 'y' || unit.startsWith('year')) out = new Date(out.setUTCFullYear(out.getUTCFullYear() + n))
    else if (unit === 'M' || unit.startsWith('month')) out = new Date(out.setUTCMonth(out.getUTCMonth() + n))
    else if (unit === 'w' || unit.startsWith('week')) out = new Date(out.getTime() + n * 7 * 86_400_000)
    else if (unit === 'd' || unit.startsWith('day')) out = new Date(out.getTime() + n * 86_400_000)
    else if (unit === 'h' || unit.startsWith('hour')) out = new Date(out.getTime() + n * 3_600_000)
    else if (unit === 'm' || unit.startsWith('minute')) out = new Date(out.getTime() + n * 60_000)
    else out = new Date(out.getTime() + n * 1000)
  }
  return any ? out.getTime() : null
}

function evalExpr(row: Row, expr: RowExpr, ctx: FilterContext): Val {
  if ('key' in expr) return keyValue(row, expr.key)
  if ('lit' in expr) return literal(expr.lit)
  if ('now' in expr) {
    const ms = expr.now === 'today' ? Math.floor(ctx.now / 86_400_000) * 86_400_000 : ctx.now
    return { kind: 'date', value: new Date(ms).toISOString(), ms }
  }
  const base = asDate(evalExpr(row, expr.dateAdd, ctx))
  if (base === null) return NULL
  const ms = addDuration(base, expr.duration, expr.sign)
  return ms === null ? NULL : { kind: 'date', value: new Date(ms).toISOString(), ms }
}

function asDate(v: Val): number | null {
  if (!v || v.kind !== 'date') return null
  return v.ms
}

function truthy(v: Val): boolean {
  if (!v) return false
  switch (v.kind) {
    case 'null':
      return false
    case 'string':
      return v.value !== ''
    case 'number':
      return v.value !== 0
    case 'boolean':
      return v.value
    case 'list':
      return v.items.length > 0
    default:
      return true
  }
}

function isEmpty(v: Val): boolean {
  if (!v) return true
  if (v.kind === 'null') return true
  if (v.kind === 'string') return v.value === ''
  if (v.kind === 'list') return v.items.length === 0
  return false
}

/**
 * Compare two scalars the way a person reading the cell would: numbers as
 * numbers, dates by instant, a link by its target or where it points, a
 * string literal against a number or date by what the literal says. Returns
 * null when the two cannot be ordered (a string against a boolean).
 */
function compareScalars(a: PropScalar, b: PropScalar, ctx: FilterContext): number | null {
  if (a.kind === 'null' || b.kind === 'null') return a.kind === b.kind ? 0 : null
  if (a.kind === 'number' && b.kind === 'number') return a.value - b.value
  if (a.kind === 'date' && b.kind === 'date') return a.ms - b.ms
  if (a.kind === 'boolean' && b.kind === 'boolean') return Number(a.value) - Number(b.value)
  if (a.kind === 'link' || b.kind === 'link') {
    if (a.kind === 'link' && b.kind === 'link') return a.target === b.target ? 0 : a.target < b.target ? -1 : 1
    const link = a.kind === 'link' ? a : (b as Extract<PropScalar, { kind: 'link' }>)
    const other = scalarText(a.kind === 'link' ? b : a)
    const resolved = link.resolved ?? ctx.resolve(link.target)
    const same =
      link.target === other ||
      basenameOf(resolved ?? '') === other ||
      resolved === other ||
      (resolved !== null && resolved === ctx.resolve(other))
    return same ? 0 : null
  }
  // A string against a typed value: re-type the string. `priority > "3"`
  // and `due < "2026-01-01"` read as a person means them. A string that
  // stays a string is compared as text below.
  if (a.kind === 'string' && b.kind !== 'string') {
    const typed = typeScalar(a.value)
    if (typed.kind !== 'string') return compareScalars(typed, b, ctx)
  }
  if (b.kind === 'string' && a.kind !== 'string') {
    const typed = typeScalar(b.value)
    if (typed.kind !== 'string') return compareScalars(a, typed, ctx)
  }
  const x = scalarText(a)
  const y = scalarText(b)
  return x === y ? 0 : x < y ? -1 : 1
}

function basenameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return (slash === -1 ? path : path.slice(slash + 1)).replace(/\.md$/i, '')
}

function scalarEquals(a: PropScalar, b: PropScalar, ctx: FilterContext): boolean {
  return compareScalars(a, b, ctx) === 0
}

function items(v: Val): PropScalar[] {
  if (!v) return []
  return v.kind === 'list' ? v.items : v.kind === 'null' ? [] : [v]
}

function contains(target: Val, value: Val, ctx: FilterContext): boolean {
  if (!target || !value) return false
  if (target.kind === 'string') return value.kind !== 'list' && target.value.includes(scalarText(value))
  const wanted = items(value)
  return items(target).some((item) => wanted.some((w) => scalarEquals(item, w, ctx)))
}

export function matchesFilter(row: Row, filter: RowFilter, ctx: FilterContext): boolean {
  switch (filter.op) {
    case 'and':
      return filter.args.every((f) => matchesFilter(row, f, ctx))
    case 'or':
      return filter.args.some((f) => matchesFilter(row, f, ctx))
    case 'not':
      return !matchesFilter(row, filter.arg, ctx)
    case 'truthy':
      return truthy(evalExpr(row, filter.arg, ctx))
    case 'cmp': {
      const left = evalExpr(row, filter.left, ctx)
      const right = evalExpr(row, filter.right, ctx)
      if (filter.cmp === '==' || filter.cmp === '!=') {
        const equal = equalVals(left, right, ctx)
        return filter.cmp === '==' ? equal : !equal
      }
      const l = left && left.kind !== 'list' ? left : null
      const r = right && right.kind !== 'list' ? right : null
      if (!l || !r) return false
      const c = compareScalars(l, r, ctx)
      if (c === null) return false
      switch (filter.cmp) {
        case '<':
          return c < 0
        case '<=':
          return c <= 0
        case '>':
          return c > 0
        case '>=':
          return c >= 0
      }
      return false
    }
    case 'hasTag': {
      const have = row.tags.map((t) => t.toLowerCase())
      return filter.tags.some((raw) => {
        const want = (raw.startsWith('#') ? raw.slice(1) : raw).toLowerCase()
        return have.some((t) => t === want || t.startsWith(`${want}/`))
      })
    }
    case 'hasLink': {
      const resolved = ctx.resolve(filter.target)
      return resolved !== null && row.links.includes(resolved)
    }
    case 'inFolder': {
      const folder = filter.folder.replace(/^\/+|\/+$/g, '')
      return folder === '' || row.folder === folder || row.folder.startsWith(`${folder}/`)
    }
    case 'hasProperty':
      return Object.prototype.hasOwnProperty.call(row.props, filter.key)
    case 'contains':
      return contains(evalExpr(row, filter.target, ctx), evalExpr(row, filter.value, ctx), ctx)
    case 'containsAny': {
      const target = evalExpr(row, filter.target, ctx)
      return filter.values.some((v) => contains(target, evalExpr(row, v, ctx), ctx))
    }
    case 'containsAll': {
      const target = evalExpr(row, filter.target, ctx)
      return filter.values.every((v) => contains(target, evalExpr(row, v, ctx), ctx))
    }
    case 'isEmpty':
      return isEmpty(evalExpr(row, filter.target, ctx))
    case 'startsWith': {
      const t = evalExpr(row, filter.target, ctx)
      const v = evalExpr(row, filter.value, ctx)
      return !!t && !!v && t.kind !== 'list' && v.kind !== 'list' && scalarText(t).startsWith(scalarText(v))
    }
    case 'endsWith': {
      const t = evalExpr(row, filter.target, ctx)
      const v = evalExpr(row, filter.value, ctx)
      return !!t && !!v && t.kind !== 'list' && v.kind !== 'list' && scalarText(t).endsWith(scalarText(v))
    }
  }
}

/** `==` over any two values: lists element-wise, an absent value as null. */
function equalVals(a: Val, b: Val, ctx: FilterContext): boolean {
  const x = a ?? NULL
  const y = b ?? NULL
  if (x.kind === 'list' || y.kind === 'list') {
    const xs = items(x)
    const ys = items(y)
    // A one-item list equals its item (`tags == "a"` on `tags: [a]`).
    if (x.kind === 'list' && y.kind === 'list') {
      return xs.length === ys.length && xs.every((i, n) => scalarEquals(i, ys[n], ctx))
    }
    return xs.length === 1 && ys.length === 1 && scalarEquals(xs[0], ys[0], ctx)
  }
  return scalarEquals(x, y, ctx)
}

// ---- ordering --------------------------------------------------------------

/** Natural, case-insensitive text order; exact text breaks a tie. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function orderScalars(a: PropScalar, b: PropScalar): number {
  if (a.kind === 'number' && b.kind === 'number') return a.value - b.value
  if (a.kind === 'date' && b.kind === 'date') return a.ms - b.ms
  if (a.kind === 'boolean' && b.kind === 'boolean') return Number(a.value) - Number(b.value)
  const x = scalarText(a)
  const y = scalarText(b)
  return collator.compare(x, y) || (x === y ? 0 : x < y ? -1 : 1)
}

/**
 * The sort comparator: each `RowSort` in turn, empty values LAST whichever
 * the direction, then the path so pages never shuffle between queries.
 */
export function compareRows(a: Row, b: Row, sort: readonly RowSort[]): number {
  for (const s of sort) {
    const x = keyValue(a, s.key)
    const y = keyValue(b, s.key)
    const ex = isEmpty(x)
    const ey = isEmpty(y)
    if (ex || ey) {
      if (ex && ey) continue
      return ex ? 1 : -1
    }
    const xs = x!.kind === 'list' ? { kind: 'string' as const, value: propText(x) } : (x as PropScalar)
    const ys = y!.kind === 'list' ? { kind: 'string' as const, value: propText(y) } : (y as PropScalar)
    const c = orderScalars(xs, ys)
    if (c !== 0) return s.direction === 'desc' ? -c : c
  }
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
}
