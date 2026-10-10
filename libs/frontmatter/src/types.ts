/**
 * THE FRONTMATTER CONTRACT (read-shaping.md B4, Fork 4-A).
 *
 * One patcher serves the widget, the CLI's `fm set/unset` and every agent
 * (R4.5) — there is no second frontmatter writer. Its scope is the FLAT
 * SUBSET: top-level `key: scalar`, flow lists and block lists of scalars,
 * with comments and blank lines as opaque untouched lines. Anything else
 * (nesting, multi-line scalars, anchors, duplicate keys, invalid YAML) is
 * refused and never "fixed" (R4.4) — in the editor it is simply text.
 *
 * Reading uses `yaml`'s parser for positions and scalar typing; writing is
 * line-oriented and by hand, so no line the caller did not change is ever
 * re-emitted (golden rule 2).
 */

/** Why a block is outside the flat subset. `invalid` covers YAML the parser rejected. */
export type FmReason = 'nested' | 'multiline' | 'anchor' | 'invalid' | 'duplicate-key'

export interface FmEntry {
  key: string
  /** scalar text as written (unquoted where YAML would unquote it), or list items */
  value: string | string[]
  kind: 'scalar' | 'flow-list' | 'block-list'
  /** `tags: [a b]` — Obsidian's pre-1.4 space-separated flow list; read as N items, written back as a block list */
  legacy?: boolean
  /**
   * Why THIS entry is outside the flat subset (a nested map, a block
   * scalar, an anchor, a duplicate of an earlier key). Entries without one
   * are readable cells even when the block as a whole is `supported: false`.
   */
  reason?: FmReason
  /** 0-based inclusive line range of this entry inside the document */
  lines: [from: number, to: number]
}

export interface Frontmatter {
  /** a `---` block at offset 0 with a closing `---`/`...` line */
  present: boolean
  /** every entry is in the flat subset; comments and blank lines are fine */
  supported: boolean
  /** why not supported */
  reason?: FmReason
  /** offset of the first body character (0 when !present) */
  end: number
  /**
   * Every top-level `key:` pair, in document order. When `supported` is
   * false these are best-effort: the keys and their line ranges are right,
   * and a value the flat subset cannot hold reads as its source text.
   */
  entries: FmEntry[]
  /** from `tags` or `tag`: list, comma string, space string, `#` stripped, deduped case-insensitively, order kept */
  tags: string[]
  /** from `aliases` or `alias`; never split on spaces — an alias is a phrase */
  aliases: string[]
}

/**
 * A value the patcher writes. A STRING is written as text — quoted where a
 * plain scalar would read back as something else (`"true"`, `"8"`). A
 * NUMBER or BOOLEAN is written plain, so a cell editor can set `score: 8`
 * and `done: true` and the note means what the table showed.
 */
export type FmScalar = string | number | boolean

export type FmOp =
  /** scalar or list; a list is written as a block list */
  | { op: 'set'; key: string; value: FmScalar | FmScalar[] }
  | { op: 'remove'; key: string }
  | { op: 'rename'; key: string; to: string }

/** A text edit against the document the op was computed from. */
export type FmChange = { from: number; to: number; insert: string }

export type FmPatchResult =
  | { ok: true; text: string; changes: FmChange[] }
  | { ok: false; reason: string }
