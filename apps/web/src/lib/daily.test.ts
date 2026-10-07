// @vitest-environment jsdom
/**
 * The daily-notes shell layer (W3): what `daily-notes.ts`'s pure suite cannot
 * see — that the config is read off the OPEN vault, that the guards' memo and
 * the steps agree, that "today" is created only when it is missing, and that
 * a format with unsupported tokens is said once, as a notice.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fakeDailyWorkspace, withDaily, type DailyHarness } from './daily.fixture.svelte.js'
import { DAILY_DEFAULTS } from './daily-notes.js'

const CHRIS = { format: 'DD-M-Y', folder: 'Daily' }
/** 2026-09-10, mid-morning local time. */
const NOW = new Date(2026, 8, 10, 10, 30).getTime()
const DAILIES = ['Daily/29-8-2026.md', 'Daily/10-9-2026.md', 'Daily/12-9-2026.md', 'notes/a.md']

let harness: DailyHarness | null = null

/** Let the async config read settle, then run the derivations. */
async function settle(h: DailyHarness): Promise<void> {
  h.flush()
  await Promise.resolve()
  await Promise.resolve()
  h.flush()
}

afterEach(() => {
  harness?.stop()
  harness = null
})

describe('createDaily', () => {
  it('reads the vault config once it is open, defaults until then', async () => {
    const ws = fakeDailyWorkspace(DAILIES, CHRIS)
    harness = withDaily(() => NOW)
    expect(harness.daily.config).toEqual(DAILY_DEFAULTS)

    harness.setWorkspace(ws)
    await settle(harness)
    expect(harness.daily.config).toEqual(CHRIS)
    expect(ws.notices).toEqual([])
  })

  it('steps from today when no daily is focused, and from the focused daily otherwise', async () => {
    const ws = fakeDailyWorkspace(DAILIES, CHRIS)
    harness = withDaily(() => NOW, ws)
    await settle(harness)

    expect(harness.daily.steps).toEqual({ prev: 'Daily/29-8-2026.md', next: 'Daily/12-9-2026.md' })
    expect(harness.daily.neighbours()).toEqual(harness.daily.steps)

    ws.ui.selectedPath = 'Daily/29-8-2026.md'
    harness.flush()
    expect(harness.daily.steps).toEqual({ prev: null, next: 'Daily/10-9-2026.md' })

    harness.daily.step('next')
    harness.daily.step('prev') // no-op at the end
    expect(harness.opened).toEqual(['Daily/10-9-2026.md'])
  })

  it('opens today when it exists — matched on the date, not the spelling', async () => {
    // `03-01-2025` is not how DD-M-Y writes it, but it IS that day.
    const ws = fakeDailyWorkspace(['Daily/03-09-2026.md'], CHRIS)
    harness = withDaily(() => new Date(2026, 8, 3, 9).getTime(), ws)
    await settle(harness)

    await harness.daily.openToday()
    expect(harness.opened).toEqual(['Daily/03-09-2026.md'])
    expect(ws.created).toEqual([])
  })

  it('creates today in the configured folder when it is missing, then opens it', async () => {
    const ws = fakeDailyWorkspace(['notes/a.md'], CHRIS)
    harness = withDaily(() => NOW, ws)
    await settle(harness)

    await harness.daily.openToday()
    expect(ws.created).toEqual([{ dir: 'Daily', name: '10-9-2026.md' }])
    expect(harness.opened).toEqual(['Daily/10-9-2026.md'])
  })

  it('says once, as a notice, when the format has tokens it cannot honour', async () => {
    const ws = fakeDailyWorkspace([], { format: 'YYYY-MM-DD [week] W', folder: '' })
    harness = withDaily(() => NOW, ws)
    await settle(harness)

    expect(ws.notices).toHaveLength(1)
    expect(ws.notices[0]?.level).toBe('warn')
    expect(ws.notices[0]).toMatchObject({ code: 'daily_format', params: { tokens: 'W' } })
  })
})
