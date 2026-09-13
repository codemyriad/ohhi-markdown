/**
 * Device-level layout preferences (chrome-shaping U2): which rails are open,
 * how wide the navigator is, which rail sections are folded. A preference
 * about this screen, on the same footing as the theme — never pushed through
 * the CRDT. Pure: parsing, clamping and toggling are unit-tested here; the
 * shell keeps the reactive copy and persists through config.ts.
 */

export interface LayoutPrefs {
  treeOpen: boolean
  /** Navigator width in px. */
  treeWidth: number
  railOpen: boolean
  /** Rail sections the user folded shut; every other section is open. */
  railFolded: string[]
}

/**
 * `collapseBelow` is the drag-to-hide threshold, deliberately BELOW `min`:
 * dragging the navigator past the point where it stops being usable means
 * "close it", and the handle ends the gesture there (P3).
 */
export const TREE_WIDTH = { min: 192, max: 640, default: 288, step: 16, collapseBelow: 120 } as const

/**
 * The rail's sections, in the order the shell stacks them. They live here
 * rather than in the component because the fold set is a layout preference:
 * the default has to name the sections that start shut, and `RailSectionId`
 * is what stops it naming one the shell does not render — or missing one.
 */
export const RAIL_SECTIONS = ['links', 'note', 'activity', 'history'] as const
export type RailSectionId = (typeof RAIL_SECTIONS)[number]

/**
 * The folded list that leaves `id` — and nothing else — open (P2). A rail icon
 * shows ITS section, so "show only" is the rail's whole fold model;
 * `toggleFolded` stays for the headers, which open a deliberate second one.
 */
export function showOnly(sections: readonly string[], id: string): string[] {
  return sections.filter((s) => s !== id)
}

export const LAYOUT_DEFAULTS: LayoutPrefs = {
  treeOpen: true,
  treeWidth: TREE_WIDTH.default,
  railOpen: true,
  // One section on a fresh install, not four stacked (P2): Links is the one
  // that is worth having open with no note in focus, so the rest start folded.
  railFolded: showOnly(RAIL_SECTIONS, 'links'),
}

export function clampTreeWidth(px: unknown): number {
  if (typeof px !== 'number' || !Number.isFinite(px)) return TREE_WIDTH.default
  return Math.min(TREE_WIDTH.max, Math.max(TREE_WIDTH.min, Math.round(px)))
}

/** Tolerant read of whatever config holds: missing, partial or garbage → defaults. */
export function normalizeLayout(raw: unknown): LayoutPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof LayoutPrefs, unknown>>
  return {
    treeOpen: typeof r.treeOpen === 'boolean' ? r.treeOpen : LAYOUT_DEFAULTS.treeOpen,
    treeWidth: clampTreeWidth(r.treeWidth),
    railOpen: typeof r.railOpen === 'boolean' ? r.railOpen : LAYOUT_DEFAULTS.railOpen,
    // An EMPTY list reads as unset, not as "every section open": it was the
    // pre-P2 default, i.e. the wall of sections P2 exists to lose, and never
    // something a person chose one fold at a time. Guessing wrong costs one
    // icon click; keeping it costs the redesign every existing profile.
    railFolded:
      Array.isArray(r.railFolded) && r.railFolded.length > 0
        ? r.railFolded.filter((s): s is string => typeof s === 'string')
        : [...LAYOUT_DEFAULTS.railFolded],
  }
}

/** Fold or unfold one section; returns a new list (state-friendly). */
export function toggleFolded(folded: string[], id: string, fold: boolean): string[] {
  const without = folded.filter((s) => s !== id)
  return fold ? [...without, id] : without
}
