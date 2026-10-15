/**
 * Settings › Layout's formatting-bar picker (E6), the pure half: the two
 * rows (the bar's items in order, with separators; the commands not on it),
 * every move between and within them, and the device override it writes.
 *
 * The picker reads the RESOLVED `bars.format` (the layout file plus this
 * device's overrides) and writes `overrides.bars.format` as a full plain
 * list — never a `+id` / `-id` delta, so what is stored reads as the bar
 * you see, whatever the file later says. A list equal to the file's own is
 * no override at all. Config, never a layout file (the app never writes one).
 *
 * Every list a function here answers is TIDY, the way the layout grammar
 * resolves one (runs of `"|"` collapse, none at either end), so the picker
 * never shows a separator the bar would not draw.
 */
import { COMMAND_IDS, TOOLBAR_ITEM_IDS } from './command-ids.js'
import { SEPARATOR, type LayoutFile, type ShellSpec } from './layout-spec.js'

/**
 * Everything the bar can show, in the order the hidden row lists it: the
 * grouped paragraph-style menu, then every `format.*` command in the command
 * table's order (`format.rule` is one — off the default bar, still pickable),
 * then the bar's one non-format verb, `note.comment` (the door to a comment,
 * QA round 1).
 */
export const BAR_EXTRA_IDS: readonly string[] = ['note.comment']
export const BAR_CANDIDATES: readonly string[] = [
  ...TOOLBAR_ITEM_IDS,
  ...COMMAND_IDS.filter((id) => id.startsWith('format.')),
  ...BAR_EXTRA_IDS,
]

/** Separators collapsed and trimmed, as `applyList` resolves a list. */
export function tidyBar(list: readonly string[]): string[] {
  const out: string[] = []
  for (const id of list) {
    if (id === SEPARATOR && (out.length === 0 || out[out.length - 1] === SEPARATOR)) continue
    out.push(id)
  }
  while (out[out.length - 1] === SEPARATOR) out.pop()
  return out
}

export interface PickerRows {
  /** The bar, in order, separators included. */
  shown: string[]
  /** What is not on it, in `BAR_CANDIDATES` order. Never holds a separator: one is always on offer. */
  hidden: string[]
}

/** The two rows for a resolved bar. An id the picker does not know stays on the bar, untouched. */
export function pickerRows(bar: readonly string[], candidates: readonly string[] = BAR_CANDIDATES): PickerRows {
  const shown = tidyBar(bar)
  return { shown, hidden: candidates.filter((id) => !shown.includes(id)) }
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n))

/** Move the item at `from` so it sits at index `to` of the result. */
export function moveTo(list: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= list.length) return tidyBar(list)
  const out = [...list]
  const [item] = out.splice(from, 1)
  out.splice(clamp(to, 0, out.length), 0, item!)
  return tidyBar(out)
}

/** One step left (-1) or right (+1); at an end, nothing changes. */
export function moveBy(list: readonly string[], index: number, delta: -1 | 1): string[] {
  return moveTo(list, index, index + delta)
}

/** Take the item at `index` off the bar (a separator simply goes). */
export function hideAt(list: readonly string[], index: number): string[] {
  if (index < 0 || index >= list.length) return tidyBar(list)
  return tidyBar(list.filter((_, i) => i !== index))
}

/**
 * Put `id` on the bar at `at` (default: the end). A separator is never put
 * at the very end — it would be trimmed away at once — so by default it goes
 * in before the last item, where it shows and can be moved on from.
 */
export function showAt(list: readonly string[], id: string, at?: number): string[] {
  if (id !== SEPARATOR && list.includes(id)) return tidyBar(list)
  const end = id === SEPARATOR ? Math.max(0, list.length - 1) : list.length
  const out = [...list]
  out.splice(clamp(at ?? end, 0, list.length), 0, id)
  return tidyBar(out)
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The device overrides with `bars.format` set to `list` as a plain list —
 * or dropped, when `list` is the file's own bar. Every other override stays
 * as it was.
 */
export function withFormatBar(overrides: LayoutFile, fileSpec: Pick<ShellSpec, 'bars'>, list: readonly string[]): LayoutFile {
  const bar = tidyBar(list)
  const { bars, ...rest } = overrides
  const others = { ...bars }
  delete others.format
  const next: LayoutFile = { ...rest }
  if (!sameList(bar, tidyBar(fileSpec.bars.format))) others.format = bar
  if (Object.keys(others).length > 0) next.bars = others
  return next
}

/** True when this device's overrides change the bar. */
export const barOverridden = (overrides: LayoutFile): boolean => overrides.bars?.format !== undefined

/** The overrides without the bar: *Reset to layout file*. */
export function withoutFormatBar(overrides: LayoutFile): LayoutFile {
  if (!barOverridden(overrides)) return overrides
  const { bars, ...rest } = overrides
  const others = { ...bars }
  delete others.format
  return Object.keys(others).length > 0 ? { ...rest, bars: others } : rest
}

/** A stable key per pill: the id, and a separator's occurrence (`|#2`). */
export function pillKeys(list: readonly string[]): string[] {
  let n = 0
  return list.map((id) => (id === SEPARATOR ? `${SEPARATOR}#${n++}` : id))
}
