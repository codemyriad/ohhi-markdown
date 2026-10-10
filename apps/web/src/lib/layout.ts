/**
 * Device-level layout preferences (chrome-shaping U2; quiet-shell F2): WHICH
 * layout file is active and how wide the navigator is. A preference about this screen, on the same footing as the theme —
 * never pushed through the CRDT. Which columns are open is no longer stored:
 * the active layout's spec seeds it (`layout-spec.ts`), and the toggles are
 * session-only. Pure: parsing, clamping and toggling are unit-tested here;
 * the shell keeps the reactive copy and persists through config.ts.
 */
import { BUILTIN_LAYOUTS, EXAMPLE_FILES, layoutAlias, type BuiltinLayout } from './layout-spec.js'
import { choiceName, parseChoice, type Choice } from './resource-kind.js'

/** The layout a device has chosen: a shipped one, or a file by name. */
export type LayoutChoice = Choice<BuiltinLayout>

export interface LayoutPrefs {
  active: LayoutChoice
  /** Navigator width in px. */
  treeWidth: number
}

/** A stored or URL-given choice, or null when it is not one. */
export function parseLayoutChoice(raw: unknown): LayoutChoice | null {
  // A choice stored before the rename (`default` → `light`) is read as the new name.
  return parseChoice(typeof raw === 'string' ? layoutAlias(raw) : raw, BUILTIN_LAYOUTS)
}

/**
 * A `?layout=` value (a SESSION-only choice, `params.ts`): a choice as above,
 * except that an example's name (`dense`) is that example file —
 * `custom:dense`, which the built-in root answers — rather than the retired
 * built-in it once was. What the e2e fixtures boot every spec in.
 */
export function parseLayoutParam(raw: unknown): LayoutChoice | null {
  if (typeof raw === 'string' && Object.hasOwn(EXAMPLE_FILES, raw)) return `custom:${raw}`
  return parseLayoutChoice(raw)
}

/** The file name a choice resolves by: `custom:writing` → `writing`. */
export const layoutName: (choice: LayoutChoice) => string = choiceName

/**
 * `collapseBelow` is the drag-to-hide threshold, deliberately BELOW `min`:
 * dragging the navigator past the point where it stops being usable means
 * "close it", and the handle ends the gesture there (P3).
 */
export const TREE_WIDTH = { min: 192, max: 640, default: 288, step: 16, collapseBelow: 120 } as const

/**
 * The dock's tabs (Round 2 P4), in order — one per section, the same in the
 * floating panel and the pinned column. They live here rather than in the
 * component because the shell's one active tab (`shell-layout`) is typed by
 * them: `RailSectionId` is what stops it naming a tab the dock does not render.
 */
// *This note* dissolved (sharing Fork 6-B): its facts live in the
// breadcrumb's folder popover, the Shared view's People and the share sheet.
export const RAIL_SECTIONS = ['links', 'history', 'comments'] as const
export type RailSectionId = (typeof RAIL_SECTIONS)[number]

/**
 * Which form the dock takes (Round 2 P4): the pinned column, or the floating
 * strip-and-panel over the editor. Anything but `column` is the dock — a
 * pre-dock file's `menu` included.
 */
export function railForm(regions: { rail: string }): 'column' | 'dock' {
  return regions.rail === 'column' ? 'column' : 'dock'
}

/** The dock's tab, or null when `id` is not one. */
export function railSection(id: unknown): RailSectionId | null {
  return (RAIL_SECTIONS as readonly unknown[]).includes(id) ? (id as RailSectionId) : null
}

export const LAYOUT_DEFAULTS: LayoutPrefs = {
  active: 'default',
  treeWidth: TREE_WIDTH.default,
}

export function clampTreeWidth(px: unknown): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) return TREE_WIDTH.default
  return Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, Math.round(px)))
}

/**
 * Tolerant read of whatever config holds: missing, partial or garbage →
 * defaults. A config from before layouts (`treeOpen`/`railOpen` booleans and
 * no `active`) simply reads as `default`; the booleans are dropped, and so is
 * a pre-dock `railFolded` list (the dock has one active tab, not folds).
 */
export function normalizeLayout(raw: unknown): LayoutPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LayoutPrefs, unknown>>
  return {
    active: parseLayoutChoice(r.active) ?? LAYOUT_DEFAULTS.active,
    treeWidth: clampTreeWidth(r.treeWidth),
  }
}
