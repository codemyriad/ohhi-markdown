import { describe, expect, it } from 'vitest'
import { EXAMPLES, PRESETS } from './layout-spec.js'
import { DENSE_CHROME, newTabDocks, paneChrome, showsFocusEdge, showsStrip, showsSyncDot } from './pane-chrome.js'

const quiet = paneChrome(PRESETS.default)
const dense = paneChrome(EXAMPLES.dense)
const pane = (tabs: number, groups = 0) => ({
  tabs: Array.from({ length: tabs }, () => ({})) as never[],
  groups: Array.from({ length: groups }, () => ({})) as never[],
})

describe('pane chrome (spike S21)', () => {
  it('dense resolves to today’s chrome', () => {
    expect(dense).toEqual(DENSE_CHROME)
  })

  it('auto: no strip for a lone tab, a strip at two tabs or any group', () => {
    const auto = { ...quiet, tabs: 'auto' as const }
    expect(showsStrip(auto, pane(1))).toBe(false)
    expect(showsStrip(auto, pane(2))).toBe(true)
    expect(showsStrip(auto, pane(1, 1))).toBe(true)
    expect(showsStrip(dense, pane(1))).toBe(true)
  })

  it('default draws the strip from one note (Chris, 2026-10-06: the new-tab button is always there)', () => {
    expect(quiet.tabs).toBe('always')
    expect(showsStrip(quiet, pane(1))).toBe(true)
  })

  it('the new-tab button follows the last tab while the tabs fit, and docks once they overflow', () => {
    expect(newTabDocks({ content: 300, room: 400 })).toBe(false)
    expect(newTabDocks({ content: 400, room: 400 })).toBe(false)
    // Sub-pixel layout is not an overflow.
    expect(newTabDocks({ content: 400.4, room: 400 })).toBe(false)
    expect(newTabDocks({ content: 401, room: 400 })).toBe(true)
    // Docked: the + took 28 px from the run's room and left its content — the
    // same answer either side, so it never flips back and forth.
    expect(newTabDocks({ content: 401 - 28, room: 400 - 28 })).toBe(true)
  })

  it('Focus mode hides the strip in every layout', () => {
    expect(showsStrip({ ...dense, focusMode: true }, pane(3))).toBe(false)
    expect(showsStrip({ ...quiet, focusMode: true }, pane(1, 1))).toBe(false)
  })

  it('draws the focus edge on the focused pane only when two or more are on screen', () => {
    expect(showsFocusEdge(quiet, true, 1)).toBe(false)
    expect(showsFocusEdge(quiet, true, 2)).toBe(true)
    expect(showsFocusEdge(quiet, false, 2)).toBe(false)
    expect(showsFocusEdge(dense, true, 2)).toBe(false)
  })

  it('an unfocused pane off green shows its own dot under a merged status bar', () => {
    expect(showsSyncDot(quiet, false, 'offline')).toBe(true)
    expect(showsSyncDot(quiet, false, 'red')).toBe(true)
    expect(showsSyncDot(quiet, false, 'yellow')).toBe(true)
    expect(showsSyncDot(quiet, false, 'green')).toBe(false)
    expect(showsSyncDot(quiet, false, null)).toBe(false)
    // The focused pane's state is the toolbar pill's; dense keeps a pill per pane.
    expect(showsSyncDot(quiet, true, 'offline')).toBe(false)
    expect(showsSyncDot(dense, false, 'offline')).toBe(false)
  })
})
