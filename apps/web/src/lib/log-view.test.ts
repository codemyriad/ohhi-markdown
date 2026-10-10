import { getLL } from '@ohhi/i18n'
import type { AppEvent } from '@ohhi/workspace'
import { describe, expect, it } from 'vitest'
import { CUSTOMISE_CODES, eventHint, filterLog, logReport, scopeMatches, timeFloor, type LogFilter } from './log-view.js'
import { event, notice as ev } from './readouts.fixture.js'

const LL = getLL()
const NOW = new Date(2026, 9, 3, 15, 0).getTime()
const H = 60 * 60 * 1000


const mounts = [{ path: 'team', room: 'room-team' }]
const all: LogFilter = { levels: ['error', 'warn', 'info'], scope: { kind: 'all' }, time: 'all' }

describe('the Log view filters', () => {
  const events = [
    ev('a', NOW - H, 'error', { path: 'team/plan.md' }),
    ev('b', NOW - 2 * H, 'warn', { room: 'room-team' }),
    ev('c', NOW - 30 * H, 'info', { path: 'diary.md' }),
    ev('d', NOW - 10 * 24 * H, 'warn'),
  ]

  it('keeps the levels asked for', () => {
    expect(filterLog(events, { ...all, levels: ['warn'] }, mounts, NOW).map((e) => e.id)).toEqual(['b', 'd'])
    expect(filterLog(events, { ...all, levels: [] }, mounts, NOW)).toEqual([])
  })

  it('scopes to a shared folder by room, root or path under it; "this vault" is the rest', () => {
    const team = { kind: 'mount', path: 'team', room: 'room-team' } as const
    expect(filterLog(events, { ...all, scope: team }, mounts, NOW).map((e) => e.id)).toEqual(['a', 'b'])
    expect(filterLog(events, { ...all, scope: { kind: 'vault' } }, mounts, NOW).map((e) => e.id)).toEqual(['c', 'd'])
    expect(scopeMatches(ev('x', 0, 'info', { path: 'teammate.md' }), team, mounts)).toBe(false)
    expect(
      filterLog(events, { ...all, scope: { kind: 'note', path: 'diary.md' } }, mounts, NOW).map((e) => e.id)
    ).toEqual(['c'])
  })

  it('keeps today from local midnight and the week from seven days back', () => {
    expect(timeFloor('today', NOW)).toBe(new Date(2026, 9, 3).getTime())
    expect(filterLog(events, { ...all, time: 'today' }, mounts, NOW).map((e) => e.id)).toEqual(['a', 'b'])
    expect(filterLog(events, { ...all, time: 'week' }, mounts, NOW).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('the kinds filter (one filterLog for every axis)', () => {
  it('narrows to the kinds given, alongside levels, scope and time; null keeps every kind', () => {
    const change = event({ id: 'ch', kind: 'doc.changed', at: NOW - H, scope: { path: 'team/plan.md' } })
    const events = [change, ev('n', NOW - H, 'info', { path: 'team/plan.md' })]
    expect(filterLog(events, { ...all, kinds: ['doc.changed'] }, mounts, NOW).map((e) => e.id)).toEqual(['ch'])
    expect(filterLog(events, { ...all, kinds: null }, mounts, NOW).map((e) => e.id)).toEqual(['ch', 'n'])
    expect(filterLog(events, { ...all, kinds: ['doc.changed'], levels: ['error'] }, mounts, NOW)).toEqual([])
  })
})

describe('the plain-text report', () => {
  it('one line per row — ISO time, level, where, words, ×N — and the hint under an error', () => {
    const refused: AppEvent = {
      id: 'r',
      at: NOW - H,
      level: 'error',
      kind: 'relay.state',
      scope: { room: 'room-team' },
      actor: { kind: 'relay' },
      count: 3,
      payload: { to: 'refused', reason: 'expired' },
    }
    const text = logReport([refused, ev('w', NOW - 2 * H, 'warn', { path: 'a.md' })], NOW, LL)
    const lines = text.split('\n')
    expect(lines[0]).toBe(LL.web.log.report.header({ count: 2, time: new Date(NOW).toISOString() }))
    expect(lines[1]).toBe(
      [
        new Date(NOW - H).toISOString(),
        'error',
        'room room-team',
        LL.web.notices.relay_refused({ reason: 'expired' }),
        '×3',
      ].join('  ')
    )
    expect(lines[2]).toBe(`    hint: ${LL.web.log.hints.relay_refused()}`)
    expect(lines[3]).toBe([new Date(NOW - 2 * H).toISOString(), 'warning', 'a.md', 'msg w'].join('  '))
    expect(lines).toHaveLength(4)
  })

  it('a hint only for a complaint the app knows how to help with, never for info', () => {
    expect(eventHint(ev('x', 0, 'error'), LL)).toBeNull()
    const noToken: AppEvent = { ...ev('y', 0, 'warn'), payload: { code: 'no_token', params: { path: 't' } } }
    expect(eventHint(noToken, LL)).toBe(LL.web.log.hints.no_token())
    expect(eventHint({ ...noToken, level: 'info' }, LL)).toBeNull()
  })
})

describe('the codes filter — the Customise chip (settings-shaping ST6)', () => {
  it('keeps only notices about the app’s own files; null keeps everything', () => {
    const coded = (id: string, code: string): AppEvent => ({ ...ev(id, NOW - H, 'info'), payload: { code, params: {} } }) as AppEvent
    const events = [
      coded('r', 'resource_reloaded'),
      coded('l', 'layout_invalid'),
      coded('m', 'mount_error'),
      event({ id: 'ch', kind: 'doc.changed', at: NOW - H, scope: {} }),
    ]
    expect(filterLog(events, { ...all, codes: CUSTOMISE_CODES }, mounts, NOW).map((e) => e.id)).toEqual(['r', 'l'])
    expect(filterLog(events, { ...all, codes: null }, mounts, NOW)).toHaveLength(4)
  })

  it('names every code the customising wiring logs', () => {
    for (const code of ['resource_reloaded', 'layout_invalid', 'keymap_invalid', 'keymap_migrated', 'keymap_migrate_failed', 'template_failed']) {
      expect(CUSTOMISE_CODES).toContain(code)
    }
  })
})
