// @vitest-environment jsdom
/**
 * The chip (tab-groups B9): a real button that says whether its run is open,
 * how many tabs a fold is hiding, and how to manage it — the three things a
 * screen reader has to hear, since the colour says none of them.
 */
import { cleanup, render, screen } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@editor/i18n'
import { SimClock } from '@editor/testkit'
import { findGroup, panes as panesOf, type Group, type Pane } from '../panes.js'
import { ids as idGen } from '../panes.fixture.js'
import { fakeWorkspace, withPanes, type PanesHarness } from '../panes-shell.fixture.svelte.js'
import { dropStorage, useMemStorage } from '../storage.fixture.js'
import type { PaneShell } from '../workspace-panes.svelte.js'
import GroupChip from './GroupChip.svelte'

const t = getLL().web.groups

let harness: PanesHarness
let panes: PaneShell
let groupId: string

beforeEach(() => {
  useMemStorage()
  harness = withPanes(new SimClock(), idGen())
  panes = harness.panes
  panes.attach(fakeWorkspace(['a.md', 'b.md', 'c.md']).asWorkspace(), 'room-a')
  harness.flush()
  for (const path of ['a.md', 'b.md', 'c.md']) panes.open(path)
  harness.flush()
  const p = pane()
  groupId = panes.newGroup(p.tabs.find((x) => x.path === 'a.md')!.id, p.id)!
  panes.addToGroup(pane().tabs.find((x) => x.path === 'b.md')!.id, groupId)
  panes.renameGroup(groupId, 'Edible')
  harness.flush()
})

afterEach(() => {
  cleanup()
  harness.stop()
  dropStorage()
})

const pane = (): Pane => panesOf(panes.layout.tree)[0]
const group = (): Group => findGroup(panes.layout, groupId)!.group

function show(onManage = vi.fn()) {
  render(GroupChip, { group: group(), pane: pane(), panes, onManage })
  return { onManage }
}

describe('GroupChip', () => {
  it('is a button that says whether its run is showing', async () => {
    const user = userEvent.setup()
    show()
    const chip = screen.getByRole('button', { name: /Edible/ })
    expect(chip).toHaveAttribute('aria-expanded', 'true')

    await user.click(chip)
    expect(group().collapsed).toBe(true)
  })

  it('spells out the count a fold is hiding, because "2" on its own says nothing', () => {
    panes.toggleGroup(groupId)
    harness.flush()
    show()
    expect(screen.getByRole('button', { name: /Edible/ })).toHaveAccessibleName(
      expect.stringContaining(t.chip.tabs({ count: 2 }))
    )
    expect(screen.getByRole('button', { name: /Edible/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('names an unnamed group rather than drawing an empty chip', () => {
    panes.renameGroup(groupId, '')
    harness.flush()
    show()
    expect(screen.getByRole('button', { name: new RegExp(t.untitled()) })).toBeInTheDocument()
  })

  it('opens the manage popover from the keyboard as well as the pointer (R8)', async () => {
    const user = userEvent.setup()
    const { onManage } = show()
    const chip = screen.getByRole('button', { name: /Edible/ })
    chip.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(onManage).toHaveBeenCalledWith(groupId)

    await user.pointer({ target: chip, keys: '[MouseRight]' })
    expect(onManage).toHaveBeenCalledTimes(2)
  })
})
