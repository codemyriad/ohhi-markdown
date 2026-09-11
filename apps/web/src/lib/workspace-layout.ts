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
 * One key per vault holds both halves, and **one writer** puts them there.
 * Two writers, each re-reading the other's half, is how a group gets lost: the
 * layout half is debounced and the list half was immediate, so *Open saved
 * group* wrote the list without the group and the layout from BEFORE it was
 * reopened — a reload inside that window and the group was in neither (R2.2).
 * So the store takes both halves at once, from memory, and the caller
 * debounces the one write.
 */
import { readJson, writeJson } from './config.js'
import type { SavedGroup } from './groups.js'
import { normalize, normalizeSavedGroups, serialize, type Layout } from './panes.js'

// Defined beside the other tolerant readers of the stored shapes, and
// re-exported here because this module is the store they belong to — the same
// arrangement `normalizeGroups` and `SavedGroup` already have.
export { normalizeSavedGroups }

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

/**
 * Write both halves, from what the caller holds in memory. The only writer —
 * see the note at the top of the file: a half that re-reads the other half
 * off storage can only ever write a stale one.
 */
export function saveWorkspace(
  vaultKey: string,
  l: Layout,
  groups: readonly SavedGroup[]
): void {
  writeJson(keyFor(vaultKey), {
    version: VERSION,
    layout: serialize(l),
    savedGroups: normalizeSavedGroups(groups).slice(0, SAVED_LIMIT),
  } satisfies StoredWorkspace)
}

/** Most recently closed first — the order Firefox's list uses (Decision 8). */
export function loadSavedGroups(vaultKey: string): SavedGroup[] {
  const stored = read(vaultKey)
  return normalizeSavedGroups(stored?.savedGroups)
}
