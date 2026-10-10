// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import { cleanup, render, screen, within } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '../panes.js'
import { fakeViewShell, notice as ev } from '../readouts.fixture.js'
import { viewShellContext } from '../views.js'
import type { Workspace } from '../workspace.svelte.js'
import LogView from './LogView.svelte'

afterEach(cleanup)

const t = getLL().web.log
const NOW = new Date(2026, 9, 3, 15, 0).getTime()
const H = 60 * 60 * 1000

const EVENTS = [
  ev('e1', NOW - 5 * 60_000, 'error', { path: 'team/plan.md', room: 'room-team' }, 2),
  ev('w1', NOW - 2 * H, 'warn', { path: 'diary.md' }),
  ev('i1', NOW - 3 * 24 * H, 'info'),
]

function setup(writeClipboard = vi.fn(async (_text: string) => {})) {
  const workspace = {
    ui: {
      events: EVENTS,
      mounts: [{ path: 'team', room: 'room-team' }],
      selectedPath: 'diary.md',
    },
    flash: vi.fn(),
    clearEvents: vi.fn(),
  }
  // The shell's clock and verbs, as App provides them: no clock prop.
  const shell = fakeViewShell(NOW)
  const tab: Tab = { id: 't', path: null, view: 'log' } as Tab
  render(LogView, {
    props: { workspace: workspace as unknown as Workspace, tab, writeClipboard },
    context: viewShellContext(shell),
  })
  const ids = (): string[] =>
    within(screen.queryByTestId('log-rows') ?? document.createElement('ol'))
      .queryAllByRole('listitem')
      .map((li) => li.dataset.testid!.replace('event:', ''))
  return { workspace, writeClipboard, shell, ids, user: userEvent.setup() }
}

describe('LogView', () => {
  it('lists every event newest first, with its relative time, scope and ×N', () => {
    const { ids } = setup()
    expect(ids()).toEqual(['e1', 'w1', 'i1'])
    const row = screen.getByTestId('event:e1')
    expect(row).toHaveTextContent('msg e1')
    expect(row).toHaveTextContent('5 min ago')
    expect(row).toHaveTextContent('team/plan.md')
    expect(within(row).getByTestId('event-count')).toHaveTextContent('×2')
  })

  it('a path chip opens its note through the shell', async () => {
    const { shell, user } = setup()
    await user.click(within(screen.getByTestId('event:w1')).getByTestId('event-path'))
    expect(shell.openPath).toHaveBeenCalledExactlyOnceWith('diary.md')
  })

  it('filters by level chips, scope and time', async () => {
    const { ids, user } = setup()
    const info = screen.getByRole('button', { name: t.levels.info() })
    expect(info).toHaveAttribute('aria-pressed', 'true')
    await user.click(info)
    expect(info).toHaveAttribute('aria-pressed', 'false')
    expect(ids()).toEqual(['e1', 'w1'])

    await user.selectOptions(screen.getByTestId('log-scope'), 'mount:room-team')
    expect(ids()).toEqual(['e1'])
    await user.selectOptions(screen.getByTestId('log-scope'), 'vault')
    expect(ids()).toEqual(['w1'])
    await user.selectOptions(screen.getByTestId('log-scope'), 'note')
    expect(ids()).toEqual(['w1'])
    await user.selectOptions(screen.getByTestId('log-scope'), 'all')

    await user.click(info)
    await user.click(screen.getByRole('button', { name: t.time.week() }))
    expect(screen.getByRole('button', { name: t.time.week() })).toHaveAttribute('aria-pressed', 'true')
    expect(ids()).toEqual(['e1', 'w1', 'i1'])
    await user.click(screen.getByRole('button', { name: t.time.today() }))
    expect(ids()).toEqual(['e1', 'w1'])

    await user.click(screen.getByRole('button', { name: t.levels.error() }))
    await user.click(screen.getByRole('button', { name: t.levels.warn() }))
    expect(screen.getByTestId('log-empty')).toHaveTextContent(t.empty_filtered())
  })

  it('copies the filtered rows as a plain-text report', async () => {
    const { writeClipboard, workspace, user } = setup()
    await user.click(screen.getByRole('button', { name: t.levels.info() }))
    await user.click(screen.getByRole('button', { name: t.copy() }))
    expect(writeClipboard).toHaveBeenCalledOnce()
    const text = writeClipboard.mock.calls[0]![0]
    expect(text.split('\n')).toEqual([
      t.report.header({ count: 2, time: new Date(NOW).toISOString() }),
      [new Date(NOW - 5 * 60_000).toISOString(), 'error', 'team/plan.md', 'msg e1', '×2'].join('  '),
      [new Date(NOW - 2 * H).toISOString(), 'warning', 'diary.md', 'msg w1'].join('  '),
    ])
    expect(workspace.flash).toHaveBeenCalledWith({ level: 'info', text: t.copied() })
  })

  it('shows the report to copy by hand when the clipboard is blocked', async () => {
    const { user } = setup(vi.fn(async () => Promise.reject(new Error('denied'))))
    await user.click(screen.getByRole('button', { name: t.copy() }))
    const box = screen.getByRole('textbox', { name: t.copy_fallback_label() })
    expect((box as HTMLTextAreaElement).value).toContain('msg i1')
  })

  it('clears the log only after a confirm', async () => {
    const { workspace, user } = setup()
    await user.click(screen.getByRole('button', { name: t.clear() }))
    const dialog = await screen.findByRole('alertdialog')
    expect(workspace.clearEvents).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: t.clear_confirm.confirm() }))
    expect(workspace.clearEvents).toHaveBeenCalledOnce()
  })

  it('the Customise chip keeps only the app’s own files’ notices, and a customise tab opens on it (ST6)', async () => {
    const user = userEvent.setup()
    const reloaded = { ...ev('r1', NOW - H, 'info'), payload: { code: 'resource_reloaded', params: { kind: 'layouts', name: 'focus', file: 'focus.json', root: 'vault' } } }
    const workspace = {
      ui: { events: [reloaded, ...EVENTS], mounts: [], selectedPath: null },
      flash: vi.fn(),
      clearEvents: vi.fn(),
    }
    const tab: Tab = { id: 't', path: null, view: 'log', viewArg: 'customise' } as Tab
    render(LogView, {
      props: { workspace: workspace as unknown as Workspace, tab },
      context: viewShellContext(fakeViewShell(NOW)),
    })
    const chip = screen.getByTestId('log-customise')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    const rows = (): string[] => within(screen.getByTestId('log-rows')).queryAllByRole('listitem').map((li) => li.dataset.testid!)
    expect(rows()).toEqual(['event:r1'])
    expect(screen.getByTestId('event:r1')).toHaveTextContent('Layout focus.json reloaded from this vault')
    await user.click(chip)
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(rows()).toHaveLength(4)
  })
})
