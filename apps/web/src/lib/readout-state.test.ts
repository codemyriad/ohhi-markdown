/**
 * The readouts' view of the focused pane (quiet-shell F6, spike S21 Q3) and
 * the one word count every surface shares.
 */
import { describe, expect, it } from 'vitest'
import { paneAt, strip } from './panes.fixture.js'
import { focusPane, split, zoom } from './panes.js'
import { newGroup } from './groups.js'
import { getLL } from '@ohhi/i18n'
import { focusedOf, focusedPeers, leadText, noteStatus, zoomedAway } from './readout-state.js'
import { readoutTestid, statusBarTestid } from './readouts.js'
import { slotFor, withNames } from './presence.js'
import { countWords, readingMinutes } from './words.js'

const synced = { connected: true, synced: true, pendingLocal: false, diskMatchesCrdt: true, diverged: false }

describe('countWords / readingMinutes', () => {
  it('counts letter-and-digit runs, keeping apostrophes and hyphens inside a word', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('# Marks and Channels')).toBe(3)
    expect(countWords("it's a well-known 2-step — done")).toBe(5)
    expect(countWords('café naïve 東京')).toBe(3)
  })

  it('rounds reading time up to whole minutes, and says 0 only for nothing', () => {
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(1)).toBe(1)
    expect(readingMinutes(200)).toBe(1)
    expect(readingMinutes(201)).toBe(2)
  })
})

describe('focusedOf', () => {
  it('follows the focused pane, not the first one', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const two = split(l, paneAt(l).id, 'row', gen)
    expect(focusedOf(two).path).toBe(focusedOf(l).path)
    const other = paneAt(two, 0).id === two.focus ? paneAt(two, 1) : paneAt(two, 0)
    const moved = focusPane(two, other.id)
    expect(focusedOf(moved).pane.id).toBe(other.id)
  })

  it('names the active tab and its group, if any', () => {
    const { l, gen } = strip('a.md', 'b.md')
    expect(focusedOf(l).group).toBeNull()
    const pane = paneAt(l)
    const f = focusedOf(newGroup(l, pane.id, pane.active!, gen))
    expect(f.path).toBe('b.md')
    expect(f.group).not.toBeNull()
  })
})

describe('noteStatus', () => {
  const files = [{ path: 'a.md', guid: 'g1' }]
  it('is the pane pill: f(record), null with no note or no record', () => {
    expect(noteStatus(files, { g1: synced }, 'a.md')).toBe('green')
    expect(noteStatus(files, { g1: { ...synced, diverged: true } }, 'a.md')).toBe('red')
    expect(noteStatus(files, {}, 'a.md')).toBeNull()
    expect(noteStatus(files, { g1: synced }, null)).toBeNull()
  })
})

describe('zoomedAway', () => {
  it('counts the panes kept off screen while one is zoomed', () => {
    const { l, gen } = strip('a.md')
    const two = split(l, paneAt(l).id, 'row', gen)
    expect(zoomedAway(two)).toBeNull()
    expect(zoomedAway(zoom(two, two.focus))).toBe(1)
  })
})

describe('focusedPeers (sharing E1)', () => {
  const cynthia = { name: 'Cynthia', color: slotFor('Cynthia'), clientId: 1 }
  const sam = { name: 'Sam', color: slotFor('Sam'), clientId: 2 }
  it('is who is in the FOCUSED note, nobody otherwise', () => {
    const { l } = strip('a.md', 'b.md')
    expect(focusedPeers(l, { 'b.md': [cynthia] })).toEqual([cynthia])
    expect(focusedPeers(l, { 'a.md': [cynthia] })).toEqual([])
    expect(focusedPeers(l, {})).toEqual([])
  })

  it('words the "with …" by count, by unique name', () => {
    expect(withNames([])).toBeNull()
    expect(withNames([cynthia, { ...cynthia, clientId: 9 }])).toEqual({ kind: 'one', a: 'Cynthia' })
    expect(withNames([sam, cynthia])).toEqual({ kind: 'two', a: 'Cynthia', b: 'Sam' })
    expect(withNames([sam, cynthia, { ...sam, name: 'Ann' }])).toEqual({ kind: 'many', a: 'Ann', count: 2 })
  })
})

describe('a per-pane status bar\'s readouts (duplication review #11)', () => {
  it('follow the pane they are given, not the focused one; an unknown id falls back to focus', () => {
    const { l, gen } = strip('a.md', 'b.md')
    const two = split(l, paneAt(l).id, 'row', gen)
    const other = paneAt(two, 0).id === two.focus ? paneAt(two, 1) : paneAt(two, 0)
    expect(focusedOf(two, other.id).pane.id).toBe(other.id)
    expect(focusedOf(two, 'gone').pane.id).toBe(two.focus)
  })

  it('carry the status bar\'s testids: bare in the focused pane, per pane elsewhere', () => {
    const focused = { id: 'p1', focused: true, lead: true }
    const other = { id: 'p2', focused: false, lead: true }
    expect(readoutTestid({ merged: false, pane: focused }, 'word-count')).toBe('word-count')
    expect(readoutTestid({ merged: false, pane: other }, 'mode-menu')).toBe('mode-menu:p2')
    expect(readoutTestid({ merged: false, pane: other }, 'sync-pill-note')).toBe('sync-pill-pane:p2')
    expect(readoutTestid({ merged: false }, 'word-count')).toBe('toolbar-word-count')
    expect(readoutTestid({ merged: true }, 'word-count')).toBe('word-count')
    expect(statusBarTestid(focused)).toBe('status-bar')
    expect(statusBarTestid(other)).toBe('pane-status:p2')
  })

  it('word the lead the dictionary\'s way', () => {
    const LL = getLL()
    expect(leadText(2, 3, LL)).toBe(LL.web.panes.lead({ pane: LL.web.panes.label({ n: 2 }), tabs: LL.web.panes.tab_count({ count: 3 }) }))
  })
})
