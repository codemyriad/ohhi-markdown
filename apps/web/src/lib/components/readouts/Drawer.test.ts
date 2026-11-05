// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import type { AppEvent, EventLevel } from '@ohhi/workspace'
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearedNotices } from '../../notices.js'
import { event, fakeViewShell, notice } from '../../readouts.fixture.js'
import { box, withActions, type ActionsHarness } from '../../shell-actions.fixture.svelte.js'
import { createShellLayout, type ShellLayout } from '../../shell-layout.svelte.js'
import { dropStorage, useMemStorage } from '../../storage.fixture.js'
import { viewShellContext } from '../../views.js'
import type { Workspace } from '../../workspace.svelte.js'
import Drawer from './Drawer.svelte'

const t = getLL().web.drawer
const CHANGE = { guid: 'g', added: 1, removed: 0 }
const NOW = 100_000

const ev = (id: string, at: number, level: EventLevel): AppEvent => notice(id, at, level, { path: `${id}.md` })

let harness: ActionsHarness<ShellLayout>
let now: number

beforeEach(() => {
  useMemStorage()
  clearedNotices.set({})
  now = NOW
})
afterEach(() => {
  cleanup()
  harness?.stop()
  dropStorage()
})

function setup(list: AppEvent[]) {
  const events = box<AppEvent[]>(list)
  harness = withActions(() =>
    createShellLayout({
      inWorkspace: () => true,
      events: () => events.value,
      flashes: () => [],
      now: () => now,
      toast: () => {},
      session: null,
    })
  )
  // The shell's clock, not a prop: the drawer ages its rows on the injected one.
  const shell = fakeViewShell()
  shell.clock = { now: () => now, schedule: () => () => {} }
  const ctx = {
    workspace: { room: 'vault-r', ui: { events: list } } as unknown as Workspace,
    layout: harness.actions,
  }
  render(Drawer, { props: { ctx }, context: viewShellContext(shell) })
  return { layout: harness.actions, shell, user: userEvent.setup() }
}

describe('the drawer readout', () => {
  it('badges unread errors and warnings; opening it lists them and clears the badge', async () => {
    const { layout, user } = setup([ev('w', NOW - 1_000, 'warn'), ev('i', NOW - 2_000, 'info'), ev('e', NOW - 3_000, 'error')])
    flushSync()
    expect(layout.unread).toBe(2)
    expect(screen.getByTestId('drawer-badge')).toHaveTextContent('2')
    const bell = screen.getByRole('button', { name: t.label_unread({ count: 2 }) })

    await user.click(bell)
    const drawer = await screen.findByRole('dialog', { name: t.title() })
    // Info never shows here: the drawer is errors and warnings.
    expect(within(drawer).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual(['event:w', 'event:e'])
    expect(layout.unread).toBe(0)
    expect(screen.queryByTestId('drawer-badge')).toBeNull()
  })

  it('Open the Log closes the drawer and opens the Log filtered to it; a path opens its note', async () => {
    const { layout, shell, user } = setup([ev('w', NOW - 1_000, 'warn')])
    await user.click(screen.getByTestId('drawer-bell'))
    expect(screen.getByTestId('drawer-summary')).toHaveTextContent(t.summary.warnings({ count: 1 }))
    // No *Open Shared* any more (P6): one footer link.
    expect(screen.queryByTestId('drawer-open-shared')).toBeNull()
    await user.click(await screen.findByRole('button', { name: t.open_log() }))
    expect(shell.openView).toHaveBeenCalledExactlyOnceWith('log', 'problems')
    expect(layout.drawerOpen).toBe(false)

    await user.click(screen.getByTestId('drawer-bell'))
    // Aged on the shell's injected clock (a second ago → "now"), not the real one.
    expect(screen.getByTestId('event:w')).toHaveTextContent(getLL().web.relative_time.now())
    await user.click(await screen.findByTestId('event-path'))
    // App's `openPath` (replace-in-place, recents, the navigator drawer's
    // close) — never `panes.open` straight (duplication review #1).
    expect(shell.openPath).toHaveBeenCalledWith('w.md')
    expect(layout.drawerOpen).toBe(false)
  })

  it('groups changes others made per note, with their names; errors and warnings first; never your own', async () => {
    const change = (id: string, at: number, path: string, name: string | null, count = 1): AppEvent => ({
      ...event({
        id,
        kind: 'doc.changed',
        at,
        scope: { room: 'cs', path },
        actor: name ? { kind: 'peer', name } : { kind: 'me' },
        payload: CHANGE,
      }),
      count,
    })
    const { shell, user } = setup([
      change('mine', NOW - 500, 'CS/Raft, in one page.md', null),
      change('c1', NOW - 1_000, 'CS/Raft, in one page.md', 'Cynthia', 2),
      ev('w', NOW - 1_500, 'warn'),
      change('s1', NOW - 2_000, 'CS/Raft, in one page.md', 'Sam'),
      change('c2', NOW - 3_000, 'CS/Paxos.md', 'Cynthia'),
    ])
    await user.click(screen.getByTestId('drawer-bell'))
    const drawer = await screen.findByRole('dialog', { name: t.title() })
    expect(within(drawer).getByTestId('drawer-summary')).toHaveTextContent(
      `${t.summary.warnings({ count: 1 })} · ${t.summary.changes({ count: 4 })}`
    )
    expect(within(drawer).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual([
      'event:w',
      'drawer-change:CS/Raft, in one page.md',
      'drawer-change:CS/Paxos.md',
    ])
    const raft = within(drawer).getByTestId('drawer-change:CS/Raft, in one page.md')
    expect(raft).toHaveTextContent(`${t.group.two({ a: 'Cynthia', b: 'Sam' })} · Raft, in one page · ${t.group.count({ count: 3 })}`)
    expect(within(drawer).getByTestId('drawer-change:CS/Paxos.md')).toHaveTextContent(`Cynthia · Paxos · ${t.group.count({ count: 1 })}`)
    // The whole Log: the drawer holds both kinds.
    await user.click(within(drawer).getByTestId('drawer-open-log'))
    expect(shell.openView).toHaveBeenCalledExactlyOnceWith('log')
    await user.click(screen.getByTestId('drawer-bell'))
    await user.click(within(screen.getByTestId('drawer-change:CS/Raft, in one page.md')).getByTestId('drawer-change-note'))
    expect(shell.openPath).toHaveBeenCalledWith('CS/Raft, in one page.md')
  })

  it('says so when there is nothing to report', async () => {
    const { user } = setup([ev('i', NOW - 1_000, 'info')])
    expect(screen.getByRole('button', { name: t.label() })).toBeInTheDocument()
    await user.click(screen.getByTestId('drawer-bell'))
    expect(await screen.findByTestId('drawer-empty')).toHaveTextContent(t.empty())
  })

  it('Clear all empties the drawer and the bell, and never the log', async () => {
    const list = [ev('w', NOW - 1_000, 'warn'), ev('e', NOW - 3_000, 'error')]
    const { layout, user } = setup(list)
    await user.click(screen.getByTestId('drawer-bell'))
    const drawer = await screen.findByRole('dialog', { name: t.title() })
    await user.click(within(drawer).getByRole('button', { name: t.clear_all() }))
    expect(await screen.findByTestId('drawer-empty')).toHaveTextContent(t.empty_cleared())
    // Focus stays in the drawer, on its one remaining control.
    expect(document.activeElement).toBe(screen.getByTestId('drawer-open-log'))
    // The log is history: both events are still in it.
    expect(list.map((e) => e.id)).toEqual(['w', 'e'])
    expect(layout.unread).toBe(0)
  })

  it('a row’s dismiss takes that row out, and focus moves to the next row’s dismiss', async () => {
    const peer = (id: string, at: number, path: string): AppEvent =>
      event({ id, kind: 'doc.changed', at, scope: { room: 'cs', path }, actor: { kind: 'peer', name: 'Sam' }, payload: CHANGE })
    const { user } = setup([ev('w', NOW - 1_000, 'warn'), ev('e', NOW - 2_000, 'error'), peer('c', NOW - 3_000, 'CS/Raft.md')])
    await user.click(screen.getByTestId('drawer-bell'))
    const drawer = await screen.findByRole('dialog', { name: t.title() })
    await user.click(within(within(drawer).getByTestId('event:w')).getByRole('button', { name: t.dismiss() }))
    expect(within(drawer).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual(['event:e', 'drawer-change:CS/Raft.md'])
    expect(document.activeElement).toBe(within(within(drawer).getByTestId('event:e')).getByRole('button', { name: t.dismiss() }))
    await user.click(within(drawer).getByRole('button', { name: t.dismiss_note({ note: 'Raft' }) }))
    expect(within(drawer).getAllByRole('listitem').map((li) => li.dataset.testid)).toEqual(['event:e'])
  })
})
