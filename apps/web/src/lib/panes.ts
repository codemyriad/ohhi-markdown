/**
 * The pane tree — panes, tabs, and the group invariants a strip depends on
 * (tab-groups-shaping B1, B2, B4, B5, B10, B11).
 *
 * A **pane** is a cell of the split tree holding one tab strip and one live
 * editor; a **tab** is a path plus a resume point (cursor, scroll, history);
 * a **group** is a contiguous, named run of tabs inside one strip. Only the
 * active tab of each pane on screen ever gets a view, which is why leaving 21
 * tabs open costs nothing (R2.1) — this module never knows about views, docs
 * or the DOM, so all of that stays testable on node (R7).
 *
 * Three rules hold everywhere:
 *
 * 1. **Mutations return a new Layout and never touch their input.** Each one
 *    clones the layout, edits the copy and settles it. The tree is tiny (four
 *    panes and 21 tabs in the measured vault) and the ops rewrite shape across
 *    several panes at once, so a persistent-structure rewrite would buy
 *    nothing but bugs. Components key on ids, which survive the clone.
 * 2. **Ids come from an injected `ids: () => string`** so tests are
 *    deterministic. Where the shaping doc's contract signature has no room for
 *    one, `ids` is an appended optional argument with a unique-enough fallback
 *    — every real call site passes the shell's generator.
 * 3. **Every mutation settles**: groups are pulled back to contiguity
 *    (`normalizeGroups`), single-child splits collapse, and `focus`/`zoom`/
 *    `active` are repaired if they point at something that just went away.
 *    The mock does this on every render; doing it in the op means no caller
 *    can forget.
 *
 * Geometry (which pane is left of which) is the component's to measure, so
 * `neighbour` takes the rects rather than reading the DOM.
 */

export type Dir = 'row' | 'col'
export type Side = 'left' | 'right' | 'up' | 'down'
/** Index into the `--ed-group-1..8` token band (Fork 5). */
export type GroupColor = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface Cursor {
  anchor: number
  head: number
}

export interface Tab {
  id: string
  /** null = an empty tab (a pane must always hold at least one). */
  path: string | null
  pinned: boolean
  /** Resume point, captured when the view goes away (B2). */
  cursor: Cursor | null
  scroll: number
  /** This tab's back/forward trail — Fork 4 puts history on the tab. */
  history: string[]
  /** Index into `history`; -1 when empty. */
  historyAt: number
}

export interface Group {
  id: string
  name: string
  color: GroupColor
  collapsed: boolean
  /** Always the group's tabs in strip order — see `normalizeGroups`. */
  tabIds: string[]
  lastActive: number
}

export interface Pane {
  kind: 'pane'
  id: string
  tabs: Tab[]
  groups: Group[]
  active: string | null
}

export interface Split {
  kind: 'split'
  id: string
  /** row = side by side, col = stacked. */
  dir: Dir
  children: Node[]
  /** Percent, one per child, summing to 100 (Obsidian's `dimension`). */
  sizes: number[]
}

export type Node = Pane | Split

export interface Layout {
  tree: Node
  /** Pane id. */
  focus: string
  /** Pane id filling the editor area, or null (B12). */
  zoom: string | null
}

/** The part of a DOMRect this module needs — keeps it DOM-free. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * A group tucked into the device-local list by *Close group* (R2.2): closing
 * is the save, so nothing is ever lost without an explicit delete. Its tabs
 * keep their resume points, which is what makes reopening it feel like it
 * never left.
 */
export interface SavedGroup {
  id: string
  name: string
  color: GroupColor
  lastActive: number
  tabs: { path: string; cursor: Cursor | null; scroll: number }[]
}

/** Percent floor for a split child — the mock's clamp, and B11's. */
export const MIN_SIZE = 10
/** Fraction of a pane's width/height that counts as its drop edge (B10). */
export const EDGE_BAND = 0.25
/** Bumped when the persisted shape changes; older payloads are dropped. */
export const LAYOUT_VERSION = 1

let fallbackSeq = 0
/**
 * Last-resort id source for the ops whose contract signature has no `ids`
 * slot. Never used by the shell (it passes its own generator); collisions
 * with ids read back from storage are what the timestamp prefix avoids.
 */
export function nextId(): string {
  return `n${Date.now().toString(36)}${(fallbackSeq++).toString(36)}`
}

// ---- reading the tree ----

/** Every pane under `n`, in DFS (strip) order. */
export function panes(n: Node): Pane[] {
  if (n.kind === 'pane') return [n]
  return n.children.flatMap(panes)
}

export function findPane(l: Layout, id: string): Pane | null {
  return panes(l.tree).find((p) => p.id === id) ?? null
}

export function findSplit(l: Layout, id: string): Split | null {
  const walk = (n: Node): Split | null => {
    if (n.kind === 'pane') return null
    if (n.id === id) return n
    for (const c of n.children) {
      const hit = walk(c)
      if (hit) return hit
    }
    return null
  }
  return walk(l.tree)
}

export function paneOfTab(l: Layout, tabId: string): Pane | null {
  return panes(l.tree).find((p) => p.tabs.some((t) => t.id === tabId)) ?? null
}

/** The tab itself, wherever it lives — the snapshot `tab.reopen` needs. */
export function tabOf(l: Layout, tabId: string): Tab | null {
  for (const p of panes(l.tree)) {
    const t = p.tabs.find((x) => x.id === tabId)
    if (t) return t
  }
  return null
}

export function parentOf(l: Layout, id: string): Split | null {
  const walk = (n: Node, parent: Split | null): Split | null => {
    if (n.id === id) return parent
    if (n.kind === 'split') {
      for (const c of n.children) {
        const hit = walk(c, n)
        if (hit) return hit
      }
    }
    return null
  }
  return walk(l.tree, null)
}

export function activeTab(p: Pane): Tab | null {
  return p.tabs.find((t) => t.id === p.active) ?? null
}

export function groupOf(p: Pane, tabId: string): Group | null {
  return p.groups.find((g) => g.tabIds.includes(tabId)) ?? null
}

/** The pane holding `groupId`, with the group. */
export function findGroup(l: Layout, groupId: string): { pane: Pane; group: Group } | null {
  for (const pane of panes(l.tree)) {
    const group = pane.groups.find((g) => g.id === groupId)
    if (group) return { pane, group }
  }
  return null
}

/** The focused pane, or the first one if focus has gone stale. */
export function focusedPane(l: Layout): Pane {
  return findPane(l, l.focus) ?? panes(l.tree)[0]
}

// ---- constructing ----

export function newTab(
  ids: () => string,
  path: string | null = null,
  cursor: Cursor | null = null,
  scroll = 0
): Tab {
  return {
    id: ids(),
    path,
    pinned: false,
    cursor: cursor ? { ...cursor } : null,
    scroll,
    history: path ? [path] : [],
    historyAt: path ? 0 : -1,
  }
}

export function newPane(ids: () => string, tabs: Tab[] = []): Pane {
  const list = tabs.length ? tabs : [newTab(ids)]
  return { kind: 'pane', id: ids(), tabs: list, groups: [], active: list[0].id }
}

export function createLayout(ids: () => string): Layout {
  const pane = newPane(ids)
  return { tree: pane, focus: pane.id, zoom: null }
}

// ---- cloning and settling (shared with groups.ts) ----

function cloneTab(t: Tab): Tab {
  return { ...t, cursor: t.cursor ? { ...t.cursor } : null, history: [...t.history] }
}

function cloneNode(n: Node): Node {
  return n.kind === 'pane'
    ? {
        kind: 'pane',
        id: n.id,
        tabs: n.tabs.map(cloneTab),
        groups: n.groups.map((g) => ({ ...g, tabIds: [...g.tabIds] })),
        active: n.active,
      }
    : {
        kind: 'split',
        id: n.id,
        dir: n.dir,
        children: n.children.map(cloneNode),
        sizes: [...n.sizes],
      }
}

export function cloneLayout(l: Layout): Layout {
  return { tree: cloneNode(l.tree), focus: l.focus, zoom: l.zoom }
}

/**
 * Groups stay contiguous and in strip order, whatever a drop, a close or a
 * rename did (the mock's `normalizeGroups`, which it runs on every render).
 * Members are gathered at the position of the group's first member; stale ids
 * and emptied groups are dropped.
 *
 * Mutates the pane it is given — it is an invariant applied to a draft, never
 * to a layout a caller still holds.
 */
export function normalizeGroups(p: Pane): void {
  for (const g of p.groups) {
    const ids = new Set(g.tabIds)
    const members = p.tabs.filter((t) => ids.has(t.id))
    if (!members.length) {
      g.tabIds = []
      continue
    }
    const first = p.tabs.indexOf(members[0])
    const rest = p.tabs.filter((t) => !ids.has(t.id))
    const before = rest.filter((t) => p.tabs.indexOf(t) < first)
    const after = rest.filter((t) => p.tabs.indexOf(t) > first)
    p.tabs = [...before, ...members, ...after]
    g.tabIds = members.map((t) => t.id)
  }
  p.groups = p.groups.filter((g) => g.tabIds.length)
}

/** Collapse single-child splits, drop empty ones, repair size arrays. */
function compact(n: Node): Node | null {
  if (n.kind === 'pane') return n
  const hadSizes = n.sizes.length === n.children.length
  const kept: Node[] = []
  const sizes: number[] = []
  n.children.forEach((c, i) => {
    const cc = compact(c)
    if (!cc) return
    kept.push(cc)
    sizes.push(hadSizes ? n.sizes[i] : 0)
  })
  if (!kept.length) return null
  if (kept.length === 1) return kept[0]
  const sum = sizes.reduce((a, b) => a + b, 0)
  const dropped = kept.length !== n.children.length
  n.children = kept
  // A dropped child's share goes back to the survivors, proportionally. When
  // nothing was dropped the numbers are passed through untouched: Chris's
  // borders are all at hand-dragged percentages and float-tidying them would
  // move his layout every time the app settles.
  n.sizes = !hadSizes ? evenSizes(kept.length) : dropped && sum > 0 ? sizes.map((s) => (s * 100) / sum) : sizes
  return n
}

function evenSizes(n: number): number[] {
  return Array.from({ length: n }, () => 100 / n)
}

/**
 * Restore every layout invariant after an edit: contiguous groups, no
 * degenerate splits, and `active`/`focus`/`zoom` pointing at things that
 * still exist.
 */
export function settleLayout(l: Layout): void {
  const tree = compact(l.tree)
  if (tree) l.tree = tree
  const ps = panes(l.tree)
  for (const p of ps) {
    normalizeGroups(p)
    if (!p.tabs.some((t) => t.id === p.active)) p.active = p.tabs[0]?.id ?? null
  }
  if (!ps.some((p) => p.id === l.focus)) l.focus = ps[0]?.id ?? l.focus
  if (l.zoom && !ps.some((p) => p.id === l.zoom)) l.zoom = null
}

/** Clone → edit the draft → settle. The body of every mutation below. */
export function editLayout(l: Layout, edit: (draft: Layout) => void): Layout {
  const draft = cloneLayout(l)
  edit(draft)
  settleLayout(draft)
  return draft
}

// ---- tab plumbing (shared with groups.ts) ----

/**
 * Insert `t` after `afterId` (end of the strip when null), joining that tab's
 * group so an open from inside a cluster stays in the cluster (B5).
 */
export function insertTab(p: Pane, t: Tab, afterId: string | null): Tab {
  if (afterId === null) {
    p.tabs.push(t)
    return t
  }
  const i = p.tabs.findIndex((x) => x.id === afterId)
  p.tabs.splice(i + 1, 0, t)
  const g = groupOf(p, afterId)
  if (g) g.tabIds.splice(g.tabIds.indexOf(afterId) + 1, 0, t.id)
  return t
}

/**
 * Remove tabs from one pane, keeping `active` on the nearest survivor (the
 * next tab, else the previous one — every browser's rule).
 */
export function detachTabs(p: Pane, tabIds: readonly string[]): Tab[] {
  const set = new Set(tabIds)
  const removed = p.tabs.filter((t) => set.has(t.id))
  if (!removed.length) return []
  const at = p.active && set.has(p.active) ? p.tabs.findIndex((t) => t.id === p.active) : -1
  const goneBefore = at < 0 ? 0 : p.tabs.slice(0, at).filter((t) => set.has(t.id)).length
  p.tabs = p.tabs.filter((t) => !set.has(t.id))
  for (const g of p.groups) g.tabIds = g.tabIds.filter((x) => !set.has(x))
  p.groups = p.groups.filter((g) => g.tabIds.length)
  if (at >= 0) {
    const i = at - goneBefore
    p.active = (p.tabs[i] ?? p.tabs[i - 1])?.id ?? null
  }
  return removed
}

/** Detach across panes, returning the tabs in payload order (drag payloads). */
function detach(l: Layout, tabIds: readonly string[]): Tab[] {
  const byPane = new Map<Pane, string[]>()
  for (const id of tabIds) {
    const p = paneOfTab(l, id)
    if (!p) continue
    const list = byPane.get(p)
    if (list) list.push(id)
    else byPane.set(p, [id])
  }
  const found = new Map<string, Tab>()
  for (const [p, ids] of byPane) for (const t of detachTabs(p, ids)) found.set(t.id, t)
  return tabIds.map((id) => found.get(id)).filter((t): t is Tab => t !== undefined)
}

/**
 * The group a drag carries wholesale: chip drags move the group, not just its
 * tabs (Decision 4), and the payload is only ever tab ids — so "is this
 * payload exactly one group?" is derived here rather than passed in.
 */
export function carriedGroup(p: Pane | null, tabIds: readonly string[]): Group | null {
  if (!p || !tabIds.length) return null
  const g = groupOf(p, tabIds[0])
  if (!g) return null
  const set = new Set(tabIds)
  return g.tabIds.length === tabIds.length && g.tabIds.every((id) => set.has(id)) ? g : null
}

/**
 * The group a tab landing at `index` joins: only when it lands *between* two
 * tabs of one group. Dropping at a group's edge leaves it outside, which is
 * what makes a group's boundaries draggable at all (B10).
 *
 * `index` counts the strip WITHOUT `excludeTabId` (the tab being moved).
 */
export function groupAtIndex(p: Pane, index: number, excludeTabId?: string): string | null {
  const list = p.tabs.filter((t) => t.id !== excludeTabId)
  const prev = list[index - 1]
  const next = list[index]
  if (!prev || !next) return null
  const gp = groupOf(p, prev.id)
  const gn = groupOf(p, next.id)
  return gp && gn && gp.id === gn.id ? gp.id : null
}

function placeTabAt(p: Pane, t: Tab, index: number, groupId?: string | null): void {
  const i = Math.max(0, Math.min(index, p.tabs.length))
  const gid = groupId === undefined ? groupAtIndex(p, i, t.id) : groupId
  p.tabs.splice(i, 0, t)
  for (const g of p.groups) g.tabIds = g.tabIds.filter((x) => x !== t.id)
  if (gid) {
    const g = p.groups.find((x) => x.id === gid)
    if (g) {
      g.tabIds.push(t.id)
      g.collapsed = false
    }
  }
}

function activateIn(l: Layout, p: Pane, tabId: string, now: number): void {
  if (!p.tabs.some((t) => t.id === tabId)) return
  p.active = tabId
  l.focus = p.id
  const g = groupOf(p, tabId)
  if (g) {
    g.lastActive = now
    // Activating a tab inside a folded group unfolds it — you cannot look at
    // a tab that is not on the strip.
    g.collapsed = false
  }
}

/** A pane must always hold a tab; an emptied one closes unless it is the last. */
export function settlePane(l: Layout, p: Pane, ids: () => string, keep?: Pane): void {
  if (p.tabs.length) return
  if (p !== keep && panes(l.tree).length > 1 && panes(l.tree).includes(p)) {
    removePane(l, p)
    return
  }
  const t = insertTab(p, newTab(ids), null)
  p.active = t.id
}

function closeEmptyPanes(l: Layout, ids: () => string): void {
  for (const p of [...panes(l.tree)]) settlePane(l, p, ids)
}

/**
 * Take a pane out of the tree, returning its share to the neighbour that
 * takes its place (B11) and answering with the pane that inherits it.
 */
function removePane(l: Layout, p: Pane): Pane | null {
  const par = parentOf(l, p.id)
  if (!par) return null
  const ci = par.children.indexOf(p)
  const share = par.sizes[ci] ?? 0
  par.children.splice(ci, 1)
  par.sizes.splice(ci, 1)
  const hi = Math.min(ci, par.sizes.length - 1)
  if (hi >= 0) par.sizes[hi] += share
  const heir = par.children[hi]
  if (par.children.length === 1) {
    const only = par.children[0]
    const gp = parentOf(l, par.id)
    if (gp) gp.children[gp.children.indexOf(par)] = only
    else l.tree = only
  }
  return heir ? (panes(heir)[0] ?? null) : null
}

// ---- opening, closing, activating ----

/**
 * Fork 1-B: every open is a tab. A tab for `path` already in the target pane
 * is activated instead (R3 — never two tabs of one note in one pane); a new
 * one lands after the active tab, inside its group if the active tab is
 * grouped, and takes focus unless `background`.
 */
export function openPath(
  l: Layout,
  path: string,
  opts: { background?: boolean; paneId?: string } = {},
  ids: () => string = nextId,
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    const p = findPane(d, opts.paneId ?? d.focus) ?? panes(d.tree)[0]
    const dup = p.tabs.find((t) => t.path === path)
    if (dup) {
      activateIn(d, p, dup.id, now)
      return
    }
    const anchor = activeTab(p)
    const t = insertTab(p, newTab(ids, path), anchor?.id ?? null)
    if (!opts.background) activateIn(d, p, t.id, now)
  })
}

export function activate(l: Layout, paneId: string, tabId: string, now = Date.now()): Layout {
  return editLayout(l, (d) => {
    const p = findPane(d, paneId)
    if (p) activateIn(d, p, tabId, now)
  })
}

/** Move focus without changing anything else; zoom follows the focused pane. */
export function focusPane(l: Layout, paneId: string): Layout {
  return editLayout(l, (d) => {
    if (findPane(d, paneId)) {
      d.focus = paneId
      if (d.zoom && d.zoom !== paneId) d.zoom = null
    }
  })
}

export function focusNext(l: Layout): Layout {
  return editLayout(l, (d) => {
    d.zoom = null
    const ps = panes(d.tree)
    const i = ps.findIndex((p) => p.id === d.focus)
    d.focus = ps[(i + 1) % ps.length].id
  })
}

/**
 * Close one tab. The last tab of a pane closes the pane, unless it is the only
 * pane — then the pane keeps one empty tab, because a pane with no strip is
 * not a thing the shell can render.
 *
 * A group whose last member closes goes with it: closing tabs one at a time is
 * dismantling the group, not putting it away (that is `closeGroup`, which
 * saves it — R2.2).
 */
export function closeTab(l: Layout, tabId: string, ids: () => string = nextId): Layout {
  return editLayout(l, (d) => {
    const p = paneOfTab(d, tabId)
    if (!p) return
    detachTabs(p, [tabId])
    settlePane(d, p, ids)
  })
}

/** The snapshot `tab.reopen` needs, taken before `closeTab` throws it away. */
export interface ClosedTab {
  tab: Tab
  paneId: string
}

export function closedTabOf(l: Layout, tabId: string): ClosedTab | null {
  const p = paneOfTab(l, tabId)
  const t = p?.tabs.find((x) => x.id === tabId)
  return p && t ? { tab: cloneTab(t), paneId: p.id } : null
}

/** Put a closed tab back where it came from, at its old resume point. */
export function reopenTab(
  l: Layout,
  closed: ClosedTab,
  ids: () => string = nextId,
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    const p = findPane(d, closed.paneId) ?? focusedPane(d)
    const dup = closed.tab.path ? p.tabs.find((t) => t.path === closed.tab.path) : null
    if (dup) {
      activateIn(d, p, dup.id, now)
      return
    }
    const t = { ...cloneTab(closed.tab), id: ids() }
    insertTab(p, t, activeTab(p)?.id ?? null)
    activateIn(d, p, t.id, now)
  })
}

/**
 * Close everything in the pane but the active tab and the pinned ones
 * (Decision 3). Groups that lose every member are tucked into the saved list
 * rather than dropped (R2.2) — which is why this returns them, like
 * `closePane`.
 */
export function closeOthers(
  l: Layout,
  paneId: string,
  ids: () => string = nextId,
  now = Date.now()
): { layout: Layout; saved: SavedGroup[] } {
  const saved: SavedGroup[] = []
  const layout = editLayout(l, (d) => {
    const p = findPane(d, paneId)
    if (!p) return
    const keep = new Set(p.tabs.filter((t) => t.id === p.active || t.pinned).map((t) => t.id))
    // Nothing to keep means nothing was asked for — never empty the pane.
    if (!keep.size) return
    const doomed = p.tabs.filter((t) => !keep.has(t.id)).map((t) => t.id)
    if (!doomed.length) return
    for (const g of p.groups) {
      if (g.tabIds.every((id) => !keep.has(id))) saved.push(savedFromGroup(p, g, now))
    }
    detachTabs(p, doomed)
    settlePane(d, p, ids)
  })
  return { layout, saved: saved.filter((g) => g.tabs.length) }
}

/**
 * Close a pane. Its groups come back as saved groups so the caller can put
 * them in the list (R2.2 — closing is the save); its pinned tabs move next
 * door (Decision 3); its share goes back to the neighbour (B11).
 *
 * The last pane never closes — there has to be somewhere to look.
 */
export function closePane(
  l: Layout,
  paneId: string,
  now = Date.now()
): { layout: Layout; saved: SavedGroup[] } {
  const saved: SavedGroup[] = []
  const layout = editLayout(l, (d) => {
    d.zoom = null
    const p = findPane(d, paneId)
    if (!p || panes(d.tree).length < 2) return
    // Pinned first: a pinned tab is an explicit "keep this in front of me", so
    // it travels rather than going into the group's saved list.
    const pinned = detachTabs(p, p.tabs.filter((t) => t.pinned).map((t) => t.id))
    normalizeGroups(p)
    for (const g of p.groups) saved.push(savedFromGroup(p, g, now))
    const heir = removePane(d, p)
    if (heir) {
      for (const t of pinned) if (!heir.tabs.some((x) => x.path === t.path)) heir.tabs.push(t)
      d.focus = heir.id
    }
  })
  return { layout, saved: saved.filter((g) => g.tabs.length) }
}

export function savedFromGroup(p: Pane, g: Group, now: number): SavedGroup {
  const tabs = g.tabIds
    .map((id) => p.tabs.find((t) => t.id === id))
    .filter((t): t is Tab => !!t && t.path !== null)
  return {
    id: g.id,
    name: g.name,
    color: g.color,
    lastActive: now,
    tabs: tabs.map((t) => ({
      path: t.path as string,
      cursor: t.cursor ? { ...t.cursor } : null,
      scroll: t.scroll,
    })),
  }
}

// ---- splitting, moving, resizing ----

/** Put `np` next to `target` along `dir`, taking half of the target's share. */
function placeBeside(
  l: Layout,
  target: Node,
  np: Pane,
  dir: Dir,
  side: 'before' | 'after',
  ids: () => string
): void {
  const par = parentOf(l, target.id)
  if (par && par.dir === dir) {
    const i = par.children.indexOf(target)
    const half = (par.sizes[i] ?? 100 / par.children.length) / 2
    par.sizes[i] = half
    const at = i + (side === 'after' ? 1 : 0)
    par.children.splice(at, 0, np)
    par.sizes.splice(at, 0, half)
    return
  }
  const s: Split = {
    kind: 'split',
    id: ids(),
    dir,
    children: side === 'after' ? [target, np] : [np, target],
    sizes: [50, 50],
  }
  if (par) par.children[par.children.indexOf(target)] = s
  else l.tree = s
}

/**
 * A new pane after this one, holding the active path (Obsidian duplicates it,
 * resume point and all), splitting the pane's share in half.
 */
export function split(l: Layout, paneId: string, dir: Dir, ids: () => string = nextId): Layout {
  return editLayout(l, (d) => {
    d.zoom = null
    const p = findPane(d, paneId)
    if (!p) return
    const a = activeTab(p)
    const np = newPane(ids, [a?.path ? newTab(ids, a.path, a.cursor, a.scroll) : newTab(ids)])
    placeBeside(d, p, np, dir, 'after', ids)
    d.focus = np.id
  })
}

/**
 * Drop-to-split (B10): the dragged tabs become a new pane on `side` of the
 * target. A parent split already running that way absorbs it; otherwise the
 * target is replaced by a split of two. A chip drag brings its group along.
 */
export function splitWith(
  l: Layout,
  targetPaneId: string,
  side: Side,
  payload: { tabIds: string[] },
  ids: () => string = nextId,
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    d.zoom = null
    const target = findPane(d, targetPaneId)
    if (!target || !payload.tabIds.length) return
    const source = paneOfTab(d, payload.tabIds[0])
    // Dropping a pane's whole contents on its own edge would dissolve and
    // rebuild the same pane: the mock's 'none' zone.
    if (source === target && payload.tabIds.length === target.tabs.length) return
    const carried = carriedGroup(source, payload.tabIds)
    const carriedName = carried?.name
    const carriedColor = carried?.color
    const moved = detach(d, payload.tabIds)
    if (!moved.length) return
    const np: Pane = { kind: 'pane', id: ids(), tabs: moved, groups: [], active: moved[0].id }
    if (carriedName !== undefined && carriedColor !== undefined) {
      np.groups.push({
        id: ids(),
        name: carriedName,
        color: carriedColor,
        collapsed: false,
        tabIds: moved.map((t) => t.id),
        lastActive: now,
      })
    }
    const dir: Dir = side === 'left' || side === 'right' ? 'row' : 'col'
    placeBeside(d, target, np, dir, side === 'right' || side === 'down' ? 'after' : 'before', ids)
    d.focus = np.id
    if (source) settlePane(d, source, ids, np)
  })
}

/**
 * Move a tab to another pane (or to another slot in its own — that is a
 * reorder). A path already open in the target activates the tab that is
 * already there (R3) and the dragged copy goes away.
 *
 * `index` is an insertion index in the target strip as it looks now; `groupId`
 * overrides the group the landing spot implies (`null` = ungrouped, e.g. a
 * drop on a folded chip passes the chip's group explicitly).
 */
export function moveTab(
  l: Layout,
  tabId: string,
  toPaneId: string,
  index?: number,
  groupId?: string | null,
  ids: () => string = nextId,
  now = Date.now()
): Layout {
  return editLayout(l, (d) => {
    const to = findPane(d, toPaneId)
    const from = paneOfTab(d, tabId)
    if (!to || !from) return
    const t = from.tabs.find((x) => x.id === tabId)
    if (!t) return
    if (from === to) {
      reorderIn(to, t, index ?? to.tabs.length, groupId)
      d.focus = to.id
      return
    }
    d.zoom = null
    const existing = t.path !== null ? to.tabs.find((x) => x.path === t.path) : undefined
    detachTabs(from, [tabId])
    if (existing) activateIn(d, to, existing.id, now)
    else {
      placeTabAt(to, t, index ?? to.tabs.length, groupId)
      activateIn(d, to, t.id, now)
    }
    settlePane(d, from, ids, to)
  })
}

function reorderIn(p: Pane, t: Tab, index: number, groupId?: string | null): void {
  // `index` points into the strip as the user sees it, with the dragged tab
  // still in place; discount its own slot.
  const before = p.tabs.slice(0, index).filter((x) => x.id !== t.id).length
  p.tabs = p.tabs.filter((x) => x.id !== t.id)
  placeTabAt(p, t, before, groupId)
}

export function reorder(
  l: Layout,
  paneId: string,
  tabId: string,
  index: number,
  groupId?: string | null
): Layout {
  return editLayout(l, (d) => {
    const p = findPane(d, paneId)
    const t = p?.tabs.find((x) => x.id === tabId)
    if (!p || !t) return
    reorderIn(p, t, index, groupId)
  })
}

/** Swap two panes' places in the tree; the sizes stay with the slots. */
export function swapPanes(l: Layout, aId: string, bId: string): Layout {
  return editLayout(l, (d) => {
    d.zoom = null
    const a = findPane(d, aId)
    const b = findPane(d, bId)
    if (!a || !b || a === b) return
    const pa = parentOf(d, a.id)
    const pb = parentOf(d, b.id)
    if (!pa || !pb) return
    const ia = pa.children.indexOf(a)
    const ib = pb.children.indexOf(b)
    pa.children[ia] = b
    pb.children[ib] = a
  })
}

function resizeIn(s: Split, i: number, deltaPct: number): void {
  if (i < 0 || i + 1 >= s.sizes.length) return
  const a = s.sizes[i]
  const b = s.sizes[i + 1]
  const d = Math.max(-(a - MIN_SIZE), Math.min(b - MIN_SIZE, deltaPct))
  s.sizes[i] = a + d
  s.sizes[i + 1] = b - d
}

/** Drag one border: child `i` grows by `deltaPct`, `i + 1` gives it up. */
export function resize(l: Layout, splitId: string, i: number, deltaPct: number): Layout {
  return editLayout(l, (d) => {
    const s = findSplit(d, splitId)
    if (s) resizeIn(s, i, deltaPct)
  })
}

/** The nearest ancestor split running along `dir`, and this branch's index. */
function ancestorSplit(l: Layout, p: Pane, dir: Dir): { split: Split; index: number } | null {
  let node: Node = p
  let par = parentOf(l, node.id)
  while (par && par.dir !== dir) {
    node = par
    par = parentOf(l, node.id)
  }
  return par ? { split: par, index: par.children.indexOf(node) } : null
}

/**
 * Resize by key (the mode's sticky `s` sub-mode): grow or shrink the focused
 * pane on one side, on the nearest ancestor split of that axis. With no
 * neighbour on that side the opposite border moves instead, so the key always
 * does something.
 */
export function resizeBy(l: Layout, paneId: string, side: Side, pct: number): Layout {
  return editLayout(l, (d) => {
    d.zoom = null
    const p = findPane(d, paneId)
    if (!p) return
    const anc = ancestorSplit(d, p, side === 'left' || side === 'right' ? 'row' : 'col')
    if (!anc) return
    const { split: s, index: i } = anc
    const last = s.children.length - 1
    if (side === 'left' || side === 'up') {
      if (i > 0) resizeIn(s, i - 1, -pct)
      else resizeIn(s, i, -pct)
    } else {
      if (i < last) resizeIn(s, i, pct)
      else resizeIn(s, i - 1, pct)
    }
  })
}

export function equalize(l: Layout): Layout {
  return editLayout(l, (d) => {
    const walk = (n: Node): void => {
      if (n.kind !== 'split') return
      n.sizes = evenSizes(n.children.length)
      n.children.forEach(walk)
    }
    walk(d.tree)
  })
}

/** Flip the direction of the split this pane sits in. */
export function rotate(l: Layout, paneId: string): Layout {
  return editLayout(l, (d) => {
    d.zoom = null
    const p = findPane(d, paneId)
    if (!p) return
    const par = parentOf(d, p.id)
    if (par) par.dir = par.dir === 'row' ? 'col' : 'row'
  })
}

/**
 * One pane fills the editor area; the rest stay in the tree with their tabs
 * but lose their views, so the live-editor count drops to one (B12/R2.1).
 */
export function zoom(l: Layout, paneId: string | null): Layout {
  return editLayout(l, (d) => {
    d.zoom = paneId && findPane(d, paneId) ? paneId : null
  })
}

/**
 * The pane on `side` of this one, by geometry — the component measures the
 * rects, this picks. Ties break towards the pane whose centre is closest on
 * the perpendicular axis, so `focus-right` from a tall pane lands next to
 * where you were looking.
 */
export function neighbour(
  l: Layout,
  paneId: string,
  side: Side,
  rects: Record<string, Rect>
): string | null {
  const cur = rects[paneId]
  if (!cur) return null
  const cx = cur.x + cur.width / 2
  const cy = cur.y + cur.height / 2
  let best: string | null = null
  let bestD = Infinity
  for (const p of panes(l.tree)) {
    if (p.id === paneId) continue
    const r = rects[p.id]
    if (!r) continue
    const ok =
      side === 'left'
        ? r.x + r.width <= cur.x + 1
        : side === 'right'
          ? r.x >= cur.x + cur.width - 1
          : side === 'up'
            ? r.y + r.height <= cur.y + 1
            : r.y >= cur.y + cur.height - 1
    if (!ok) continue
    const dx = r.x + r.width / 2 - cx
    const dy = r.y + r.height / 2 - cy
    const horizontal = side === 'left' || side === 'right'
    const d = Math.hypot(dx, dy) + (horizontal ? Math.abs(dy) : Math.abs(dx)) * 2
    if (d < bestD) {
      bestD = d
      best = p.id
    }
  }
  return best
}

/**
 * Which of a pane's five drop zones a pointer is in (B10): the outer 25 % of
 * each side splits there, the middle joins the strip. The nearest edge wins a
 * corner.
 */
export function zoneAt(rect: Rect, x: number, y: number): 'center' | Side {
  if (rect.width <= 0 || rect.height <= 0) return 'center'
  const fx = (x - rect.x) / rect.width
  const fy = (y - rect.y) / rect.height
  const bands: [Side, number][] = [
    ['left', fx],
    ['right', 1 - fx],
    ['up', fy],
    ['down', 1 - fy],
  ]
  const near = bands.filter(([, d]) => d < EDGE_BAND).sort((a, b) => a[1] - b[1])
  return near.length ? near[0][0] : 'center'
}

// ---- keeping the layout honest against the vault (R5) ----

function fixHistoryAt(t: Tab): void {
  if (!t.history.length) {
    t.historyAt = -1
    return
  }
  const here = t.path ? t.history.lastIndexOf(t.path) : -1
  t.historyAt = here >= 0 ? here : Math.min(Math.max(t.historyAt, 0), t.history.length - 1)
}

/** Tabs and history entries for paths that no longer exist go away. */
export function prune(
  l: Layout,
  live: ReadonlySet<string>,
  ids: () => string = nextId
): Layout {
  return editLayout(l, (d) => {
    for (const p of panes(d.tree)) {
      const dead = p.tabs.filter((t) => t.path !== null && !live.has(t.path)).map((t) => t.id)
      if (dead.length) detachTabs(p, dead)
      for (const t of p.tabs) {
        t.history = t.history.filter((h) => live.has(h))
        fixHistoryAt(t)
      }
    }
    closeEmptyPanes(d, ids)
  })
}

function renamed(path: string, from: string, to: string): string {
  if (path === from) return to
  return path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
}

/**
 * Follow a rename, prefix-wise, through tabs and their histories. A rename can
 * collide two tabs of one pane onto the same path; the later one closes, since
 * one note per pane is the rule (R3).
 */
export function rename(l: Layout, from: string, to: string, ids: () => string = nextId): Layout {
  return editLayout(l, (d) => {
    for (const p of panes(d.tree)) {
      for (const t of p.tabs) {
        if (t.path) t.path = renamed(t.path, from, to)
        t.history = t.history.map((h) => renamed(h, from, to))
        fixHistoryAt(t)
      }
      const seen = new Set<string>()
      const collided: string[] = []
      for (const t of p.tabs) {
        if (t.path === null) continue
        if (seen.has(t.path)) collided.push(t.id)
        else seen.add(t.path)
      }
      if (collided.length) detachTabs(p, collided)
    }
    closeEmptyPanes(d, ids)
  })
}

/** Everything under a folder goes: an unshared or absorbed mount, a delete. */
export function closeUnder(l: Layout, prefix: string, ids: () => string = nextId): Layout {
  const inside = (path: string): boolean =>
    path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)
  return editLayout(l, (d) => {
    for (const p of panes(d.tree)) {
      const dead = p.tabs.filter((t) => t.path !== null && inside(t.path)).map((t) => t.id)
      if (dead.length) detachTabs(p, dead)
      for (const t of p.tabs) {
        t.history = t.history.filter((h) => !inside(h))
        fixHistoryAt(t)
      }
    }
    closeEmptyPanes(d, ids)
  })
}

/**
 * The active path of every pane ON SCREEN — what the facade turns into
 * `setOpenPaths` per mount (S9-Q1). A zoomed layout has one, which is the
 * whole point of zoom's memory story (R2.1).
 */
export function liveGuidsInput(l: Layout): { paneId: string; path: string }[] {
  const visible = l.zoom ? [findPane(l, l.zoom)].filter((p): p is Pane => p !== null) : panes(l.tree)
  const out: { paneId: string; path: string }[] = []
  for (const p of visible) {
    const a = activeTab(p)
    if (a?.path) out.push({ paneId: p.id, path: a.path })
  }
  return out
}

// ---- persistence shape ----

export function serialize(l: Layout): unknown {
  const copy = cloneLayout(l)
  return { version: LAYOUT_VERSION, tree: copy.tree, focus: copy.focus, zoom: copy.zoom }
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * Sizes as stored, repaired only where they are wrong: Chris's four panes are
 * all at hand-dragged percentages (18.76 / 56.71 / 72.47), so a round-trip
 * that "tidies" them is a bug, not a normalisation.
 */
function clampSizes(raw: unknown, n: number): number[] {
  if (!Array.isArray(raw) || raw.length !== n) return evenSizes(n)
  const nums = raw.map((s) => (typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : NaN))
  if (nums.some(Number.isNaN)) return evenSizes(n)
  const sum = nums.reduce((a, b) => a + b, 0)
  let out = Math.abs(sum - 100) > 0.5 ? nums.map((s) => (s * 100) / sum) : nums
  if (out.some((s) => s < MIN_SIZE)) {
    if (n * MIN_SIZE > 100) return evenSizes(n)
    const spare = 100 - out.filter((s) => s < MIN_SIZE).length * MIN_SIZE
    const rest = out.filter((s) => s >= MIN_SIZE).reduce((a, b) => a + b, 0)
    out = out.map((s) => (s < MIN_SIZE ? MIN_SIZE : (s * spare) / rest))
  }
  return out
}

function normalizeTab(raw: unknown, ids: () => string): Tab | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const path = typeof r.path === 'string' ? r.path : null
  const cur = r.cursor as Record<string, unknown> | null | undefined
  const cursor =
    cur && typeof cur === 'object' && typeof cur.anchor === 'number' && typeof cur.head === 'number'
      ? { anchor: cur.anchor, head: cur.head }
      : null
  const history = Array.isArray(r.history) ? r.history.filter((h): h is string => typeof h === 'string') : []
  const t: Tab = {
    id: str(r.id, ids()),
    path,
    pinned: r.pinned === true,
    cursor,
    scroll: Math.max(0, num(r.scroll, 0)),
    history,
    historyAt: Math.round(num(r.historyAt, history.length - 1)),
  }
  fixHistoryAt(t)
  return t
}

function normalizeGroup(raw: unknown, tabIds: Set<string>, ids: () => string): Group | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const members = Array.isArray(r.tabIds)
    ? r.tabIds.filter((id): id is string => typeof id === 'string' && tabIds.has(id))
    : []
  if (!members.length) return null
  const color = Math.round(num(r.color, 1))
  return {
    id: str(r.id, ids()),
    name: str(r.name, ''),
    color: (color >= 1 && color <= 8 ? color : 1) as GroupColor,
    collapsed: r.collapsed === true,
    tabIds: members,
    lastActive: num(r.lastActive, 0),
  }
}

function normalizeNode(raw: unknown, ids: () => string): Node | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.kind === 'pane') {
    const tabs = Array.isArray(r.tabs)
      ? r.tabs.map((t) => normalizeTab(t, ids)).filter((t): t is Tab => t !== null)
      : []
    const list = tabs.length ? tabs : [newTab(ids)]
    const seen = new Set(list.map((t) => t.id))
    const groups = Array.isArray(r.groups)
      ? r.groups.map((g) => normalizeGroup(g, seen, ids)).filter((g): g is Group => g !== null)
      : []
    const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : list[0].id
    return { kind: 'pane', id: str(r.id, ids()), tabs: list, groups, active }
  }
  if (r.kind === 'split') {
    const children = Array.isArray(r.children)
      ? r.children.map((c) => normalizeNode(c, ids)).filter((c): c is Node => c !== null)
      : []
    if (!children.length) return null
    if (children.length === 1) return children[0]
    return {
      kind: 'split',
      id: str(r.id, ids()),
      dir: r.dir === 'col' ? 'col' : 'row',
      children,
      sizes: clampSizes(r.sizes, children.length),
    }
  }
  return null
}

/**
 * Tolerant read of whatever the device store holds. Anything that is not this
 * version's shape answers null so the caller can start fresh — a layout is a
 * device convenience, never data (R4.3).
 */
export function normalize(raw: unknown, ids: () => string = nextId): Layout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.version !== LAYOUT_VERSION) return null
  const tree = normalizeNode(r.tree, ids)
  if (!tree) return null
  const l: Layout = {
    tree,
    focus: str(r.focus, ''),
    zoom: typeof r.zoom === 'string' ? r.zoom : null,
  }
  settleLayout(l)
  return l
}
