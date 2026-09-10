/**
 * The pane tree and the saved-group list, per vault, on this device
 * (tab-groups-shaping B6, Fork 3-A).
 *
 * Device-local by decision, not by convenience: the measured vault carries 15
 * `workspace.sync-conflict-*` files going back to 2022, which is Obsidian
 * proving that syncing layout state is the one thing this vault does not want
 * (R4.3). So this lives beside `editor:recent` in localStorage, is versioned
 * and tolerant on read, and losing it costs a re-open, never data.
 *
 * One key per vault holds both halves, because they are written together and
 * a half-written pair would leave a saved group nobody can find. The caller
 * debounces the writes and prunes the layout against `ui.files` at boot.
 */
import { readJson, writeJson } from './config.js'
import type { SavedGroup, GroupColor } from './groups.js'
import { normalize, serialize, type Layout } from './panes.js'

const PREFIX = 'editor:workspace:'
const VERSION = 1
/** Recency orders the list, so an unbounded tail is just dead weight. */
const SAVED_LIMIT = 100

interface StoredWorkspace {
  version: number
  layout: unknown
  savedGroups: unknown
}

function keyFor(vaultKey: string): string {
  return PREFIX + vaultKey
}

function read(vaultKey: string): StoredWorkspace | null {
  const raw = readJson<StoredWorkspace>(keyFor(vaultKey))
  if (!raw || typeof raw !== 'object' || raw.version !== VERSION) return null
  return raw
}

/** The stored tree, or null when there is nothing usable to restore. */
export function loadLayout(vaultKey: string, ids: () => string): Layout | null {
  const stored = read(vaultKey)
  return stored ? normalize(stored.layout, ids) : null
}

export function saveLayout(vaultKey: string, l: Layout): void {
  const stored = read(vaultKey)
  writeJson(keyFor(vaultKey), {
    version: VERSION,
    layout: serialize(l),
    savedGroups: stored?.savedGroups ?? [],
  } satisfies StoredWorkspace)
}

/** Most recently closed first — the order Firefox's list uses (Decision 8). */
export function loadSavedGroups(vaultKey: string): SavedGroup[] {
  const stored = read(vaultKey)
  return normalizeSavedGroups(stored?.savedGroups)
}

export function saveSavedGroups(vaultKey: string, groups: readonly SavedGroup[]): void {
  const stored = read(vaultKey)
  writeJson(keyFor(vaultKey), {
    version: VERSION,
    layout: stored?.layout ?? null,
    savedGroups: normalizeSavedGroups(groups).slice(0, SAVED_LIMIT),
  } satisfies StoredWorkspace)
}

/**
 * Tolerant read of the saved list: a group missing its name or colour is
 * still a list of paths worth reopening, so only a group with no usable tab
 * is dropped.
 */
export function normalizeSavedGroups(raw: unknown): SavedGroup[] {
  if (!Array.isArray(raw)) return []
  const out: SavedGroup[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const tabs = Array.isArray(r.tabs)
      ? r.tabs
          .map((t) => normalizeSavedTab(t))
          .filter((t): t is SavedGroup['tabs'][number] => t !== null)
      : []
    if (!tabs.length) continue
    const color = typeof r.color === 'number' && r.color >= 1 && r.color <= 8 ? Math.round(r.color) : 1
    out.push({
      id: typeof r.id === 'string' ? r.id : `sg${out.length}`,
      name: typeof r.name === 'string' ? r.name : '',
      color: color as GroupColor,
      lastActive: typeof r.lastActive === 'number' && Number.isFinite(r.lastActive) ? r.lastActive : 0,
      tabs,
    })
  }
  return out
}

function normalizeSavedTab(raw: unknown): SavedGroup['tabs'][number] | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || !r.path) return null
  const c = r.cursor as Record<string, unknown> | null | undefined
  const cursor =
    c && typeof c === 'object' && typeof c.anchor === 'number' && typeof c.head === 'number'
      ? { anchor: c.anchor, head: c.head }
      : null
  return {
    path: r.path,
    cursor,
    scroll: typeof r.scroll === 'number' && Number.isFinite(r.scroll) ? Math.max(0, r.scroll) : 0,
  }
}
