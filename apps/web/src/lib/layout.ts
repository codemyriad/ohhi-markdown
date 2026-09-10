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

export const TREE_WIDTH = { min: 192, max: 640, default: 288, step: 16 } as const

export const LAYOUT_DEFAULTS: LayoutPrefs = {
  treeOpen: true,
  treeWidth: TREE_WIDTH.default,
  railOpen: true,
  railFolded: [],
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
    railFolded: Array.isArray(r.railFolded)
      ? r.railFolded.filter((s): s is string => typeof s === 'string')
      : [],
  }
}

/** Fold or unfold one section; returns a new list (state-friendly). */
export function toggleFolded(folded: string[], id: string, fold: boolean): string[] {
  const without = folded.filter((s) => s !== id)
  return fold ? [...without, id] : without
}
