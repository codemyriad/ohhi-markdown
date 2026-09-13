// @vitest-environment jsdom
/**
 * The strip's ARIA and its drag contract (tab-groups B9/B10, R8).
 *
 * Two things are only true in the DOM and so are only testable here: the
 * several tablists a strip holds (a `tablist` may own nothing but tabs, so a
 * chip is their sibling — W2 decision 1), and the `data-slot-*` attributes the
 * drag hit test measures. `slotsFrom` is driven over the real markup, because
 * the contract is between these two files and nothing else checks it.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getLL } from '@editor/i18n'
import { SimClock } from '@editor/testkit'
import { slotsFrom } from '../pane-drag.js'
import { panes as panesOf, type Pane } from '../panes.js'
import { ids as idGen } from '../panes.fixture.js'
import { fakeWorkspace, withPanes, type PanesHarness } from '../panes-shell.fixture.svelte.js'
import { dropStorage, useMemStorage } from '../storage.fixture.js'
import type { PaneShell } from '../workspace-panes.svelte.js'
import TabStrip from './TabStrip.svelte'

const t = getLL().web.tabs
const FILES = ['a.md', 'b.md', 'c.md', 'd.md']

let harness: PanesHarness
let panes: PaneShell

beforeEach(() => {
  useMemStorage()
  harness = withPanes(new SimClock(), idGen())
  panes = harness.panes
  const ws = fakeWorkspace(FILES)
  panes.attach(ws.asWorkspace(), 'room-a')
  harness.flush()
})

afterEach(() => {
  cleanup()
  harness.stop()
  dropStorage()
})

const pane = (): Pane => panesOf(panes.layout.tree)[0]

/** `a  [Edible: b c]  d` — one group in the middle, loose tabs either side. */
function stripWithGroup(): string {
  for (const path of FILES) panes.open(path)
  harness.flush()
  const p = pane()
  const id = panes.newGroup(p.tabs.find((x) => x.path === 'b.md')!.id, p.id)!
  panes.addToGroup(pane().tabs.find((x) => x.path === 'c.md')!.id, id)
  panes.renameGroup(id, 'Edible')
  harness.flush()
  return id
}

function show(): void {
  render(TabStrip, { pane: pane(), focused: true, panes, uid: 'u' })
}

describe('TabStrip', () => {
  it('gives each run its own tablist, named by its group or by where it is', () => {
    stripWithGroup()
    show()
    const lists = screen.getAllByRole('tablist')
    expect(lists.map((el) => el.getAttribute('aria-label'))).toEqual([
      t.list_n({ index: 1, total: 2 }),
      'Edible',
      t.list_n({ index: 2, total: 2 }),
    ])
    // The chip is a SIBLING of its group's tablist, never a child of one:
    // axe fails `aria-required-children` on a button inside a tablist.
    expect(lists[1].querySelector('[data-slot-kind="chip"]')).toBeNull()
  })

  it('falls back to one unnumbered list when there is only one run', () => {
    panes.open('a.md')
    harness.flush()
    show()
    expect(screen.getByRole('tablist')).toHaveAttribute('aria-label', t.list())
  })

  it('points aria-controls at the panel only from the tab that has one', () => {
    stripWithGroup()
    show()
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected).toHaveAttribute('aria-controls', 'u-panel-' + pane().active)
    // A pane renders ONE panel, for its active tab (R2.1) — a background tab's
    // `aria-controls` would name an element that is not in the document.
    for (const tab of screen.getAllByRole('tab')) {
      if (tab === selected) continue
      expect(tab).not.toHaveAttribute('aria-controls')
    }
  })

  it('keeps one roving tab stop across every run', () => {
    stripWithGroup()
    show()
    const stops = screen.getAllByRole('tab').filter((el) => el.getAttribute('tabindex') === '0')
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveAttribute('aria-selected', 'true')
  })

  it('marks up the slots the drag hit test measures, folded flag and all', () => {
    const id = stripWithGroup()
    show()
    const measure = (el: HTMLElement): { left: number; right: number } => {
      const i = Number(el.dataset.slotIndex)
      return { left: i * 100, right: i * 100 + 100 }
    }
    const open = slotsFrom(
      document.querySelectorAll<HTMLElement>('[data-slot-index]'),
      measure
    )
    expect(open.map((s) => s.kind)).toEqual(['tab', 'chip', 'tab', 'tab', 'tab'])
    expect(open[1]).toMatchObject({ kind: 'chip', index: 1, endIndex: 3, groupId: id, folded: false })
    expect(open.filter((s) => s.kind === 'tab').map((s) => s.index)).toEqual([0, 1, 2, 3])
    // A tab says which group it is in, which is what lets the hit test find
    // the END of a run and treat its trailing half as the group's tail (P1.1).
    expect(open.filter((s) => s.kind === 'tab').map((s) => s.groupId)).toEqual([null, id, id, null])

    cleanup()
    panes.toggleGroup(id)
    harness.flush()
    show()
    const folded = slotsFrom(document.querySelectorAll<HTMLElement>('[data-slot-index]'), measure)
    // The group's own tabs are gone from the strip; the chip says it is folded,
    // which is what makes "drop anywhere on it" mean "append to that group".
    expect(folded.map((s) => s.kind)).toEqual(['tab', 'chip', 'tab'])
    expect(folded[1]).toMatchObject({ folded: true, index: 1, endIndex: 3 })
  })

  it('gives focus back to the tab a context menu acted on, not to the body', async () => {
    const user = userEvent.setup()
    stripWithGroup()
    show()
    const tab = screen.getAllByRole('tab')[0]
    await user.pointer({ target: tab, keys: '[MouseRight]' })
    expect(await screen.findByRole('menu')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    // The menu's trigger is a zero-size anchor that unmounts with it, so Melt's
    // focus return lands on <body> and the keyboard points at nothing.
    expect(document.activeElement).toBe(tab)
  })
})
