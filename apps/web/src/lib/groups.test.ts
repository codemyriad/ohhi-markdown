import { describe, expect, it } from 'vitest'
import {
  addToGroup,
  closeGroup,
  deleteGroup,
  groupFromLinks,
  groupPaths,
  groupRows,
  linksOf,
  moveGroup,
  newGroup,
  nextGroupColor,
  openSaved,
  recolor,
  removeFromGroup,
  renameGroup,
  toggleCollapsed,
  ungroup,
  type SavedGroup,
} from './groups.js'
import {
  activeTab,
  createLayout,
  groupOf,
  openPath,
  panes,
  split,
  type Layout,
  type Pane,
} from './panes.js'

function ids(prefix = 'i'): () => string {
  let n = 0
  return () => `${prefix}${n++}`
}

const paneAt = (l: Layout, i = 0): Pane => panes(l.tree)[i]
const pathsOf = (p: Pane): (string | null)[] => p.tabs.map((t) => t.path)
const tabIdFor = (p: Pane, path: string): string => p.tabs.find((t) => t.path === path)!.id

/** One pane with the given notes open, the last one active. */
function strip(...list: string[]): { l: Layout; gen: () => string } {
  const gen = ids()
  let l = createLayout(gen)
  for (const p of list) l = openPath(l, p, {}, gen)
  return { l, gen }
}

/** Group these paths in pane 0 and answer the group's id. */
function group(l: Layout, gen: () => string, name: string, list: string[]): { l: Layout; id: string } {
  const p = paneAt(l)
  let next = newGroup(l, p.id, tabIdFor(p, list[0]), gen, name, 1)
  const gid = groupOf(paneAt(next), tabIdFor(paneAt(next), list[0]))!.id
  for (const path of list.slice(1)) next = addToGroup(next, tabIdFor(paneAt(next), path), gid)
  return { l: next, id: gid }
}

describe('making and unmaking groups', () => {
  it('takes the first colour of the band the pane is not using', () => {
    const { l, gen } = strip('a.md', 'b.md', 'c.md')
    const first = group(l, gen, 'one', ['a.md'])
    expect(paneAt(first.l).groups[0].color).toBe(1)
    const second = group(first.l, gen, 'two', ['b.md'])
    expect(paneAt(second.l).groups.map((g) => g.color)).toEqual([1, 2])
    expect(nextGroupColor(paneAt(second.l))).toBe(3)
  })

  it('moves a joining tab next to the group, keeping the run contiguous', () => {
    const { l, gen } = strip('a.md', 'b.md', 'c.md', 'd.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'c.md'])
    // c.md moved up beside a.md rather than the group reaching across b.md.
    expect(pathsOf(paneAt(grouped))).toEqual([null, 'a.md', 'c.md', 'b.md', 'd.md'])
    const withD = addToGroup(grouped, tabIdFor(paneAt(grouped), 'd.md'), id)
    expect(pathsOf(paneAt(withD))).toEqual([null, 'a.md', 'c.md', 'd.md', 'b.md'])
    expect(paneAt(withD).groups[0].tabIds).toHaveLength(3)
  })

  it('a tab can only be in one group at a time', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const one = group(l, gen, 'one', ['a.md', 'b.md'])
    const two = group(one.l, gen, 'two', ['b.md'])
    const p = paneAt(two.l)
    expect(p.groups.map((g) => g.tabIds.length)).toEqual([1, 1])
    expect(groupOf(p, tabIdFor(p, 'b.md'))?.name).toBe('two')
  })

  it('leaving a group keeps the tab where it is and closes the run up', () => {
    const { l, gen } = strip('a.md', 'b.md', 'c.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md', 'c.md'])
    const left = removeFromGroup(grouped, tabIdFor(paneAt(grouped), 'b.md'))
    const p = paneAt(left)
    expect(p.groups[0].tabIds).toEqual([tabIdFor(p, 'a.md'), tabIdFor(p, 'c.md')])
    expect(pathsOf(p)).toEqual([null, 'a.md', 'c.md', 'b.md'])
    // Ungrouping drops the label and leaves every tab in place.
    const flat = ungroup(grouped, id)
    expect(paneAt(flat).groups).toEqual([])
    expect(pathsOf(paneAt(flat))).toEqual(pathsOf(paneAt(grouped)))
  })

  it('renames and recolours', () => {
    const { l, gen } = strip('a.md')
    const { l: grouped, id } = group(l, gen, 'draft', ['a.md'])
    expect(paneAt(renameGroup(grouped, id, 'Edible distribution')).groups[0].name).toBe(
      'Edible distribution'
    )
    expect(paneAt(recolor(grouped, id, 7)).groups[0].color).toBe(7)
  })
})

describe('folding', () => {
  it('moves the active tab out of the group it is folding', () => {
    const { l, gen } = strip('a.md', 'b.md', 'loose.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const p0 = paneAt(grouped)
    const active = tabIdFor(p0, 'a.md')
    // Drop the pane's own empty tab so the nearest tab outside the group is
    // the one the fold has to jump to.
    const withActive = { ...grouped, tree: { ...p0, tabs: p0.tabs.filter((t) => t.path !== null), active } }
    const folded = toggleCollapsed(withActive, id, gen, 5)
    const p = paneAt(folded)
    expect(p.groups[0].collapsed).toBe(true)
    expect(p.groups[0].tabIds).toContain(active)
    // The active tab is now one you can actually see.
    expect(p.groups[0].tabIds).not.toContain(p.active)
    expect(activeTab(p)?.path).toBe('loose.md')
    expect(toggleCollapsed(folded, id, gen).tree).toMatchObject({ groups: [{ collapsed: false }] })
  })

  it('opens an empty tab when the folded group is the whole strip', () => {
    const gen = ids()
    let l = createLayout(gen)
    for (const p of ['a.md', 'b.md']) l = openPath(l, p, {}, gen)
    // Close the pane's own empty tab so the group is everything.
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const only = paneAt(grouped)
    const noEmpty = {
      ...grouped,
      tree: { ...only, tabs: only.tabs.filter((t) => t.path !== null), active: tabIdFor(only, 'a.md') },
    }
    const folded = toggleCollapsed(noEmpty, id, gen)
    const p = paneAt(folded)
    expect(pathsOf(p)).toEqual(['a.md', 'b.md', null])
    expect(activeTab(p)?.path).toBeNull()
    expect(p.groups[0].collapsed).toBe(true)
  })
})

describe('closing and reopening a group', () => {
  const cursor = { anchor: 12, head: 12 }

  function withResumePoints(l: Layout, list: string[]): Layout {
    const p = paneAt(l)
    return {
      ...l,
      tree: {
        ...p,
        tabs: p.tabs.map((t) =>
          t.path && list.includes(t.path) ? { ...t, cursor, scroll: 240 } : t
        ),
      },
    }
  }

  it('hands the group back with its tabs cursors and scroll (R2.2)', () => {
    const { l, gen } = strip('a.md', 'b.md', 'keep.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const { layout, saved } = closeGroup(withResumePoints(grouped, ['a.md', 'b.md']), id, gen, 99)
    expect(saved).toEqual({
      id,
      name: 'cluster',
      color: 1,
      lastActive: 99,
      tabs: [
        { path: 'a.md', cursor, scroll: 240 },
        { path: 'b.md', cursor, scroll: 240 },
      ],
    })
    expect(pathsOf(paneAt(layout))).toEqual([null, 'keep.md'])
    expect(paneAt(layout).groups).toEqual([])
  })

  it('closes the pane the group emptied, unless it is the only one', () => {
    const gen = ids()
    let l = createLayout(gen)
    for (const p of ['a.md', 'b.md']) l = openPath(l, p, {}, gen)
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const only = paneAt(grouped)
    const whole = {
      ...grouped,
      tree: { ...only, tabs: only.tabs.filter((t) => t.path !== null) },
    }
    // One pane: it survives with an empty tab.
    const alone = closeGroup(whole, id, gen)
    expect(panes(alone.layout.tree)).toHaveLength(1)
    expect(pathsOf(paneAt(alone.layout))).toEqual([null])
    // Two panes: the emptied one goes.
    const twoPanes = split(whole, paneAt(whole).id, 'row', gen)
    const closed = closeGroup(twoPanes, id, gen)
    expect(panes(closed.layout.tree)).toHaveLength(1)
    expect(closed.saved?.tabs).toHaveLength(2)
  })

  it('answers null for a group that is not there, and changes nothing', () => {
    const { l } = strip('a.md')
    const { layout, saved } = closeGroup(l, 'ghost')
    expect(saved).toBeNull()
    expect(pathsOf(paneAt(layout))).toEqual([null, 'a.md'])
  })

  it('reopens after the active tab, at the old cursors, deduping the pane', () => {
    const { l, gen } = strip('a.md', 'keep.md')
    const saved: SavedGroup = {
      id: 'sg1',
      name: 'cluster',
      color: 4,
      lastActive: 1,
      tabs: [
        { path: 'a.md', cursor, scroll: 240 },
        { path: 'c.md', cursor: null, scroll: 0 },
      ],
    }
    const opened = openSaved(l, paneAt(l).id, saved, gen, 5)
    const p = paneAt(opened)
    // 'a.md' was already open: the group takes it over rather than doubling it.
    expect(pathsOf(p)).toEqual([null, 'keep.md', 'a.md', 'c.md'])
    expect(p.tabs.filter((t) => t.path === 'a.md')).toHaveLength(1)
    expect(p.tabs.find((t) => t.path === 'a.md')?.cursor).toEqual(cursor)
    expect(p.tabs.find((t) => t.path === 'a.md')?.scroll).toBe(240)
    expect(p.groups[0]).toMatchObject({ name: 'cluster', color: 4, collapsed: false, lastActive: 5 })
    expect(p.groups[0].tabIds).toHaveLength(2)
    expect(activeTab(p)?.path).toBe('a.md')
    expect(opened.focus).toBe(p.id)
  })

  it('survives a round trip: close it, open it in the other pane', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const two = split(grouped, paneAt(grouped).id, 'row', gen)
    const { layout, saved } = closeGroup(two, id, gen, 3)
    const back = openSaved(layout, panes(layout.tree)[1].id, saved!, gen, 4)
    const target = panes(back.tree)[1]
    expect(target.groups[0].name).toBe('cluster')
    expect(target.tabs.filter((t) => t.path !== null).map((t) => t.path)).toEqual(['a.md', 'b.md'])
  })

  it('delete is the destructive one: the tabs go with it', () => {
    const { l, gen } = strip('a.md', 'b.md', 'keep.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const gone = deleteGroup(grouped, id, gen)
    expect(pathsOf(paneAt(gone))).toEqual([null, 'keep.md'])
    expect(paneAt(gone).groups).toEqual([])
  })
})

describe('groups as portable text (R6)', () => {
  it('writes basenames, and an alias where the basename is ambiguous', () => {
    expect(linksOf(['Edible/Pricing.md', 'Daily/29-8-2026.md'])).toBe(
      '- [[Pricing]]\n- [[29-8-2026]]'
    )
    // Two 'WIP' notes in the list: both get the disambiguating path.
    expect(linksOf(['a/WIP.md', 'b/WIP.md'])).toBe('- [[a/WIP|WIP]]\n- [[b/WIP|WIP]]')
    // The index knows about a clash this list cannot see.
    expect(linksOf(['a/WIP.md'], (n) => n === 'WIP')).toBe('- [[a/WIP|WIP]]')
    expect(linksOf([])).toBe('')
  })

  it('opens a note’s links as a group in the focused pane', () => {
    const { l, gen } = strip('note.md')
    const opened = groupFromLinks(l, paneAt(l).id, 'note', ['a.md', 'b.md'], gen, 8)
    const p = paneAt(opened)
    expect(pathsOf(p)).toEqual([null, 'note.md', 'a.md', 'b.md'])
    expect(p.groups[0]).toMatchObject({ name: 'note', color: 1, lastActive: 8 })
    expect(p.groups[0].tabIds).toHaveLength(2)
  })
})

describe('a chip drag carries the whole group (Decision 4)', () => {
  it('lands the run in another pane with its name and colour intact', () => {
    const { l, gen } = strip('a.md', 'b.md', 'c.md')
    const { l: grouped, id } = group(l, gen, 'edible', ['a.md', 'b.md'])
    const two = split(grouped, paneAt(grouped).id, 'row', gen)
    const target = paneAt(two, 1)
    const moved = moveGroup(two, id, target.id, 0, gen, 9)
    const to = paneAt(moved, 1)
    expect(to.groups).toHaveLength(1)
    expect(to.groups[0]).toMatchObject({ name: 'edible', color: 1, lastActive: 9 })
    expect(to.tabs.filter((t) => to.groups[0].tabIds.includes(t.id)).map((t) => t.path)).toEqual([
      'a.md',
      'b.md',
    ])
    // The source keeps what was not carried, and no longer has the label.
    expect(paneAt(moved).groups).toEqual([])
    expect(pathsOf(paneAt(moved))).toEqual([null, 'c.md'])
  })

  it('re-takes a path already open in the target rather than duplicating it (R3)', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const two = split(grouped, paneAt(grouped).id, 'row', gen)
    // The split duplicated the active note into the new pane.
    const target = paneAt(two, 1)
    expect(pathsOf(target)).toEqual(['b.md'])
    const moved = moveGroup(two, id, target.id, undefined, gen, 9)
    const to = paneAt(moved, 1)
    expect(pathsOf(to)).toEqual(['a.md', 'b.md'])
    expect(to.groups[0].tabIds).toHaveLength(2)
  })

  it('inside its own strip it is a reorder of the run', () => {
    const { l, gen } = strip('a.md', 'b.md', 'c.md', 'd.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['b.md', 'c.md'])
    expect(pathsOf(paneAt(grouped))).toEqual([null, 'a.md', 'b.md', 'c.md', 'd.md'])
    const moved = moveGroup(grouped, id, paneAt(grouped).id, 5, gen, 9)
    expect(pathsOf(paneAt(moved))).toEqual([null, 'a.md', 'd.md', 'b.md', 'c.md'])
    expect(paneAt(moved).groups[0].tabIds).toHaveLength(2)
  })

  it('stays folded across the move, and never leaves the target with nothing on screen', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md', 'b.md'])
    const folded = toggleCollapsed(grouped, id, gen)
    const two = split(folded, paneAt(folded).id, 'row', gen)
    const other = paneAt(two, 1)
    const moved = moveGroup(two, id, other.id, 0, gen, 9)
    const to = paneAt(moved, 1)
    expect(to.groups[0].collapsed).toBe(true)
    // A folded tab has no view, so the active tab has to be one of the others.
    expect(to.groups[0].tabIds).not.toContain(to.active)
  })
})

describe('the group lists the menus render', () => {
  it('reads a group’s notes in strip order', () => {
    const { l, gen } = strip('a.md', 'b.md', 'c.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['c.md', 'a.md'])
    expect(groupPaths(grouped, id)).toEqual(['c.md', 'a.md'])
    expect(groupPaths(grouped, 'nope')).toEqual([])
  })

  it('puts this pane’s groups first, then other panes’, then the list (Decision 8)', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const { l: here, id: hereId } = group(l, gen, 'here', ['a.md'])
    const two = split(here, paneAt(here).id, 'row', gen)
    const other = paneAt(two, 1)
    const away = newGroup(two, other.id, other.tabs[0].id, gen, 'away', 100)
    const saved: SavedGroup[] = [
      { id: 's1', name: 'old', color: 3, lastActive: 1, tabs: [{ path: 'x.md', cursor: null, scroll: 0 }] },
      { id: 's2', name: 'newer', color: 4, lastActive: 50, tabs: [{ path: 'y.md', cursor: null, scroll: 0 }] },
    ]
    const rows = groupRows(away, paneAt(away).id, saved)
    expect(rows.map((r) => r.name)).toEqual(['here', 'away', 'newer', 'old'])
    expect(rows.map((r) => r.open)).toEqual([true, true, false, false])
    expect(rows[0]).toMatchObject({ id: `open:${hereId}`, here: true, count: 1 })
    expect(rows[1].here).toBe(false)
    expect(rows[2]).toMatchObject({ id: 'saved:s2', savedId: 's2', count: 1, paneId: null })
  })
})

describe('purity', () => {
  it('never mutates the layout it was given', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const { l: grouped, id } = group(l, gen, 'cluster', ['a.md'])
    const before = JSON.stringify(grouped)
    addToGroup(grouped, tabIdFor(paneAt(grouped), 'b.md'), id)
    toggleCollapsed(grouped, id, gen)
    closeGroup(grouped, id, gen)
    deleteGroup(grouped, id, gen)
    openSaved(grouped, paneAt(grouped).id, { id: 's', name: 'x', color: 1, lastActive: 0, tabs: [{ path: 'z.md', cursor: null, scroll: 0 }] }, gen)
    expect(JSON.stringify(grouped)).toBe(before)
  })
})
