/**
 * Tab groups — a named, coloured, contiguous run of tabs inside one pane's
 * strip (tab-groups-shaping B4, B8; Firefox's model, not Obsidian's).
 *
 * The point of a group is that being messy is free (R2): a group's tabs are
 * ordinary unloaded tabs, folding one hides a cluster without unloading
 * anything (there was nothing loaded), and *closing* one is the save — it
 * moves to the device-local list with its tabs' resume points, and only an
 * explicit delete loses it (R2.2).
 *
 * The tree plumbing, the contiguity invariant (`normalizeGroups`) and the
 * `SavedGroup` shape live in `panes.ts` so that `closePane` can save groups
 * without importing this module back; both are re-exported here, which is
 * where the shaping doc's contract puts them.
 */
import { basename, normalizeTarget } from '@editor/index'
import {
  activeTab,
  detachTabs,
  editLayout,
  findGroup,
  findPane,
  focusedPane,
  insertTab,
  newTab,
  nextId,
  paneOfTab,
  savedFromGroup,
  settlePane,
  type Group,
  type GroupColor,
  type Layout,
  type Pane,
  type SavedGroup,
} from './panes.js'

export { findGroup, groupOf, normalizeGroups } from './panes.js'
export type { Group, GroupColor, SavedGroup } from './panes.js'

/** The first colour of the band this pane is not already using (the mock's). */
export function nextGroupColor(p: Pane): GroupColor {
  const used = new Set(p.groups.map((g) => g.color))
  for (let c = 1; c <= 8; c++) if (!used.has(c as GroupColor)) return c as GroupColor
  return 1
}

/**
 * A new group holding one tab, which leaves whatever group it was in.
 *
 * `name` is the caller's (the strings live in the dictionary, this module has
 * none): C1 opens the Manage popover on the fresh chip with the field
 * focused, so an empty name is the normal case for a keyboard-driven create.
 */
export function newGroup(
  l: Layout,
  paneId: string,
  tabId: string,
  ids: () => string,
  name = '',
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    const p = findPane(d, paneId)
    if (!p || !p.tabs.some((t) => t.id === tabId)) return
    for (const g of p.groups) g.tabIds = g.tabIds.filter((x) => x !== tabId)
    p.groups.push({
      id: ids(),
      name,
      color: nextGroupColor(p),
      collapsed: false,
      tabIds: [tabId],
      lastActive: now,
    })
  })
}

/**
 * Put a tab in a group. The tab MOVES to sit after the group's last member: a
 * group is a run of the strip, so joining one is also a reorder.
 */
export function addToGroup(l: Layout, tabId: string, groupId: string): Layout {
  return editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (!found) return
    const { pane: p, group: g } = found
    const t = p.tabs.find((x) => x.id === tabId)
    if (!t || g.tabIds.includes(tabId)) return
    for (const other of p.groups) other.tabIds = other.tabIds.filter((x) => x !== tabId)
    p.tabs = p.tabs.filter((x) => x.id !== tabId)
    const last = g.tabIds[g.tabIds.length - 1]
    const at = p.tabs.findIndex((x) => x.id === last)
    p.tabs.splice(at + 1, 0, t)
    g.tabIds.push(tabId)
    g.collapsed = false
  })
}

/** Leave the group, staying where it is on the strip. */
export function removeFromGroup(l: Layout, tabId: string): Layout {
  return editLayout(l, (d) => {
    const p = paneOfTab(d, tabId)
    if (!p) return
    for (const g of p.groups) g.tabIds = g.tabIds.filter((x) => x !== tabId)
  })
}

/** Drop the label; the tabs stay in place as loose tabs (the mock's rule). */
export function ungroup(l: Layout, groupId: string): Layout {
  return editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (found) found.pane.groups = found.pane.groups.filter((g) => g.id !== groupId)
  })
}

export function renameGroup(l: Layout, groupId: string, name: string): Layout {
  return editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (found) found.group.name = name
  })
}

export function recolor(l: Layout, groupId: string, color: GroupColor): Layout {
  return editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (found) found.group.color = color
  })
}

/**
 * Fold or unfold. Folding the group that holds the active tab has to move the
 * active tab somewhere visible first — the nearest tab outside the group, or a
 * fresh empty one when the group is the whole strip.
 */
export function toggleCollapsed(
  l: Layout,
  groupId: string,
  ids: () => string = nextId,
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (!found) return
    const { pane: p, group: g } = found
    if (!g.collapsed && p.active !== null && g.tabIds.includes(p.active)) {
      const outside = nearestOutside(p, g)
      if (outside) p.active = outside.id
      else {
        const t = insertTab(p, newTab(ids), null)
        p.active = t.id
      }
    }
    g.collapsed = !g.collapsed
    g.lastActive = now
  })
}

/** The tab outside `g` closest to the active one, searching right then left. */
function nearestOutside(p: Pane, g: Group): { id: string } | null {
  const from = p.tabs.findIndex((t) => t.id === p.active)
  for (let step = 1; step < p.tabs.length + 1; step++) {
    const right = p.tabs[from + step]
    if (right && !g.tabIds.includes(right.id)) return right
    const left = p.tabs[from - step]
    if (left && !g.tabIds.includes(left.id)) return left
  }
  return null
}

/**
 * Close a group: its tabs leave the strip and it comes back as a `SavedGroup`
 * for the caller's list, resume points intact (R2.2 — there is no save step).
 * A pane emptied by this closes, unless it is the only one.
 */
export function closeGroup(
  l: Layout,
  groupId: string,
  ids: () => string = nextId,
  now = Date.now()
): { layout: Layout; saved: SavedGroup | null } {
  let saved: SavedGroup | null = null
  const layout = editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (!found) return
    const { pane: p, group: g } = found
    saved = savedFromGroup(p, g, now)
    detachTabs(p, [...g.tabIds])
    p.groups = p.groups.filter((x) => x.id !== groupId)
    settlePane(d, p, ids)
  })
  return { layout, saved }
}

/**
 * Open a saved group in a pane, after the active tab, at the cursors it was
 * closed at. A path already open in that pane is re-taken by the group rather
 * than duplicated (R3).
 */
export function openSaved(
  l: Layout,
  paneId: string,
  saved: SavedGroup,
  ids: () => string,
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    const p = findPane(d, paneId) ?? focusedPane(d)
    const g: Group = {
      id: ids(),
      name: saved.name,
      color: saved.color,
      collapsed: false,
      tabIds: [],
      lastActive: now,
    }
    const active = activeTab(p)
    let at = active ? p.tabs.indexOf(active) + 1 : p.tabs.length
    for (const st of saved.tabs) {
      const dup = p.tabs.findIndex((t) => t.path === st.path)
      if (dup >= 0) {
        detachTabs(p, [p.tabs[dup].id])
        if (dup < at) at--
      }
      const t = newTab(ids, st.path, st.cursor, st.scroll)
      p.tabs.splice(Math.min(at, p.tabs.length), 0, t)
      g.tabIds.push(t.id)
      at++
    }
    if (!g.tabIds.length) return
    p.groups.push(g)
    p.active = g.tabIds[0]
    d.focus = p.id
  })
}

/**
 * The one destructive group op (B4): the tabs close and the group is gone.
 * C1 confirms before calling this.
 */
export function deleteGroup(l: Layout, groupId: string, ids: () => string = nextId): Layout {
  return editLayout(l, (d) => {
    const found = findGroup(d, groupId)
    if (!found) return
    const { pane: p, group: g } = found
    detachTabs(p, [...g.tabIds])
    p.groups = p.groups.filter((x) => x.id !== groupId)
    settlePane(d, p, ids)
  })
}

/**
 * A group as portable text (B8/R6): `- [[basename]]` per tab, one per line.
 * An ambiguous basename is written as `[[path|basename]]` so the link still
 * resolves — a clash inside the list is detected here, and the caller passes
 * the index's vault-wide verdict when it has one.
 */
export function linksOf(paths: readonly string[], ambiguous?: (name: string) => boolean): string {
  const counts = new Map<string, number>()
  for (const p of paths) {
    const n = basename(p).toLowerCase()
    counts.set(n, (counts.get(n) ?? 0) + 1)
  }
  return paths
    .map((p) => {
      const name = basename(p)
      const clash = (counts.get(name.toLowerCase()) ?? 0) > 1 || (ambiguous?.(name) ?? false)
      return clash ? `- [[${normalizeTarget(p)}|${name}]]` : `- [[${name}]]`
    })
    .join('\n')
}

/**
 * The other direction of R6: a note's outgoing links become a group in the
 * focused pane. Same insertion rules as `openSaved`, so a path already open
 * joins the group rather than doubling up.
 */
export function groupFromLinks(
  l: Layout,
  paneId: string,
  name: string,
  paths: readonly string[],
  ids: () => string,
  now = Date.now()
): Layout {
  const pane = findPane(l, paneId)
  const saved: SavedGroup = {
    id: ids(),
    name,
    color: pane ? nextGroupColor(pane) : 1,
    lastActive: now,
    tabs: paths.map((path) => ({ path, cursor: null, scroll: 0 })),
  }
  return openSaved(l, paneId, saved, ids, now)
}
