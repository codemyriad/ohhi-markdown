// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLL } from '@editor/i18n'
import { formatSize, formatStamp } from '../history.js'
import type { PreImageInfo } from '../workspace.svelte.js'
import HistorySection from './HistorySection.svelte'

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

const t = getLL().web.history
const NOW = new Date(2026, 8, 10, 18, 0).getTime()
const PATH = 'Daily/10-9-2026.md'

const entry = (seq: number, minutesAgo: number, size: number): PreImageInfo => ({
  seq,
  at: NOW - minutesAgo * 60_000,
  size,
})

function open(rows: PreImageInfo[] | null, path: string | null = PATH) {
  const load = vi.fn(async () => rows ?? [])
  const restore = vi.fn(async () => {})
  const { rerender } = render(HistorySection, { path, load, restore, now: () => NOW })
  return { load, restore, rerender }
}

describe('HistorySection', () => {
  it('says what to do when no note is open, and never reads the journal', () => {
    const { load } = open([], null)
    expect(screen.getByText(t.no_note())).toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })

  it('explains an empty journal rather than showing an empty list', async () => {
    open([])
    expect(await screen.findByTestId('history-empty')).toHaveTextContent(t.empty())
  })

  it('lists the pre-images the journal holds, with their time and size', async () => {
    open([entry(9, 20, 2048), entry(8, 90, 512)])

    const newest = await screen.findByTestId('history-entry:9')
    expect(newest).toHaveTextContent(formatStamp(NOW - 20 * 60_000, NOW))
    expect(newest).toHaveTextContent(formatSize(2048))
    expect(screen.getByTestId('history-entry:8')).toHaveTextContent(formatSize(512))
    // Newest first is the journal's order; the section does not re-sort it.
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('data-testid', 'history-entry:9')
  })

  it('names the version a Restore button restores, so it reads alone', async () => {
    open([entry(9, 20, 2048)])
    const button = await screen.findByTestId('history-restore:9')
    expect(button).toHaveAccessibleName(t.restore_this({ time: formatStamp(NOW - 20 * 60_000, NOW) }))
  })

  it('asks before restoring, and cancelling restores nothing', async () => {
    const user = userEvent.setup()
    const { restore } = open([entry(9, 20, 2048)])

    await user.click(await screen.findByTestId('history-restore:9'))
    expect(await screen.findByTestId('history-confirm')).toBeInTheDocument()
    await user.click(screen.getByTestId('history-confirm-cancel'))

    expect(restore).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('history-confirm')).toBeNull())
  })

  it('re-reads when Editor writes the note, because that is when a version is made', async () => {
    const { load, rerender } = open([entry(9, 20, 2048)])
    await screen.findByTestId('history-entry:9')
    expect(load).toHaveBeenCalledTimes(1)

    // diskMatchesCrdt goes false while the flush is pending, true when it lands.
    await rerender({ written: false })
    await rerender({ written: true })
    await waitFor(() => expect(load).toHaveBeenCalledTimes(3))
    // The rows on screen never went away while it re-read.
    expect(screen.getByTestId('history-entry:9')).toBeInTheDocument()
  })

  it('restores the confirmed version and re-reads the journal it just changed', async () => {
    const user = userEvent.setup()
    const { load, restore } = open([entry(9, 20, 2048)])

    await user.click(await screen.findByTestId('history-restore:9'))
    await user.click(await screen.findByTestId('history-confirm-confirm'))

    expect(restore).toHaveBeenCalledWith(PATH, 9)
    // A restore journals what it replaced, so the list is stale the moment it
    // succeeds — it has to come back with the new version in it.
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2))
  })
})
