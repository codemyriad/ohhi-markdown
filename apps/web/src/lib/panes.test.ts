import { describe, expect, it } from 'vitest'
import {
  activate,
  activeTab,
  canTravel,
  closedTabOf,
  closeOthers,
  closePane,
  closeTab,
  closeUnder,
  createLayout,
  editLayout,
  equalize,
  focusNext,
  focusPane,
  groupAtIndex,
  groupOf,
  liveGuidsInput,
  moveTab,
  navigateInTab,
  neighbour,
  normalize,
  openPath,
  openPathAt,
  panes,
  parentOf,
  prune,
  rename,
  reorder,
  resize,
  resizeBy,
  rotate,
  reopenTab,
  serialize,
  split,
  splitWith,
  stripItems,
  swapPanes,
  tabOf,
  travelTab,
  visibleTabs,
  zoneAt,
  zoom,
  type Layout,
  type Pane,
  type Split,
} from './panes.js'
import {
  chris,
  chrisRaw,
  ids,
  paneAt,
  pathsOf,
  rawPane,
  strip,
  tabIdFor,
  trailOf,
  TOP,
} from './panes.fixture.js'

const asSplit = (l: Layout): Split => l.tree as Split

describe('serialize / normalize', () => {
  it("round-trips Chris's real 4-pane tree through JSON, sizes intact", () => {
    const raw = chrisRaw()
    const l = chris()
    expect(panes(l.tree).map((p) => p.tabs.length)).toEqual([11, 5, 2, 3])
    // The exact JSON `serialize` produces is what `normalize` must accept —
    // including a trip through localStorage's string round-trip.
    const once = serialize(l)
    expect(once).toEqual(raw)
    const back = normalize(JSON.parse(JSON.stringify(once)), ids('r'))
    expect(serialize(back!)).toEqual(once)
    // None of his four panes sits at a default size; tidying them would move
    // his layout on every load.
    expect(asSplit(back!).sizes).toEqual([18.76, 81.24])
    const bottom = asSplit(back!).children[1] as Split
    expect(bottom.sizes).toEqual([56.71, 43.29])
    expect((bottom.children[0] as Split).sizes).toEqual([72.47, 27.53])
  })

  it('keeps the groups, the collapse state and the active tabs', () => {
    const l = chris()
    const top = paneAt(l, 0)
    expect(top.groups.map((g) => [g.name, g.color, g.collapsed])).toEqual([
      ['CS reading', 6, true],
      ['Myriad', 3, false],
    ])
    expect(activeTab(top)?.path).toBe('Myriad Distribution Push.md')
    expect(activeTab(paneAt(l, 3))?.path).toBe('Edible/Edible Distribution Push (Aug 2026).md')
    expect(l.focus).toBe('bl')
  })

  it('re-ids a duplicate rather than letting two tabs answer to one id', () => {
    const l = normalize(
      {
        version: 1,
        tree: {
          kind: 'split',
          id: 'p',
          dir: 'row',
          sizes: [50, 50],
          // Two panes, two tabs, one id each — a hand-edited blob, or two
          // devices' trees pasted together.
          children: [
            { ...(rawPane('p', ['a.md', 'b.md']) as Record<string, unknown>), active: 'pt1' },
            rawPane('p', ['c.md']),
          ],
        },
        focus: 'p',
        zoom: null,
      },
      ids('u')
    )!
    const all = panes(l.tree)
    expect(all).toHaveLength(2)
    expect(all[0].id).not.toBe(all[1].id)
    const everyId = all.flatMap((p) => [p.id, ...p.tabs.map((t) => t.id)])
    expect(new Set(everyId).size).toBe(everyId.length)
    // The remap carried `active` and the group memberships across the re-id.
    expect(activeTab(all[0])?.path).toBe('b.md')
  })

  it('keeps a stored trail written as bare paths (the shape before resume points)', () => {
    const l = normalize(
      {
        version: 1,
        tree: {
          kind: 'pane',
          id: 'p',
          tabs: [
            {
              id: 't',
              path: 'b.md',
              pinned: false,
              cursor: null,
              scroll: 0,
              history: ['a.md', 'b.md'],
              historyAt: 1,
            },
          ],
          groups: [],
          active: 't',
        },
        focus: 'p',
        zoom: null,
      },
      ids('h')
    )!
    expect(trailOf(paneAt(l, 0).tabs[0])).toEqual(['a.md', 'b.md'])
    expect(paneAt(l, 0).tabs[0].history[0].cursor).toBeNull()
  })

  it('answers null for anything that is not this version of the shape', () => {
    expect(normalize(null)).toBeNull()
    expect(normalize('a layout, honest')).toBeNull()
    expect(normalize({})).toBeNull()
    expect(normalize({ version: 99, tree: { kind: 'pane', tabs: [] } })).toBeNull()
    expect(normalize({ version: 1, tree: { kind: 'nope' } })).toBeNull()
    expect(normalize({ version: 1, tree: { kind: 'split', children: [] } })).toBeNull()
  })

  it('clamps stored sizes and repairs the ones it cannot trust', () => {
    const two = (sizes: unknown): unknown => ({
      version: 1,
      tree: {
        kind: 'split',
        id: 's',
        dir: 'row',
        sizes,
        children: [rawPane('a', ['a.md']), rawPane('b', ['b.md'])],
      },
      focus: 'a',
      zoom: null,
    })
    expect(asSplit(normalize(two([2, 98]), ids())!).sizes).toEqual([10, 90])
    expect(asSplit(normalize(two([25, 25]), ids())!).sizes).toEqual([50, 50])
    expect(asSplit(normalize(two(['a', 'b']), ids())!).sizes).toEqual([50, 50])
    expect(asSplit(normalize(two([70]), ids())!).sizes).toEqual([50, 50])
  })

  it('heals a stored pane with no tabs and a split with one child', () => {
    const l = normalize(
      {
        version: 1,
        tree: {
          kind: 'split',
          id: 's',
          dir: 'row',
          sizes: [100],
          children: [{ kind: 'pane', id: 'a', tabs: [], groups: [], active: null }],
        },
        focus: 'a',
        zoom: null,
      },
      ids()
    )
    expect(l?.tree.kind).toBe('pane')
    expect(paneAt(l!, 0).tabs).toHaveLength(1)
    expect(paneAt(l!, 0).tabs[0].path).toBeNull()
  })
})

describe('openPath (Fork 1-B: every open is a tab)', () => {
  it('dedupes per pane and activates the tab that is already there', () => {
    let l = createLayout(ids())
    l = openPath(l, 'a.md', {}, ids('o'))
    const before = paneAt(l, 0).tabs.length
    l = openPath(l, 'a.md', {}, ids('p'))
    expect(paneAt(l, 0).tabs).toHaveLength(before)
    expect(activeTab(paneAt(l, 0))?.path).toBe('a.md')
  })

  it('opens the same note in a second pane — that is the deliberate act', () => {
    let { l, gen } = strip('a.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    l = openPath(l, 'b.md', {}, gen)
    expect(liveGuidsInput(l).map((v) => v.path)).toEqual(['a.md', 'b.md'])
    l = openPath(l, 'a.md', {}, gen)
    expect(liveGuidsInput(l).map((v) => v.path)).toEqual(['a.md', 'a.md'])
  })

  it('inserts after the active tab, inside its group', () => {
    let { l, gen } = strip('a.md', 'b.md', 'c.md')
    const pane = paneAt(l, 0)
    // Group just the middle tab, then open from it.
    const b = tabIdFor(pane, 'b.md')
    l = activate(l, pane.id, b, 1)
    l = { ...l, tree: withGroup(paneAt(l, 0), 'cluster', [b]) }
    l = openPath(l, 'd.md', {}, gen)
    const after = paneAt(l, 0)
    expect(pathsOf(after)).toEqual([null, 'a.md', 'b.md', 'd.md', 'c.md'])
    expect(groupOf(after, tabIdFor(after, 'd.md'))?.name).toBe('cluster')
  })

  it('opens in the background without stealing the active tab', () => {
    let { l, gen } = strip('a.md')
    l = openPath(l, 'b.md', { background: true }, gen)
    expect(activeTab(paneAt(l, 0))?.path).toBe('a.md')
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'a.md', 'b.md'])
  })
})

describe('openPathAt (a file-tree row dropped on a strip — P1.2)', () => {
  it('lands at the spot the hit test named, and takes focus there', () => {
    let { l, gen } = strip('a.md', 'b.md')
    const p = paneAt(l, 0)
    l = openPathAt(l, 'c.md', { paneId: p.id, index: 1 }, gen)
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'c.md', 'a.md', 'b.md'])
    expect(activeTab(paneAt(l, 0))?.path).toBe('c.md')
    expect(l.focus).toBe(p.id)
  })

  it('appends when the drop was past the last slot', () => {
    let { l, gen } = strip('a.md')
    l = openPathAt(l, 'c.md', { paneId: paneAt(l, 0).id }, gen)
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'a.md', 'c.md'])
  })

  it('joins the group the spot names — the tail rule, applied (P1.1)', () => {
    let { l, gen } = strip('a.md', 'b.md')
    const b = tabIdFor(paneAt(l, 0), 'b.md')
    l = { ...l, tree: withGroup(paneAt(l, 0), 'cluster', [b]) }
    const p = paneAt(l, 0)
    // Right after the group's only tab, with its id forced: inside it.
    l = openPathAt(l, 'c.md', { paneId: p.id, index: 3, groupId: 'g-cluster' }, gen)
    const after = paneAt(l, 0)
    expect(pathsOf(after)).toEqual([null, 'a.md', 'b.md', 'c.md'])
    expect(groupOf(after, tabIdFor(after, 'c.md'))?.name).toBe('cluster')
  })

  it('moves the tab that is already there rather than twinning it (R3)', () => {
    let { l, gen } = strip('a.md', 'b.md')
    const p = paneAt(l, 0)
    const held = tabIdFor(p, 'b.md')
    l = openPathAt(l, 'b.md', { paneId: p.id, index: 1 }, gen)
    const after = paneAt(l, 0)
    expect(pathsOf(after)).toEqual([null, 'b.md', 'a.md'])
    // The SAME tab, so its cursor and its trail came with it.
    expect(tabIdFor(after, 'b.md')).toBe(held)
  })

  it('does nothing for a pane that is not there', () => {
    const { l, gen } = strip('a.md')
    expect(pathsOf(paneAt(openPathAt(l, 'c.md', { paneId: 'gone' }, gen), 0))).toEqual([
      null,
      'a.md',
    ])
  })
})

/** A group over existing tabs, without going through groups.ts. */
function withGroup(p: Pane, name: string, tabIds: string[]): Pane {
  return {
    ...p,
    groups: [
      ...p.groups,
      { id: `g-${name}`, name, color: 1, collapsed: false, tabIds, lastActive: 0 },
    ],
  }
}

describe('closing tabs and panes', () => {
  it('closes the pane with its last tab, unless it is the only pane', () => {
    let { l, gen } = strip('a.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    expect(panes(l.tree)).toHaveLength(2)
    const second = paneAt(l, 1)
    for (const t of [...second.tabs]) l = closeTab(l, t.id, gen)
    expect(panes(l.tree)).toHaveLength(1)
    expect(l.tree.kind).toBe('pane')
    // The last pane keeps one empty tab: a pane with no strip cannot render.
    const only = paneAt(l, 0)
    for (const t of [...only.tabs]) l = closeTab(l, t.id, gen)
    expect(panes(l.tree)).toHaveLength(1)
    expect(pathsOf(paneAt(l, 0))).toEqual([null])
    expect(activeTab(paneAt(l, 0))).not.toBeNull()
  })

  it('keeps the group contiguous when a member closes', () => {
    let { l, gen } = strip('a.md', 'b.md', 'c.md', 'd.md')
    let pane = paneAt(l, 0)
    const grouped = ['a.md', 'b.md', 'c.md'].map((p) => tabIdFor(pane, p))
    l = { ...l, tree: withGroup(pane, 'cluster', grouped) }
    l = closeTab(l, grouped[1], gen)
    pane = paneAt(l, 0)
    expect(pane.groups[0].tabIds).toEqual([grouped[0], grouped[2]])
    const at = pane.groups[0].tabIds.map((id) => pane.tabs.findIndex((t) => t.id === id))
    expect(at[1]).toBe(at[0] + 1)
  })

  it('close-others keeps the active and the pinned tabs, and saves emptied groups', () => {
    let { l, gen } = strip('a.md', 'b.md', 'c.md', 'd.md')
    let pane = paneAt(l, 0)
    const pin = tabIdFor(pane, 'a.md')
    pane = { ...pane, tabs: pane.tabs.map((t) => (t.id === pin ? { ...t, pinned: true } : t)) }
    const cluster = ['b.md', 'c.md'].map((p) => tabIdFor(pane, p))
    l = activate({ ...l, tree: withGroup(pane, 'cluster', cluster) }, pane.id, tabIdFor(pane, 'd.md'), 1)
    const { layout, saved } = closeOthers(l, pane.id, gen, 7)
    expect(pathsOf(paneAt(layout, 0))).toEqual(['a.md', 'd.md'])
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('cluster')
    expect(saved[0].tabs.map((t) => t.path)).toEqual(['b.md', 'c.md'])
    expect(saved[0].lastActive).toBe(7)
  })

  it('close-pane saves its groups, moves pinned tabs next door and returns the share', () => {
    let { l, gen } = strip('keep.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    let doomed = paneAt(l, 1)
    l = openPath(l, 'x.md', { paneId: doomed.id }, gen)
    l = openPath(l, 'y.md', { paneId: doomed.id }, gen)
    doomed = paneAt(l, 1)
    const pin = tabIdFor(doomed, 'x.md')
    const cluster = [tabIdFor(doomed, 'y.md')]
    const pinned = { ...doomed, tabs: doomed.tabs.map((t) => (t.id === pin ? { ...t, pinned: true } : t)) }
    l = { ...l, tree: replacePane(l, doomed.id, withGroup(pinned, 'cluster', cluster)) }
    const { layout, saved } = closePane(l, doomed.id, 11)
    expect(panes(layout.tree)).toHaveLength(1)
    expect(saved.map((g) => [g.name, g.tabs.map((t) => t.path)])).toEqual([['cluster', ['y.md']]])
    // The pinned tab moved next door; the survivor took the whole width back.
    expect(pathsOf(paneAt(layout, 0))).toContain('x.md')
    expect(layout.tree.kind).toBe('pane')
  })

  it('never closes the last pane', () => {
    const { l } = strip('a.md')
    const { layout, saved } = closePane(l, paneAt(l, 0).id)
    expect(panes(layout.tree)).toHaveLength(1)
    expect(saved).toEqual([])
  })
})

/** Swap one pane for an edited copy, for the fixtures above. */
function replacePane(l: Layout, id: string, next: Pane): Layout['tree'] {
  const walk = (n: Layout['tree']): Layout['tree'] => {
    if (n.kind === 'pane') return n.id === id ? next : n
    return { ...n, children: n.children.map(walk) }
  }
  return walk(l.tree)
}

describe('splitting', () => {
  it('duplicates the active path into the new pane and halves the share', () => {
    let { l, gen } = strip('a.md')
    let pane = paneAt(l, 0)
    pane = { ...pane, tabs: pane.tabs.map((t) => (t.path === 'a.md' ? { ...t, scroll: 42, cursor: { anchor: 3, head: 5 } } : t)) }
    l = split({ ...l, tree: pane }, pane.id, 'row', gen)
    expect(asSplit(l).sizes).toEqual([50, 50])
    const fresh = paneAt(l, 1)
    expect(pathsOf(fresh)).toEqual(['a.md'])
    expect(fresh.tabs[0].scroll).toBe(42)
    expect(fresh.tabs[0].cursor).toEqual({ anchor: 3, head: 5 })
    expect(l.focus).toBe(fresh.id)
    // A second split in the same direction is absorbed by the parent.
    l = split(l, fresh.id, 'row', gen)
    expect(asSplit(l).children).toHaveLength(3)
    expect(asSplit(l).sizes).toEqual([50, 25, 25])
  })

  it('splitWith drops a tab on all four sides', () => {
    const build = (): { l: Layout; a: Pane; b: Pane; gen: () => string } => {
      let { l, gen } = strip('a.md')
      l = openPath(l, 'a2.md', {}, gen)
      l = split(l, paneAt(l, 0).id, 'row', gen)
      return { l, a: paneAt(l, 0), b: paneAt(l, 1), gen }
    }
    // right / left: the parent row split absorbs the new pane, halving B.
    for (const [side, at] of [
      ['right', 2],
      ['left', 1],
    ] as const) {
      const { l, a, b, gen } = build()
      const moved = tabIdFor(a, 'a2.md')
      const next = splitWith(l, b.id, side, { tabIds: [moved] }, gen)
      const root = asSplit(next)
      expect(root.dir).toBe('row')
      expect(root.children).toHaveLength(3)
      expect(root.sizes).toEqual([50, 25, 25])
      expect(pathsOf(root.children[at] as Pane)).toEqual(['a2.md'])
      expect(next.focus).toBe((root.children[at] as Pane).id)
    }
    // up / down: a new split of two replaces B inside the row.
    for (const [side, at] of [
      ['down', 1],
      ['up', 0],
    ] as const) {
      const { l, a, b, gen } = build()
      const next = splitWith(l, b.id, side, { tabIds: [tabIdFor(a, 'a2.md')] }, gen)
      const root = asSplit(next)
      expect(root.sizes).toEqual([50, 50])
      const inner = root.children[1] as Split
      expect(inner.kind).toBe('split')
      expect(inner.dir).toBe('col')
      expect(inner.sizes).toEqual([50, 50])
      expect(pathsOf(inner.children[at] as Pane)).toEqual(['a2.md'])
    }
  })

  it('carries a whole group across, and refuses to re-split a pane with itself', () => {
    let { l, gen } = strip('a.md', 'b.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    const source = paneAt(l, 0)
    const cluster = ['a.md', 'b.md'].map((p) => tabIdFor(source, p))
    l = { ...l, tree: replacePane(l, source.id, withGroup(source, 'cluster', cluster)) }
    const next = splitWith(l, paneAt(l, 1).id, 'down', { tabIds: cluster }, gen, 3)
    const landed = panes(next.tree).find((p) => p.tabs.some((t) => t.path === 'a.md'))!
    expect(landed.groups.map((g) => g.name)).toEqual(['cluster'])
    expect(landed.groups[0].tabIds).toHaveLength(2)
    // The whole payload onto its own pane's edge is a no-op, not a rebuild.
    const same = splitWith(next, landed.id, 'left', { tabIds: landed.tabs.map((t) => t.id) }, gen)
    expect(panes(same.tree)).toHaveLength(panes(next.tree).length)
  })
})

describe('moving tabs', () => {
  it('moves to another pane, and activates instead of duplicating', () => {
    let { l, gen } = strip('a.md', 'b.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    const from = paneAt(l, 0)
    const to = paneAt(l, 1)
    expect(pathsOf(to)).toEqual(['b.md'])
    let next = moveTab(l, tabIdFor(from, 'a.md'), to.id)
    expect(pathsOf(paneAt(next, 1))).toEqual(['b.md', 'a.md'])
    expect(next.focus).toBe(to.id)
    // 'b.md' is open in both: the move drops the copy and activates the one there.
    next = moveTab(l, tabIdFor(from, 'b.md'), to.id)
    expect(pathsOf(paneAt(next, 1))).toEqual(['b.md'])
    expect(pathsOf(paneAt(next, 0))).toEqual([null, 'a.md'])
    expect(activeTab(paneAt(next, 1))?.path).toBe('b.md')
  })

  it('joins the group it lands inside, and leaves it at the strip edge', () => {
    let { l, gen } = strip('a.md', 'b.md', 'c.md', 'loose.md')
    let pane = paneAt(l, 0)
    const cluster = ['a.md', 'b.md', 'c.md'].map((p) => tabIdFor(pane, p))
    l = { ...l, tree: withGroup(pane, 'cluster', cluster) }
    pane = paneAt(l, 0)
    const loose = tabIdFor(pane, 'loose.md')
    // strip is [empty, a, b, c, loose]; dropping between a and b joins.
    expect(groupAtIndex(pane, 2, loose)).toBe(pane.groups[0].id)
    expect(groupAtIndex(pane, 1, loose)).toBeNull()
    const joined = reorder(l, pane.id, loose, 2)
    const after = paneAt(joined, 0)
    expect(pathsOf(after)).toEqual([null, 'a.md', 'loose.md', 'b.md', 'c.md'])
    expect(after.groups[0].tabIds).toHaveLength(4)
    // Sent to the far end it leaves the group, and the group closes back up.
    const left = reorder(joined, after.id, loose, after.tabs.length)
    const end = paneAt(left, 0)
    expect(pathsOf(end)).toEqual([null, 'a.md', 'b.md', 'c.md', 'loose.md'])
    expect(end.groups[0].tabIds).toHaveLength(3)
  })

  it('leaves the source group contiguous, and closes a pane it emptied', () => {
    let { l, gen } = strip('a.md', 'b.md', 'c.md')
    let from = paneAt(l, 0)
    const cluster = ['a.md', 'b.md', 'c.md'].map((p) => tabIdFor(from, p))
    l = { ...l, tree: withGroup(from, 'cluster', cluster) }
    l = split(l, paneAt(l, 0).id, 'row', gen)
    from = paneAt(l, 0)
    const to = paneAt(l, 1)
    const moved = moveTab(l, tabIdFor(from, 'b.md'), to.id)
    const rest = paneAt(moved, 0)
    expect(rest.groups[0].tabIds).toEqual([tabIdFor(rest, 'a.md'), tabIdFor(rest, 'c.md')])
    expect(pathsOf(rest)).toEqual([null, 'a.md', 'c.md'])
    // The tab arrives loose: it did not land between two tabs of a group.
    const landed = paneAt(moved, 1)
    expect(groupOf(landed, tabIdFor(landed, 'b.md'))).toBeNull()
    // Dragging a pane's last tab out closes the pane (the mock's rule).
    const solo = closeTab(moved, paneAt(moved, 1).tabs[0].id, gen)
    expect(panes(solo.tree)).toHaveLength(2)
    const emptied = moveTab(solo, paneAt(solo, 1).tabs[0].id, paneAt(solo, 0).id)
    expect(panes(emptied.tree)).toHaveLength(1)
  })

  it('reorders within the strip by the index the drop indicator points at', () => {
    let { l, gen } = strip('a.md', 'b.md', 'c.md')
    const pane = paneAt(l, 0)
    l = reorder(l, pane.id, tabIdFor(pane, 'c.md'), 1)
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'c.md', 'a.md', 'b.md'])
  })

  it('swaps two panes without moving their shares', () => {
    let { l, gen } = strip('a.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    l = resize(l, asSplit(l).id, 0, 20)
    const [a, b] = panes(l.tree)
    const next = swapPanes(l, a.id, b.id)
    expect(panes(next.tree).map((p) => p.id)).toEqual([b.id, a.id])
    expect(asSplit(next).sizes).toEqual([70, 30])
  })
})

describe('resizing', () => {
  it('clamps a border at 10 % on either side', () => {
    let { l, gen } = strip('a.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    const id = asSplit(l).id
    expect(asSplit(resize(l, id, 0, 200)).sizes).toEqual([90, 10])
    expect(asSplit(resize(l, id, 0, -200)).sizes).toEqual([10, 90])
    expect(asSplit(resize(l, id, 0, 5)).sizes).toEqual([55, 45])
    // A border that is not there does nothing at all.
    expect(asSplit(resize(l, id, 5, 10)).sizes).toEqual([50, 50])
  })

  it('resizeBy walks to the nearest ancestor split on the right axis', () => {
    const l = chris()
    const bl = paneAt(l, 1)
    const stack = (x: Layout): Split => (asSplit(x).children[1] as Split).children[0] as Split
    const row = (x: Layout): Split => asSplit(x).children[1] as Split
    // 'up'/'down' act on the col split holding bl and the dailies…
    expect(stack(resizeBy(l, bl.id, 'up', 5)).sizes).toEqual([67.47, 32.53])
    expect(stack(resizeBy(l, bl.id, 'down', 5)).sizes).toEqual([77.47, 22.53])
    // …'left'/'right' skip it for the row split above.
    expect(row(resizeBy(l, bl.id, 'left', 5)).sizes).toEqual([51.71, 48.29])
    expect(row(resizeBy(l, bl.id, 'right', 5)).sizes).toEqual([61.71, 38.29])
    // With no split on that axis at all, nothing moves.
    const flat = openPath(createLayout(ids()), 'a.md', {}, ids())
    expect(resizeBy(flat, paneAt(flat, 0).id, 'left', 5).tree).toEqual(flat.tree)
  })

  it('equalizes every split in the tree', () => {
    const l = equalize(chris())
    expect(asSplit(l).sizes).toEqual([50, 50])
    const bottom = asSplit(l).children[1] as Split
    expect(bottom.sizes).toEqual([50, 50])
    expect((bottom.children[0] as Split).sizes).toEqual([50, 50])
  })
})

describe('focus, rotate and zoom', () => {
  it('rotates the split the pane sits in', () => {
    const l = chris()
    const bl = paneAt(l, 1)
    const next = rotate(l, bl.id)
    expect(((asSplit(next).children[1] as Split).children[0] as Split).dir).toBe('row')
  })

  it('cycles focus through the panes in strip order', () => {
    let l = chris()
    const order = panes(l.tree).map((p) => p.id)
    expect(l.focus).toBe(order[1])
    l = focusNext(l)
    expect(l.focus).toBe(order[2])
    l = focusNext(focusNext(l))
    expect(l.focus).toBe(order[0])
  })

  it('picks the neighbour on a side from the rects the component measured', () => {
    const l = chris()
    const [top, bl, daily, right] = panes(l.tree)
    const rects = {
      [top.id]: { x: 0, y: 0, width: 1000, height: 200 },
      [bl.id]: { x: 0, y: 200, width: 560, height: 580 },
      [daily.id]: { x: 0, y: 780, width: 560, height: 220 },
      [right.id]: { x: 560, y: 200, width: 440, height: 800 },
    }
    expect(neighbour(l, bl.id, 'up', rects)).toBe(top.id)
    expect(neighbour(l, bl.id, 'down', rects)).toBe(daily.id)
    expect(neighbour(l, bl.id, 'right', rects)).toBe(right.id)
    expect(neighbour(l, bl.id, 'left', rects)).toBeNull()
    expect(neighbour(l, top.id, 'up', rects)).toBeNull()
    // Of the three panes below the top one, the closest by centre wins.
    expect(neighbour(l, top.id, 'down', rects)).toBe(bl.id)
    expect(neighbour(l, right.id, 'left', rects)).toBe(bl.id)
    // No rect (a zoomed layout measures one pane) → no neighbour.
    expect(neighbour(l, bl.id, 'up', { [bl.id]: rects[bl.id] })).toBeNull()
  })

  it('zoom leaves one pane on screen, so one view is live', () => {
    const l = chris()
    const bl = paneAt(l, 1)
    expect(liveGuidsInput(l)).toHaveLength(4)
    const zoomed = zoom(l, bl.id)
    expect(zoomed.zoom).toBe(bl.id)
    expect(liveGuidsInput(zoomed)).toEqual([
      { paneId: bl.id, path: 'Edible/Edible Distribution WIP.md' },
    ])
    expect(liveGuidsInput(zoom(zoomed, null))).toHaveLength(4)
    // A structural op cannot leave a hidden pane zoomed.
    expect(rotate(zoomed, bl.id).zoom).toBeNull()
    expect(zoom(l, 'no-such-pane').zoom).toBeNull()
  })

  it('keeps the zoom while focus moves inside it (Zellij), and carries it along', () => {
    const l = chris()
    const [top, bl] = panes(l.tree)
    const zoomed = zoom(l, top.id)
    // Focusing another pane while zoomed zooms THAT one — the alternative is a
    // key that drops you back into four panes every time you move.
    const moved = focusPane(zoomed, bl.id)
    expect(moved.focus).toBe(bl.id)
    expect(moved.zoom).toBe(bl.id)
    const next = focusNext(moved)
    expect(next.zoom).toBe(next.focus)
    expect(next.focus).not.toBe(bl.id)
    // Unzoomed, focus still does not invent one.
    expect(focusNext(l).zoom).toBeNull()
  })

  it('skips a pane whose active tab has no path', () => {
    const gen = ids()
    const l = split(createLayout(gen), 'nope', 'row', gen)
    expect(liveGuidsInput(l)).toEqual([])
  })
})

describe('drop zones', () => {
  it('bands the outer quarter of each side, centre otherwise', () => {
    const r = { x: 0, y: 0, width: 400, height: 400 }
    expect(zoneAt(r, 200, 200)).toBe('center')
    expect(zoneAt(r, 10, 200)).toBe('left')
    expect(zoneAt(r, 390, 200)).toBe('right')
    expect(zoneAt(r, 200, 10)).toBe('up')
    expect(zoneAt(r, 200, 390)).toBe('down')
    // Just inside the band and just outside it.
    expect(zoneAt(r, 99, 200)).toBe('left')
    expect(zoneAt(r, 101, 200)).toBe('center')
    // A corner goes to the nearer edge.
    expect(zoneAt(r, 5, 30)).toBe('left')
    expect(zoneAt(r, 30, 5)).toBe('up')
    // An offset rect, and a rect with no area.
    expect(zoneAt({ x: 100, y: 100, width: 400, height: 400 }, 110, 300)).toBe('left')
    expect(zoneAt({ x: 0, y: 0, width: 0, height: 0 }, 0, 0)).toBe('center')
  })
})

describe('staying honest against the vault (R5)', () => {
  const withHistory = (): Layout =>
    normalize(
      {
        version: 1,
        tree: {
          kind: 'pane',
          id: 'p',
          tabs: [
            { id: 't1', path: 'Notes/b.md', pinned: false, cursor: null, scroll: 0, history: ['Notes/a.md', 'gone.md', 'Notes/b.md'], historyAt: 2 },
            { id: 't2', path: 'gone.md', pinned: false, cursor: null, scroll: 0, history: ['gone.md'], historyAt: 0 },
          ],
          groups: [{ id: 'g', name: 'c', color: 1, collapsed: false, tabIds: ['t1', 't2'], lastActive: 0 }],
          active: 't2',
        },
        focus: 'p',
        zoom: null,
      },
      ids()
    )!

  it('prunes deleted paths out of tabs AND histories', () => {
    const l = prune(withHistory(), new Set(['Notes/a.md', 'Notes/b.md']), ids('e'))
    const p = paneAt(l, 0)
    expect(pathsOf(p)).toEqual(['Notes/b.md'])
    expect(trailOf(p.tabs[0])).toEqual(['Notes/a.md', 'Notes/b.md'])
    expect(p.tabs[0].historyAt).toBe(1)
    expect(p.groups[0].tabIds).toEqual(['t1'])
    expect(activeTab(p)?.path).toBe('Notes/b.md')
  })

  it('follows a rename prefix-wise through tabs and histories', () => {
    const l = rename(withHistory(), 'Notes', 'Archive/Notes')
    const p = paneAt(l, 0)
    expect(pathsOf(p)).toEqual(['Archive/Notes/b.md', 'gone.md'])
    expect(trailOf(p.tabs[0])).toEqual(['Archive/Notes/a.md', 'gone.md', 'Archive/Notes/b.md'])
    // A file rename, not a folder one, and no accidental prefix match.
    const single = rename(withHistory(), 'gone.md', 'here.md')
    expect(pathsOf(paneAt(single, 0))).toEqual(['Notes/b.md', 'here.md'])
    const unrelated = rename(withHistory(), 'Note', 'X')
    expect(pathsOf(paneAt(unrelated, 0))).toEqual(['Notes/b.md', 'gone.md'])
  })

  it('closes the second tab when a rename collides two paths in one pane', () => {
    let { l, gen } = strip('a.md', 'b.md')
    l = rename(l, 'b.md', 'a.md', gen)
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'a.md'])
  })

  it('closes everything under an unshared or deleted folder', () => {
    const l = closeUnder(withHistory(), 'Notes', ids('e'))
    const p = paneAt(l, 0)
    expect(pathsOf(p)).toEqual(['gone.md'])
    expect(trailOf(p.tabs[0])).toEqual(['gone.md'])
    // A sibling folder with the same prefix is not under it.
    expect(pathsOf(paneAt(closeUnder(withHistory(), 'Note', ids('e')), 0))).toEqual([
      'Notes/b.md',
      'gone.md',
    ])
  })

  it('closes a pane that pruning emptied, keeping the last one alive', () => {
    let { l, gen } = strip('a.md')
    l = split(l, paneAt(l, 0).id, 'row', gen)
    l = closeTab(l, paneAt(l, 0).tabs[0].id, gen) // drop the empty tab in pane 0
    expect(panes(l.tree)).toHaveLength(2)
    const pruned = prune(l, new Set<string>(), gen)
    expect(panes(pruned.tree)).toHaveLength(1)
    expect(pathsOf(paneAt(pruned, 0))).toEqual([null])
  })
})

describe('stripItems (what a strip draws)', () => {
  it('puts a chip before its run, and folds the run away behind it', () => {
    const l = chris()
    const top = paneAt(l, 0)
    // 'CS reading' is folded (tabs 5–7), 'Myriad' is open (tabs 9–10).
    const shape = stripItems(top).map((i) =>
      i.kind === 'chip' ? `chip:${i.group.name}:${i.index}-${i.endIndex}` : `tab:${i.index}`
    )
    expect(shape).toEqual([
      'tab:0',
      'tab:1',
      'tab:2',
      'tab:3',
      'tab:4',
      'chip:CS reading:5-8',
      'tab:8',
      'chip:Myriad:9-11',
      'tab:9',
      'tab:10',
    ])
    expect(visibleTabs(top).map((t) => t.path)).toEqual([
      ...TOP.slice(0, 5),
      TOP[8],
      TOP[9],
      TOP[10],
    ])
  })
})

/** Stand in for the live view reporting where it was (`PaneShell.setResume`). */
function setResume(l: Layout, tabId: string, at: number, scroll: number): Layout {
  return editLayout(l, (d) => {
    const t = tabOf(d, tabId)
    if (!t) return
    t.cursor = { anchor: at, head: at }
    t.scroll = scroll
  })
}

describe('per-tab history (Fork 4)', () => {
  it('fills an empty tab, then pushes the trail as links are followed', () => {
    const gen = ids()
    const l0 = createLayout(gen)
    const empty = paneAt(l0, 0).tabs[0].id
    let l = navigateInTab(l0, empty, 'a.md', 1)
    expect(pathsOf(paneAt(l, 0))).toEqual(['a.md'])
    expect(trailOf(tabOf(l, empty))).toEqual(['a.md'])
    expect(tabOf(l, empty)).toMatchObject({ historyAt: 0 })

    l = navigateInTab(l, empty, 'b.md', 2)
    expect(trailOf(tabOf(l, empty))).toEqual(['a.md', 'b.md'])
    expect(tabOf(l, empty)).toMatchObject({ path: 'b.md', historyAt: 1 })
    // Still ONE tab: following a link navigates, it does not open (B5).
    expect(paneAt(l, 0).tabs).toHaveLength(1)
  })

  it('walks back and forward without rewriting the trail, and truncates on a new turn', () => {
    const gen = ids()
    let l = createLayout(gen)
    const t = paneAt(l, 0).tabs[0].id
    for (const p of ['a.md', 'b.md', 'c.md']) l = navigateInTab(l, t, p, 1)

    l = travelTab(l, t, -1)
    expect(tabOf(l, t)).toMatchObject({ path: 'b.md', historyAt: 1 })
    l = travelTab(l, t, -1)
    expect(tabOf(l, t)).toMatchObject({ path: 'a.md', historyAt: 0 })
    expect(canTravel(tabOf(l, t), -1)).toBe(false)
    l = travelTab(l, t, -1) // nothing to go back to
    expect(tabOf(l, t)?.path).toBe('a.md')

    l = travelTab(l, t, 1)
    expect(tabOf(l, t)?.path).toBe('b.md')
    // A new turn from here drops what was ahead — the browser rule.
    l = navigateInTab(l, t, 'd.md', 3)
    expect(trailOf(tabOf(l, t))).toEqual(['a.md', 'b.md', 'd.md'])
    expect(canTravel(tabOf(l, t), 1)).toBe(false)
  })

  it('lands back at the cursor and scroll each entry was left at', () => {
    const gen = ids()
    let l = createLayout(gen)
    const t = paneAt(l, 0).tabs[0].id
    l = navigateInTab(l, t, 'a.md', 1)
    // What the live view reports on its way out (B2) — the shell captures it
    // before it navigates, so the entry being left knows where you were.
    l = setResume(l, t, 12, 40)
    l = navigateInTab(l, t, 'b.md', 2)
    expect(tabOf(l, t)).toMatchObject({ path: 'b.md', cursor: null, scroll: 0 })
    l = setResume(l, t, 3, 8)

    l = travelTab(l, t, -1)
    expect(tabOf(l, t)).toMatchObject({
      path: 'a.md',
      cursor: { anchor: 12, head: 12 },
      scroll: 40,
    })
    l = travelTab(l, t, 1)
    expect(tabOf(l, t)).toMatchObject({ path: 'b.md', cursor: { anchor: 3, head: 3 }, scroll: 8 })
  })

  it('activates the tab that already holds the target instead of duplicating it (R3)', () => {
    let { l, gen } = strip('a.md', 'b.md')
    const pane = paneAt(l, 0)
    const a = tabIdFor(pane, 'a.md')
    const b = tabIdFor(pane, 'b.md')
    l = navigateInTab(l, b, 'a.md', 4)
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'a.md', 'b.md'])
    expect(activeTab(paneAt(l, 0))?.id).toBe(a)
    // The travelling tab kept its own path and trail.
    expect(tabOf(l, b)?.path).toBe('b.md')
  })

  it('drops the resume point when the tab goes somewhere else', () => {
    const gen = ids()
    let l = createLayout(gen)
    const t = paneAt(l, 0).tabs[0].id
    l = navigateInTab(l, t, 'a.md', 1)
    let pane = paneAt(l, 0)
    pane = { ...pane, tabs: pane.tabs.map((x) => ({ ...x, cursor: { anchor: 9, head: 9 }, scroll: 40 })) }
    l = { ...l, tree: pane }
    l = navigateInTab(l, t, 'b.md', 2)
    expect(tabOf(l, t)).toMatchObject({ cursor: null, scroll: 0 })
  })
})

describe('tree reading helpers', () => {
  it('finds parents and panes in DFS order', () => {
    const l = chris()
    const [top, bl] = panes(l.tree)
    expect(parentOf(l, top.id)?.id).toBe('s1')
    expect(parentOf(l, bl.id)?.id).toBe('s3')
    expect(parentOf(l, l.tree.id)).toBeNull()
    expect(panes(l.tree).map((p) => p.id)).toEqual(['top', 'bl', 'daily', 'right'])
  })

  it('snapshots a tab so it can be reopened where it was', () => {
    let { l, gen } = strip('a.md', 'b.md')
    let pane = paneAt(l, 0)
    pane = { ...pane, tabs: pane.tabs.map((t) => (t.path === 'a.md' ? { ...t, scroll: 12 } : t)) }
    l = { ...l, tree: pane }
    const id = tabIdFor(pane, 'a.md')
    expect(tabOf(l, id)?.path).toBe('a.md')
    const closed = closedTabOf(l, id)!
    l = closeTab(l, id, gen)
    expect(pathsOf(paneAt(l, 0))).toEqual([null, 'b.md'])
    l = reopenTab(l, closed, gen)
    const back = paneAt(l, 0)
    expect(pathsOf(back)).toEqual([null, 'b.md', 'a.md'])
    expect(back.tabs.find((t) => t.path === 'a.md')?.scroll).toBe(12)
    expect(activeTab(back)?.path).toBe('a.md')
    // Reopening something already open activates it instead (R3).
    l = reopenTab(l, closed, gen)
    expect(paneAt(l, 0).tabs.filter((t) => t.path === 'a.md')).toHaveLength(1)
    expect(closedTabOf(l, 'ghost')).toBeNull()
  })

  it('never mutates the layout it was given', () => {
    const l = chris()
    const before = JSON.stringify(serialize(l))
    openPath(l, 'new.md', {}, ids())
    closeTab(l, paneAt(l, 0).tabs[0].id, ids())
    split(l, paneAt(l, 0).id, 'row', ids())
    closePane(l, paneAt(l, 1).id)
    prune(l, new Set(), ids())
    expect(JSON.stringify(serialize(l))).toBe(before)
  })
})
