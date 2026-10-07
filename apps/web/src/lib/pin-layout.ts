/**
 * Pins (foundations Round 2, P7): *Pin as a column* is a DEVICE override on
 * the layout in use, never a layout file. `config.layout.pins` holds, per
 * side, whether this device shows it as a column whatever the layout says;
 * `applyPins` lays them over the resolved spec AFTER the file resolves
 * (`resources.resolveLayout`), so a pinned side renders as a column under
 * every layout and unpinning returns it to the layout's own setting (the
 * drawer, the dock). Each side is its own key: pinning one never touches
 * the other's region.
 *
 * Pure: the shell's reactive copy and the config write live in
 * `shell-layout.svelte.ts` (`pin` / `unpin` / `pinned`).
 */
import type { ShellSpec } from './layout-spec.js'

/** The two sides a person can pin: the navigator (left) and the rail / dock (right). */
export const PIN_SIDES = ['navigator', 'rail'] as const
export type PinSide = (typeof PIN_SIDES)[number]

/** What a device pins: a side is either a column or follows the layout (absent). */
export type LayoutPins = Partial<Record<PinSide, 'column'>>

/** Tolerant read of whatever config holds: anything but `'column'` on a known side is dropped. */
export function normalizePins(raw: unknown): LayoutPins {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: LayoutPins = {}
  for (const side of PIN_SIDES) if (r[side] === 'column') out[side] = 'column'
  return out
}

/** True when any side is pinned. */
export const hasPins = (pins: LayoutPins): boolean => PIN_SIDES.some((side) => pins[side] === 'column')

/** `pins` with one side pinned or unpinned; the other side is left exactly as it was. */
export function withPin(pins: LayoutPins, side: PinSide, on: boolean): LayoutPins {
  const out: LayoutPins = { ...pins }
  if (on) out[side] = 'column'
  else delete out[side]
  return out
}

/** The spec with the pinned sides as columns; the same object when nothing changes. */
export function applyPins(spec: ShellSpec, pins: LayoutPins): ShellSpec {
  const regions = { ...spec.regions }
  let changed = false
  for (const side of PIN_SIDES) {
    if (pins[side] === 'column' && regions[side] !== 'column') {
      ;(regions as Record<PinSide, string>)[side] = 'column'
      changed = true
    }
  }
  return changed ? { ...spec, regions } : spec
}
