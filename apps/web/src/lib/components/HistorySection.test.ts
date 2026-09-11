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

/** The injected scheduler (golden rule 5): one armed timer, fired by hand. */
function fakeSchedule() {
  const armed: { fn: () => void; ms: number }[] = []
  const schedule = (fn: () => void, ms: number): (() => void) => {
    armed.push({ fn, ms })
    return () => {
      const i = armed.findIndex((a) => a.fn === fn)
      if (i >= 0) armed.splice(i, 1)
    }
  }
  return { armed, schedule, fire: () => armed.shift()?.fn() }
}

function open(
  rows: PreImageInfo[] | null,
  path: string | null = PATH,
  opts: {
    restore?: (path: string, seq: number) => Promise<void>
    now?: () => number
    schedule?: (fn: () => void, ms: number) => () => void
  } = {}
) {
  const load = vi.fn(async () => rows ?? [])
  const restore = vi.fn(opts.restore ?? (async () => {}))
  const { rerender } = render(HistorySection, {
    path,
    load,
    restore,
    now: opts.now ?? (() => NOW),
    ...(opts.schedule ? { schedule: opts.schedule } : {}),
  })
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

  it('keeps the dialog open and says so when the restore FAILS (Minor 18)', async () => {
    const user = userEvent.setup()
    const { load, restore } = open([entry(9, 20, 2048)], PATH, {
      restore: async () => {
        throw new Error('no journaled version 9 of that note remains')
      },
    })

    await user.click(await screen.findByTestId('history-restore:9'))
    await user.click(await screen.findByTestId('history-confirm-confirm'))

    // A restore that did not happen must never look like one that did: the
    // dialog stays up, the reason is on screen, and the list is NOT re-read
    // as though the journal had changed.
    expect(restore).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('history-confirm-error')).toHaveTextContent(
      'no journaled version 9'
    )
    expect(screen.getByTestId('history-confirm')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
    // …and it can be tried again: the confirm is not stuck on "Working…".
    expect(screen.getByTestId('history-confirm-confirm')).toBeEnabled()
    await user.click(screen.getByTestId('history-confirm-confirm'))
    expect(restore).toHaveBeenCalledTimes(2)

    // Cancelling clears the failure with the dialog.
    await user.click(screen.getByTestId('history-confirm-cancel'))
    await waitFor(() => expect(screen.queryByTestId('history-confirm')).toBeNull())
  })

  it('re-labels the rows when the day turns over (Minor 22)', async () => {
    const clock = fakeSchedule()
    let now = NOW
    const at = NOW - 30 * 60_000 // half an hour ago: "today", so a time alone
    open([entry(9, 30, 2048)], PATH, { now: () => now, schedule: clock.schedule })

    const row = await screen.findByTestId('history-entry:9')
    expect(row).toHaveTextContent(formatStamp(at, NOW))
    // Armed for the next local midnight, not polled.
    const midnight = new Date(NOW)
    midnight.setHours(24, 0, 0, 0)
    expect(clock.armed[0]?.ms).toBe(midnight.getTime() - NOW)

    // Tomorrow: the same version is no longer "today", and the row has to say
    // so — a rail left open overnight was still printing bare times.
    now = midnight.getTime() + 60_000
    clock.fire()
    await waitFor(() => expect(row).toHaveTextContent(formatStamp(at, now)))
    expect(formatStamp(at, now)).not.toBe(formatStamp(at, NOW))
    // …and it re-armed for the midnight after that.
    expect(clock.armed).toHaveLength(1)
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
