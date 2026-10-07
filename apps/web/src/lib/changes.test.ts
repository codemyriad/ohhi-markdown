import { SimClock } from '@ohhi/testkit'
import type { AppEvent } from '@ohhi/workspace'
import { describe, expect, it } from 'vitest'
import { changeActors, changeTicks, foldChanges, groupForDrawer, TICK_WINDOW_MS } from './changes.js'
import { event as ev } from './readouts.fixture.js'

const MIN = 60_000

const cynthia = { kind: 'peer' as const, name: 'Cynthia' }
const sam = { kind: 'peer' as const, name: 'Sam' }
const viaRelay = { kind: 'relay' as const, name: 'relay.ohhi.md' }

/** Local noon on a fixed day, so day grouping never straddles midnight in any zone. */
const NOON = new Date(2026, 9, 2, 12, 0, 0).getTime()

const doc = (at: number, path: string, actor: AppEvent['actor'], added = 1, removed = 0, room = 'cs'): AppEvent =>
  ev({ kind: 'doc.changed', at, scope: { room, path }, actor, payload: { guid: path, added, removed } })

describe('foldChanges (sharing E3)', () => {
  it('folds one note by one person within the window into one line, summing the deltas', () => {
    const days = foldChanges([doc(NOON, 'CS/Raft.md', cynthia, 10, 2), doc(NOON - 10 * MIN, 'CS/Raft.md', cynthia, 4, 1)])
    expect(days).toHaveLength(1)
    expect(days[0]!.lines).toMatchObject([{ path: 'CS/Raft.md', at: NOON, added: 14, removed: 3, count: 2 }])
  })

  it('keeps separate lines for another person, another note, or past the window', () => {
    const days = foldChanges([
      doc(NOON, 'CS/Raft.md', cynthia),
      doc(NOON - 1 * MIN, 'CS/Raft.md', sam),
      doc(NOON - 2 * MIN, 'CS/Paxos.md', cynthia),
      doc(NOON - 90 * MIN, 'CS/Raft.md', cynthia),
    ])
    expect(days[0]!.lines.map((l) => `${l.actor.name}:${l.path}`)).toEqual([
      'Cynthia:CS/Raft.md',
      'Sam:CS/Raft.md',
      'Cynthia:CS/Paxos.md',
      'Cynthia:CS/Raft.md',
    ])
  })

  it('groups by local day, newest first, and never lists your own edits', () => {
    const days = foldChanges([
      doc(NOON, 'a.md', cynthia),
      doc(NOON - 24 * 60 * MIN, 'b.md', viaRelay),
      doc(NOON - 5, 'c.md', { kind: 'me' }),
    ])
    expect(days.map((d) => d.lines.map((l) => l.path))).toEqual([['a.md'], ['b.md']])
    expect(days[0]!.day).toBeGreaterThan(days[1]!.day)
  })

  it('keeps file events as their own lines, a move with where it came from', () => {
    const days = foldChanges([
      ev({ kind: 'file.moved', at: NOON, scope: { room: 'cs', path: 'CS/b.md' }, actor: sam, payload: { from: 'CS/a.md' } }),
      ev({ kind: 'notice', at: NOON, payload: { code: 'x' } }),
    ])
    expect(days[0]!.lines).toMatchObject([{ kind: 'file.moved', path: 'CS/b.md', from: 'CS/a.md' }])
  })

  it('filters by room, person and time on the given clock', () => {
    const clock = new SimClock()
    clock.advance(NOON)
    const events = [
      doc(NOON - MIN, 'CS/a.md', cynthia),
      doc(NOON - 2 * MIN, 'M/b.md', sam, 1, 0, 'my'),
      doc(NOON - 3 * 24 * 60 * MIN, 'CS/old.md', cynthia),
    ]
    const paths = (f: Parameters<typeof foldChanges>[1]) =>
      foldChanges(events, f, clock.now()).flatMap((d) => d.lines.map((l) => l.path))
    expect(paths({ room: 'my' })).toEqual(['M/b.md'])
    expect(paths({ person: 'Cynthia' })).toEqual(['CS/a.md', 'CS/old.md'])
    expect(paths({ time: 'today' })).toEqual(['CS/a.md', 'M/b.md'])
    expect(paths({ time: 'week' })).toHaveLength(3)
    expect(changeActors(events).map((a) => a.name)).toEqual(['Cynthia', 'Sam'])
  })
})

describe('changeTicks', () => {
  it('ticks notes others changed in the last hour, and their mount roots; ageing out on the clock', () => {
    const clock = new SimClock()
    clock.advance(NOON)
    const events = [doc(NOON, 'CS/Raft.md', cynthia), doc(NOON, 'own.md', { kind: 'me' })]
    expect([...changeTicks(events, clock.now(), ['CS'])].sort()).toEqual(['CS', 'CS/Raft.md'])
    clock.advance(TICK_WINDOW_MS + 1)
    expect(changeTicks(events, clock.now(), ['CS']).size).toBe(0)
  })
})

describe('groupForDrawer (foundations-plan P6)', () => {
  const warn = (id: string, at: number, level: 'warn' | 'error' | 'info' = 'warn'): AppEvent =>
    ev({ id, kind: 'notice', level, at, payload: { code: 'x' } })

  it('errors and warnings first; changes grouped per note with everyone who made them, newest first', () => {
    const clock = new SimClock()
    clock.advance(NOON)
    const events = [
      doc(NOON - 1 * MIN, 'CS/Raft.md', cynthia, 3),
      warn('w', NOON - 2 * MIN),
      doc(NOON - 3 * MIN, 'CS/Paxos.md', sam),
      doc(NOON - 4 * MIN, 'CS/Raft.md', sam),
      { ...doc(NOON - 5 * MIN, 'CS/Raft.md', cynthia), count: 2 },
      doc(NOON - 6 * MIN, 'own.md', { kind: 'me' }),
      warn('e', NOON - 7 * MIN, 'error'),
      warn('i', NOON - 8 * MIN, 'info'),
    ]
    const m = groupForDrawer(events, clock.now())
    expect(m.problems.map((e) => e.id)).toEqual(['w', 'e'])
    expect(m.groups.map((g) => [g.path, g.actors.map((a) => a.name), g.count, g.at])).toEqual([
      ['CS/Raft.md', ['Cynthia', 'Sam'], 4, NOON - MIN],
      ['CS/Paxos.md', ['Sam'], 1, NOON - 3 * MIN],
    ])
    expect([m.errors, m.warnings, m.changes, m.rows]).toEqual([1, 1, 5, 6])
    // Both kinds: the whole Log; one kind: the Log filtered to it.
    expect(m.logArg).toBeUndefined()
    expect(groupForDrawer(events.filter((e) => e.kind === 'doc.changed'), clock.now()).logArg).toBe('changes')
    expect(groupForDrawer([warn('w', NOON)], clock.now()).logArg).toBe('problems')
  })

  it('a day-old change is the Log\'s, not the drawer\'s; the cap keeps the newest notes', () => {
    const clock = new SimClock()
    clock.advance(NOON)
    const old = doc(NOON - 25 * 60 * MIN, 'old.md', cynthia)
    expect(groupForDrawer([old], clock.now()).groups).toEqual([])
    const many = Array.from({ length: 25 }, (_, i) => doc(NOON - i * MIN, `n${i}.md`, cynthia))
    const m = groupForDrawer(many, clock.now())
    expect(m.groups).toHaveLength(20)
    expect(m.groups[0]!.path).toBe('n0.md')
    expect(m.changes).toBe(25)
    clock.advance(24 * 60 * MIN + 1)
    expect(groupForDrawer(many, clock.now()).groups).toEqual([])
  })
})
