import { SimClock } from '@ohhi/testkit'
import { describe, expect, it } from 'vitest'
import {
  CHANGE_KINDS,
  EVENT_KINDS,
  EVENT_LOG_CAP,
  EventLog,
  RelayRefusedError,
  countUnread,
  filterEvents,
  mergeNewestFirst,
  upsertEvent,
  type AppEvent,
  type EventInput,
} from '../src/index.js'

const notice = (code: string, extra: Partial<EventInput<'notice'>> = {}): EventInput<'notice'> => ({
  kind: 'notice',
  level: 'error',
  payload: { code },
  ...extra,
})

describe('EventLog (spike S22 Q3)', () => {
  it('stamps from the injected clock, ids per log, newest first', () => {
    const clock = new SimClock()
    const log = new EventLog({ clock })
    clock.advance(10)
    const a = log.append(notice('a'))
    clock.advance(5)
    const b = log.append({ kind: 'mount.changed', level: 'info', scope: { room: 'r1', path: 'team' }, payload: { what: 'adopted' } })
    expect(a).toMatchObject({ id: 'app:1', at: 10, count: 1, actor: { kind: 'app' }, scope: {} })
    expect(b).toMatchObject({ id: 'app:2', at: 15, kind: 'mount.changed', scope: { room: 'r1', path: 'team' } })
    expect(log.events().map((e) => e.id)).toEqual(['app:2', 'app:1'])
  })

  it('prefixes ids with the room for a per-room log', () => {
    const log = new EventLog({ clock: new SimClock(), room: 'room-7' })
    expect(log.append(notice('x')).id).toBe('room-7:1')
  })

  it('folds an IMMEDIATE repeat of the same code + scope into count, moving `at`', () => {
    const clock = new SimClock()
    const log = new EventLog({ clock })
    log.append(notice('relay', { scope: { room: 'r', path: 'p' } }))
    clock.advance(100)
    const again = log.append(notice('relay', { scope: { room: 'r', path: 'p' } }))
    expect(again).toMatchObject({ id: 'app:1', count: 2, at: 100 })
    expect(log.size).toBe(1)
    // A different scope, params or level is a new event…
    log.append(notice('relay', { scope: { room: 'r', path: 'q' } }))
    log.append({ ...notice('relay', { scope: { room: 'r', path: 'q' } }), payload: { code: 'relay', params: { n: 1 } } })
    log.append(notice('relay', { level: 'warn', scope: { room: 'r', path: 'q' } }))
    expect(log.size).toBe(4)
    // …and a repeat that is not the newest stacks rather than folds.
    log.append(notice('relay', { scope: { room: 'r', path: 'p' } }))
    expect(log.events()[0]).toMatchObject({ id: 'app:5', count: 1 })
  })

  it('treats equal params in another key order as the same payload', () => {
    const log = new EventLog({ clock: new SimClock() })
    log.append({ kind: 'notice', level: 'warn', payload: { code: 'c', params: { a: 1, b: 'x' } } })
    log.append({ kind: 'notice', level: 'warn', payload: { code: 'c', params: { b: 'x', a: 1 } } })
    expect(log.events()).toHaveLength(1)
    expect(log.events()[0]?.count).toBe(2)
  })

  it('is capped: the oldest fall off, ids keep counting', () => {
    const clock = new SimClock()
    const log = new EventLog({ clock })
    for (let i = 0; i < EVENT_LOG_CAP + 7; i++) log.append(notice(`n${i}`))
    expect(log.size).toBe(EVENT_LOG_CAP)
    const events = log.events()
    expect(events[0]?.id).toBe(`app:${EVENT_LOG_CAP + 7}`)
    expect(events.at(-1)?.payload).toEqual({ code: 'n7' })
    const small = new EventLog({ clock, cap: 2 })
    small.append(notice('a'))
    small.append(notice('b'))
    small.append(notice('c'))
    expect(small.events().map((e) => (e.payload as { code: string }).code)).toEqual(['c', 'b'])
  })

  it('filters by level, kind, scope (path takes in its subtree) and time', () => {
    const clock = new SimClock()
    const log = new EventLog({ clock })
    log.append(notice('e1', { scope: { room: 'r1', mount: 'team', path: 'team/a.md' } }))
    clock.advance(10)
    log.append(notice('w1', { level: 'warn', scope: { path: 'teammates.md' } }))
    clock.advance(10)
    log.append({ kind: 'mount.changed', level: 'info', scope: { room: 'r1', mount: 'team', path: 'team' }, payload: { what: 'absorbed' } })
    const codes = (es: { id: string }[]): string[] => es.map((e) => e.id)
    expect(codes(filterEvents(log.events(), { levels: ['error', 'warn'] }))).toEqual(['app:2', 'app:1'])
    expect(codes(filterEvents(log.events(), { kinds: ['mount.changed'] }))).toEqual(['app:3'])
    expect(codes(filterEvents(log.events(), { scope: { path: 'team' } }))).toEqual(['app:3', 'app:1'])
    expect(codes(filterEvents(log.events(), { scope: { room: 'r1', mount: 'team' } }))).toEqual(['app:3', 'app:1'])
    expect(codes(filterEvents(log.events(), { since: 10 }))).toEqual(['app:3'])
    expect(codes(filterEvents(log.events(), { since: 0, levels: ['warn'] }))).toEqual(['app:2'])
  })

  it('counts unread after a moment, and a folded repeat is unread again', () => {
    const clock = new SimClock()
    const log = new EventLog({ clock })
    log.append(notice('a'))
    clock.advance(10)
    log.append({ ...notice('b'), level: 'info' })
    expect(countUnread(log.events(), 5)).toBe(1)
    expect(countUnread(log.events(), 5, { levels: ['error', 'warn'] })).toBe(0)
    clock.advance(10)
    log.append({ ...notice('b'), level: 'info' })
    expect(countUnread(log.events(), 15)).toBe(1)
    expect(countUnread(log.events(), -1)).toBe(2)
  })

  it('upsertEvent keeps a host map oldest first and capped; mergeNewestFirst merges sorted lists', () => {
    const ev = (id: string, at: number) => ({ ...notice(id), id, at, count: 1, actor: { kind: 'app' as const }, scope: {} }) as AppEvent
    const byId = new Map<string, AppEvent>()
    upsertEvent(byId, ev('r:1', 1), 3)
    upsertEvent(byId, ev('r:2', 2), 3)
    upsertEvent(byId, ev('r:1', 5), 3) // a fold re-reports r:1 with `at` moved to now
    expect([...byId.keys()]).toEqual(['r:2', 'r:1'])
    upsertEvent(byId, ev('r:3', 6), 3)
    upsertEvent(byId, ev('r:4', 7), 3)
    expect([...byId.keys()]).toEqual(['r:1', 'r:3', 'r:4'])
    const app = [ev('app:1', 0), ev('app:2', 6.5)]
    expect(mergeNewestFirst([app, [...byId.values()], []]).map((e) => e.id)).toEqual(['r:4', 'app:2', 'r:3', 'r:1', 'app:1'])
  })

  it('clear forgets the ring but never reuses an id', () => {
    const log = new EventLog({ clock: new SimClock() })
    log.append(notice('a'))
    log.clear()
    expect(log.events()).toEqual([])
    expect(log.append(notice('a')).id).toBe('app:2')
  })

  it('names eleven kinds, four of them changes', () => {
    expect(EVENT_KINDS).toHaveLength(11)
    expect([...CHANGE_KINDS].every((k) => (EVENT_KINDS as readonly string[]).includes(k))).toBe(true)
    expect(CHANGE_KINDS.size).toBe(4)
  })
})

describe('RelayRefusedError', () => {
  it('carries the relay reason by type, not by message', () => {
    const err = new RelayRefusedError('permission-denied', 'diagnostic')
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('relay.refused')
    expect(err.reason).toBe('permission-denied')
  })
})
