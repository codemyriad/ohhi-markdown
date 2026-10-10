// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Navigation } from '../../navigation.svelte.js'
import { strip } from '../../panes.fixture.js'
import { slotFor, type PresenceByPath } from '../../presence.js'
import { fakeViewShell } from '../../readouts.fixture.js'
import { viewShellContext } from '../../views.js'
import type { PaneShell } from '../../workspace-panes.svelte.js'
import type { Workspace } from '../../workspace.svelte.js'
import Sync from './Sync.svelte'

const LL = getLL()
const t = LL.web.presence

afterEach(() => cleanup())

const GREEN = { connected: true, synced: true, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
const peer = (name: string, clientId: number) => ({ name, color: slotFor(name), clientId })

function setup(opts: { byRoom?: Record<string, string[]>; presence?: PresenceByPath; open?: string | null; pane?: boolean; paneFocused?: boolean; devtools?: boolean } = {}) {
  const shell = fakeViewShell()
  const open = opts.open === undefined ? 'CS/Raft.md' : opts.open
  const ctx = {
    workspace: {
      room: 'root',
      user: { name: 'Me' },
      ui: {
        files: [{ path: 'CS/Raft.md', guid: 'g1', kind: 'text' }],
        records: { g1: GREEN },
        mounts: [{ path: 'CS', room: 'cs', provenance: 'shared' }],
        linked: false,
        presenceByRoom: opts.byRoom ?? {},
        presenceByPath: opts.presence ?? {},
      },
      docForPath: () => null,
      awarenessForPath: () => null,
    } as unknown as Workspace,
    panes: { layout: (open ? strip(open) : strip()).l, focusPane: vi.fn() } as unknown as PaneShell,
    nav: { pending: { reveal: null } } as unknown as Navigation,
    merged: false,
    ...(opts.pane ? { pane: { id: 'p', focused: opts.paneFocused ?? true, lead: false } } : {}),
    ...(opts.devtools !== undefined ? { devtools: () => opts.devtools! } : {}),
  }
  render(Sync, { props: { ctx }, context: viewShellContext(shell) })
  return { shell, panes: ctx.panes, user: userEvent.setup() }
}

describe('the sync readout (foundations-plan P5)', () => {
  it('alone and synced: just the icon — the state on the button, the paint on the glyph', () => {
    setup()
    const button = screen.getByTestId('toolbar-sync-pill-note')
    expect(button.dataset.status).toBe('green')
    expect(button.classList).toContain('ed-sync-host')
    // The glyph is the direct child the unlayered `[data-status] > .ed-sync-icon` rules paint.
    expect(button.querySelector(':scope > svg.ed-sync-icon')).not.toBeNull()
    expect(button.getAttribute('aria-label')).toBe(LL.web.shared.door.aria({ status: LL.web.pill.vault.green() }))
    expect(screen.queryByTestId('sync-people')).toBeNull()
  })

  it('no note open: the vault rollup, under the vault pill\'s testid', () => {
    setup({ open: null })
    expect(screen.queryByTestId('toolbar-sync-pill-note')).toBeNull()
    expect(screen.getByTestId('toolbar-vault-pill').dataset.status).toBe('green')
  })

  it('people online: their initials beside it, the count in its name; hover lists who is where; click opens Shared', async () => {
    const { shell, user } = setup({
      byRoom: { cs: ['Cynthia', 'Me', 'Sam'] },
      presence: { 'CS/Raft.md': [peer('Cynthia', 1)] },
    })
    const button = screen.getByTestId('toolbar-sync-pill-note')
    expect(button.getAttribute('aria-label')).toBe(
      LL.web.shared.door.aria({ status: t.sync.with_people({ status: LL.web.pill.vault.green(), count: 2 }) })
    )
    expect(within(screen.getByTestId('sync-people')).getAllByTestId('sync-people-peer').map((el) => el.dataset.peer)).toEqual([
      'Cynthia',
      'Sam',
    ])

    await user.hover(button)
    const card = await screen.findByTestId('sync-people-card')
    // Hovering never takes the caret: focus stays where it was.
    expect(card.contains(document.activeElement)).toBe(false)
    const rows = within(card).getAllByTestId('people-row')
    expect(rows.map((r) => r.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      `C Cynthia ${t.people.in_note({ note: 'Raft' })}`,
      `S Sam ${t.people.online()}`,
    ])
    await user.click(rows[0]!)
    expect(shell.openPath).toHaveBeenCalledWith('CS/Raft.md')

    await user.click(button)
    expect(shell.openView).toHaveBeenCalledWith('shared')
  })

  it('focus opens the list too (keyboard)', async () => {
    const { user } = setup({ byRoom: { cs: ['Cynthia', 'Me'] } })
    await user.tab()
    expect(document.activeElement).toBe(screen.getByTestId('toolbar-sync-pill-note'))
    expect(await screen.findByTestId('sync-people-card')).toBeTruthy()
  })

  it('in a status bar: compact — a count, not avatars', () => {
    setup({ byRoom: { cs: ['Cynthia', 'Me', 'Sam'] }, pane: true })
    expect(screen.queryByTestId('sync-people')).toBeNull()
    expect(screen.getByTestId('sync-people-count')).toHaveTextContent('2')
  })

  describe('the inspector door (devtools-shaping DT5)', () => {
    it('developer tools on, alone: hover opens the card with "Inspect this note", which opens the note in its own inspector tab', async () => {
      const { shell, user } = setup({ devtools: true })
      const button = screen.getByTestId('toolbar-sync-pill-note')
      expect(button.getAttribute('aria-haspopup')).toBe('dialog')
      await user.hover(button)
      const card = await screen.findByTestId('sync-people-card')
      expect(within(card).queryByTestId('presence')).toBeNull()
      const door = within(card).getByRole('button', { name: t.sync.inspect() })
      expect(door.dataset.testid).toBe('sync-inspect-note')
      await user.click(door)
      expect(shell.openView).toHaveBeenCalledWith('inspector', 'CS/Raft.md')
      expect(screen.queryByTestId('sync-people-card')).toBeNull()
    })

    it('in an unfocused pane\'s status bar: focuses that pane first, so the tab opens beside its note', async () => {
      const { shell, panes, user } = setup({ devtools: true, pane: true, paneFocused: false })
      await user.hover(screen.getByTestId('sync-pill-pane:p'))
      const card = await screen.findByTestId('sync-people-card')
      await user.click(within(card).getByTestId('sync-inspect-note'))
      expect(panes.focusPane).toHaveBeenCalledWith('p')
      expect(shell.openView).toHaveBeenCalledWith('inspector', 'CS/Raft.md')
      const focusOrder = (panes.focusPane as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
      expect(focusOrder).toBeLessThan((shell.openView as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
    })

    it('in the focused pane\'s status bar: no extra focus move', async () => {
      const { shell, panes, user } = setup({ devtools: true, pane: true })
      await user.hover(screen.getByTestId('sync-pill-note'))
      await user.click(within(await screen.findByTestId('sync-people-card')).getByTestId('sync-inspect-note'))
      expect(panes.focusPane).not.toHaveBeenCalled()
      expect(shell.openView).toHaveBeenCalledWith('inspector', 'CS/Raft.md')
    })

    it('developer tools on, with people: the door sits below the list', async () => {
      const { user } = setup({ devtools: true, byRoom: { cs: ['Cynthia', 'Me'] } })
      await user.hover(screen.getByTestId('toolbar-sync-pill-note'))
      const card = await screen.findByTestId('sync-people-card')
      expect(within(card).getAllByTestId('people-row')).toHaveLength(1)
      expect(within(card).getByTestId('sync-inspect-note')).toBeTruthy()
    })

    it('developer tools on, no note and nobody here: nothing opens', async () => {
      const { user } = setup({ devtools: true, open: null })
      const button = screen.getByTestId('toolbar-vault-pill')
      expect(button.getAttribute('aria-haspopup')).toBeNull()
      await user.hover(button)
      expect(screen.queryByTestId('sync-people-card')).toBeNull()
    })

    it('developer tools off: no door, and alone no card at all', async () => {
      const { user } = setup({ devtools: false })
      await user.hover(screen.getByTestId('toolbar-sync-pill-note'))
      expect(screen.queryByTestId('sync-people-card')).toBeNull()
      expect(screen.queryByTestId('sync-inspect-note')).toBeNull()
    })

    it('developer tools off, with people: the list without the door', async () => {
      const { user } = setup({ devtools: false, byRoom: { cs: ['Cynthia', 'Me'] } })
      await user.hover(screen.getByTestId('toolbar-sync-pill-note'))
      const card = await screen.findByTestId('sync-people-card')
      expect(within(card).queryByTestId('sync-inspect-note')).toBeNull()
    })
  })
})
