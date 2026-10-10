// @vitest-environment jsdom
import { getLL } from '@ohhi/i18n'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { collectReportFacts } from '../help.svelte.js'
import { event, notice } from '../readouts.fixture.js'
import { REPORT_EVENTS, reportFactLines, reportText, type ReportFacts } from '../report.js'
import type { Workspace } from '../workspace.svelte.js'
import ReportDialog from './ReportDialog.svelte'

afterEach(cleanup)

const LL = getLL()
const NOW = Date.UTC(2026, 9, 10, 12, 0)
const SECRET_TEXT = 'the secret body of a note'

const green = { connected: true, synced: true, pendingLocal: false, diskMatchesCrdt: true, diverged: false }

const facts: ReportFacts = {
  version: '0.1.42',
  desktop: true,
  os: 'Linux x86_64',
  vault: { name: 'Work', kind: 'tauri' },
  relays: [{ host: 'ohhi.example.ts.net', state: 'connected', inSyncSince: NOW - 60_000 }],
  note: { path: 'team/plan.md', status: 'green' },
  people: 2,
  events: [
    notice('a', NOW - 1000, 'error', { path: 'team/plan.md' }),
    event({ kind: 'doc.changed', at: NOW - 2000, scope: { path: 'team/plan.md' }, actor: { kind: 'peer', name: 'Sam' }, payload: { guid: 'g1', added: 12 } }),
    notice('c', NOW - 3000, 'warn'),
  ],
}

describe('reportFactLines', () => {
  it('says the build, the vault, the relay, the note in the pill’s words, and the Log', () => {
    const lines = reportFactLines(facts, LL)
    expect(lines.slice(0, 5)).toEqual([
      'App: Oh hi markdown 0.1.42 · desktop app on Linux x86_64',
      'Vault: Work (a folder on disk)',
      `Relay: ohhi.example.ts.net · Connected · in sync with the relay since ${new Date(NOW - 60_000).toISOString()}`,
      'Open note: team/plan.md · synced (relay) · 2 people online',
      'This session: 1 error, 1 warning',
    ])
    expect(lines[5]).toBe('The last 3 events from the Log:')
    expect(lines[6]).toContain('error  notice  team/plan.md  msg a')
    expect(lines[7]).toContain('info  doc.changed  team/plan.md')
    expect(lines[7]).toContain('Sam')
  })

  it('is honest about what it does not know: no vault, no relay, no note, no version', () => {
    const lines = reportFactLines({ ...facts, version: null, desktop: false, os: null, vault: null, relays: [], note: null, events: [] }, LL)
    expect(lines).toEqual([
      'App: Oh hi markdown version not known · browser',
      'Vault: none open',
      'Relay: none (nothing in this vault is shared or linked)',
      'Open note: none',
      'This session: 0 errors, 0 warnings',
      'The Log is empty this session.',
    ])
  })

  it(`carries at most the last ${REPORT_EVENTS} events, but counts them all`, () => {
    const many = Array.from({ length: 30 }, (_, i) => notice(`n${i}`, NOW - i, 'warn'))
    const lines = reportFactLines({ ...facts, events: many }, LL)
    expect(lines).toContain('This session: 0 errors, 30 warnings')
    expect(lines.filter((l) => l.startsWith('  '))).toHaveLength(REPORT_EVENTS)
  })

  it('the copy starts with the time and the person’s sentence', () => {
    const text = reportText('  It froze\n when I pasted ', facts, NOW, LL)
    expect(text.split('\n').slice(0, 3)).toEqual([
      `Oh hi markdown — problem report (${new Date(NOW).toISOString()})`,
      'What happened: It froze when I pasted',
      '',
    ])
    expect(reportText('', facts, NOW, LL)).toContain('What happened: (not filled in)')
  })
})

describe('collectReportFacts — metadata only, never note content', () => {
  /** A workspace whose only readable parts are the metadata; reading a note throws. */
  function fakeWorkspace(): Workspace {
    const ui = {
      linked: false,
      mounts: [],
      files: [{ path: 'notes/a.md', guid: 'g1', kind: 'text' }],
      records: { g1: green },
      presenceByRoom: { root: ['Me', 'Sam'] },
      events: facts.events,
      selectedPath: 'notes/a.md',
    }
    const ws = { room: 'root', user: { name: 'Me' }, ui, startedAt: NOW, rootRelayUrl: () => null }
    return new Proxy(ws, {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target]
        throw new Error(`report read ws.${String(key)}`)
      },
    }) as unknown as Workspace
  }

  it('reads the path, the record, presence and the log — and nothing that holds text', () => {
    const f = collectReportFacts(fakeWorkspace(), { vault: { name: 'Mine', kind: 'opfs' }, inSyncByRoom: {} })
    expect(f.note).toEqual({ path: 'notes/a.md', status: 'green' })
    expect(f.people).toBe(1)
    expect(f.relays).toEqual([])
    expect(f.events).toBe(facts.events)
    expect(reportText(SECRET_TEXT.slice(0, 0), f, NOW, LL)).not.toContain(SECRET_TEXT)
  })
})

describe('ReportDialog', () => {
  it('shows the facts and the promise, then copies the sentence with them', async () => {
    const user = userEvent.setup()
    const write = vi.fn(async (_text: string) => {})
    render(ReportDialog, { facts, now: () => NOW, write, onClose: vi.fn() })
    expect(screen.getByRole('dialog', { name: 'Report a problem' })).toBeInTheDocument()
    expect(screen.getByText('Attached automatically')).toBeInTheDocument()
    expect(screen.getByTestId('report-never')).toHaveTextContent('Note contents are never included.')
    const shown = screen.getAllByTestId('report-fact').map((li) => li.textContent)
    expect(shown).toEqual(reportFactLines(facts, LL))

    await user.type(screen.getByTestId('report-what'), 'The pill stayed yellow')
    await user.click(screen.getByTestId('report-copy'))
    expect(write).toHaveBeenCalledTimes(1)
    const text = write.mock.calls[0]![0]
    expect(text).toContain('What happened: The pill stayed yellow')
    expect(text).toContain('Open note: team/plan.md · synced (relay) · 2 people online')
    // Copied, never "sent": the person pastes it.
    expect(await screen.findByTestId('report-copied')).toHaveTextContent('Report copied. Paste it in the team chat.')
    expect(document.body.textContent).not.toMatch(/\bsent\b/i)
    expect(screen.getByTestId('report-cancel')).toHaveTextContent('Close')
  })

  it('a refused clipboard shows the whole report, selected, to copy by hand', async () => {
    const user = userEvent.setup()
    const write = vi.fn(async () => {
      throw new Error('denied')
    })
    render(ReportDialog, { facts, now: () => NOW, write, onClose: vi.fn() })
    await user.click(screen.getByTestId('report-copy'))
    const box = (await screen.findByTestId('report-fallback')) as HTMLTextAreaElement
    expect(box.value).toContain('App: Oh hi markdown 0.1.42')
    await waitFor(() => expect(box).toHaveFocus())
    expect(screen.queryByTestId('report-copied')).toBeNull()
  })

  it('Cancel closes', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(ReportDialog, { facts, now: () => NOW, onClose, write: vi.fn(async () => {}) })
    await user.click(screen.getByTestId('report-cancel'))
    expect(onClose).toHaveBeenCalled()
  })
})
