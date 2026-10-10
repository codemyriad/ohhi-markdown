/**
 * Settings › Keys, the table's pure half (settings-shaping ST3, K1): which
 * rows a search, a pressed chord or a filter chip leaves, how they group, and
 * what a row's chord list becomes when a chip is re-recorded, removed or
 * added. No Svelte, no registry instance — the component hands in the rows
 * (`CommandRegistry.bindings`) and the registry's `format`.
 */
import type { CommandBinding } from './commands.js'

/** The filter chips, in order. */
export const HOTKEY_FILTERS = ['all', 'changed', 'clashes', 'unbound'] as const
export type HotkeyFilter = (typeof HOTKEY_FILTERS)[number]

/** A chord as it is pressed on this platform (`CommandRegistry.format`). */
export type FormatChord = (keys: string) => string

/** The chords a command ships with: its default, or none. */
export const defaultChords = (row: Pick<CommandBinding, 'defaultKeys'>): string[] =>
  row.defaultKeys ? [row.defaultKeys] : []

/**
 * The row's keys differ from what the command ships with — the one case the
 * row shows its default and a Reset. Compared as pressed, so `Mod+W` and
 * `Mod+w` are the same key.
 */
export function isChanged(row: Pick<CommandBinding, 'chords' | 'defaultKeys'>, format: FormatChord): boolean {
  const now = row.chords.map(format)
  const shipped = defaultChords(row).map(format)
  return now.length !== shipped.length || now.some((c, i) => c !== shipped[i])
}

/** Another command has the same chord, or the desktop takes it first: both are a key that will not do what it says. */
export const isClash = (row: Pick<CommandBinding, 'conflicts' | 'reserved'>): boolean =>
  row.conflicts.length > 0 || row.reserved

export function passesFilter(row: CommandBinding, filter: HotkeyFilter, format: FormatChord): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'changed':
      return isChanged(row, format)
    case 'clashes':
      return isClash(row)
    case 'unbound':
      return row.chords.length === 0
  }
}

/** How many rows each chip would leave. */
export function filterCounts(rows: readonly CommandBinding[], format: FormatChord): Record<HotkeyFilter, number> {
  const out = { all: 0, changed: 0, clashes: 0, unbound: 0 }
  for (const row of rows) for (const f of HOTKEY_FILTERS) if (passesFilter(row, f, format)) out[f]++
  return out
}

/**
 * Typed search: every word must appear in the title, the id or one of the
 * keys as pressed (`ctrl+e` finds the row showing `Ctrl+E`). Case-insensitive.
 */
export function matchesText(row: CommandBinding, query: string, format: FormatChord): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = [row.title, row.id, ...row.chords.map(format)].join('\n').toLowerCase()
  return words.every((w) => hay.includes(w))
}

/** "Press keys" search: the row runs on this chord (as pressed — `Ctrl+Mod+X` and `Ctrl+Alt+X` are one press off a Mac). */
export function matchesChord(row: Pick<CommandBinding, 'chords'>, chord: string, format: FormatChord): boolean {
  const pressed = format(chord)
  return row.chords.some((c) => format(c) === pressed)
}

export interface HotkeyQuery {
  text: string
  /** A chord pressed in "press keys" mode; it wins over `text`. */
  chord: string | null
  filter: HotkeyFilter
}

/** The rows a query leaves, in registry order. */
export function filterRows(rows: readonly CommandBinding[], q: HotkeyQuery, format: FormatChord): CommandBinding[] {
  return rows.filter(
    (row) =>
      passesFilter(row, q.filter, format) &&
      (q.chord !== null ? matchesChord(row, q.chord, format) : matchesText(row, q.text, format))
  )
}

export interface HotkeyGroup {
  label: string
  rows: CommandBinding[]
  /** Rows in the group whose keys differ from the defaults (the header's dot). */
  changed: number
}

/** Rows bucketed by their palette group, groups in first-seen order; a command with no group goes under `ungrouped`. */
export function groupRows(rows: readonly CommandBinding[], ungrouped: string, format: FormatChord): HotkeyGroup[] {
  const out: HotkeyGroup[] = []
  for (const row of rows) {
    const label = row.group || ungrouped
    let bucket = out.find((b) => b.label === label)
    if (!bucket) out.push((bucket = { label, rows: [], changed: 0 }))
    bucket.rows.push(row)
    if (isChanged(row, format)) bucket.changed++
  }
  return out
}

/**
 * Where a recorded chord goes: over chip `at`, or appended (`'add'`). A
 * chord the row already has (as pressed) is not added twice — re-recording a
 * chip onto another chip of the same row merges the two.
 */
export function withChord(chords: readonly string[], chord: string, at: number | 'add', format: FormatChord): string[] {
  const next = [...chords]
  if (at === 'add' || at >= next.length) next.push(chord)
  else next[at] = chord
  const seen = new Set<string>()
  return next.filter((c) => {
    const k = format(c)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The row's chords without chip `at`. */
export const withoutChord = (chords: readonly string[], at: number): string[] => chords.filter((_, i) => i !== at)
