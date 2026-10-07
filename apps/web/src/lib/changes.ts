/**
 * The Changes card's pure half (sharing-shaping E3, R2 as amended): the
 * room logs' `CHANGE_KINDS` folded to one line per note per window, grouped
 * by day, filtered by room, person and time; and the tree's change ticks —
 * notes someone else changed in the last hour, ageing out on the clock the
 * caller reads. Every input is a value (`now` included), so it unit-tests
 * with a fake clock and nothing here holds a rule the view repeats.
 */
import { CHANGE_KINDS, type Actor, type AppEvent } from '@ohhi/workspace'
import { timeFloor, type LogTime } from './log-view.js'
import { localDay } from './relative-time.js'

/** Edits to one note by one actor within this span fold into one line. */
export const CHANGE_FOLD_MS = 30 * 60_000

/** A change tick stays on a tree row this long (sharing Fork 4-A). */
export const TICK_WINDOW_MS = 60 * 60_000

export interface ChangeLine {
  /** The newest folded event's id: stable while the line grows. */
  id: string
  /** The newest edit in the line. */
  at: number
  kind: 'doc.changed' | 'file.created' | 'file.deleted' | 'file.moved'
  actor: Actor
  path: string
  room?: string
  /** `file.moved`: where it was. */
  from?: string
  added?: number
  removed?: number
  /** Events folded into the line (each may itself be a fold). */
  count: number
}

export interface ChangeDay {
  /** Local midnight of the day. */
  day: number
  lines: ChangeLine[]
}

export interface ChangeFilter {
  /** One room only. */
  room?: string
  /** One person only: an actor's name (a peer's, or the relay host for "via"). */
  person?: string
  time?: LogTime
}

/** What a change was made by, as the filter row names it. */
export function actorKey(a: Actor): string {
  return a.name ?? a.kind
}

/**
 * The changes someone else made, oldest dropped by the filter: `me` never
 * appears (our own keystrokes are not logged, and an echo is not a change).
 */
export function changeEvents(events: readonly AppEvent[], f: ChangeFilter = {}, now = 0): AppEvent[] {
  const floor = timeFloor(f.time ?? 'all', now)
  return events.filter(
    (e) =>
      CHANGE_KINDS.has(e.kind) &&
      e.actor.kind !== 'me' &&
      e.scope.path !== undefined &&
      e.at >= floor &&
      (f.room === undefined || e.scope.room === f.room) &&
      (f.person === undefined || actorKey(e.actor) === f.person)
  )
}

const sameActor = (a: Actor, b: Actor): boolean => a.kind === b.kind && a.name === b.name

/**
 * Fold and group. A `doc.changed` joins the line above it (newer) when it is
 * the same note, the same actor, the same day and within `CHANGE_FOLD_MS` of
 * that line's oldest edit; its +/− add up. File events stay one line each —
 * a create, a delete and a move are each worth reading.
 */
export function foldChanges(
  events: readonly AppEvent[],
  f: ChangeFilter = {},
  now = 0,
  windowMs = CHANGE_FOLD_MS
): ChangeDay[] {
  const sorted = changeEvents(events, f, now).sort((a, b) => b.at - a.at)
  const days: ChangeDay[] = []
  /** Per open line: the oldest `at` folded in, so the window is measured from the line's span. */
  const oldest = new Map<ChangeLine, number>()
  for (const e of sorted) {
    const day = localDay(e.at)
    let bucket = days.at(-1)
    if (!bucket || bucket.day !== day) {
      bucket = { day, lines: [] }
      days.push(bucket)
    }
    const path = e.scope.path!
    if (e.kind === 'doc.changed') {
      const p = e.payload as { added?: number; removed?: number }
      const into = bucket.lines.find(
        (l) =>
          l.kind === 'doc.changed' &&
          l.path === path &&
          sameActor(l.actor, e.actor) &&
          (oldest.get(l) ?? l.at) - e.at <= windowMs
      )
      if (into) {
        if (p.added !== undefined) into.added = (into.added ?? 0) + p.added
        if (p.removed !== undefined) into.removed = (into.removed ?? 0) + p.removed
        into.count += e.count
        oldest.set(into, e.at)
        continue
      }
      const line: ChangeLine = {
        id: e.id,
        at: e.at,
        kind: 'doc.changed',
        actor: e.actor,
        path,
        ...(e.scope.room !== undefined ? { room: e.scope.room } : {}),
        ...(p.added !== undefined ? { added: p.added } : {}),
        ...(p.removed !== undefined ? { removed: p.removed } : {}),
        count: e.count,
      }
      bucket.lines.push(line)
      oldest.set(line, e.at)
      continue
    }
    bucket.lines.push({
      id: e.id,
      at: e.at,
      kind: e.kind as ChangeLine['kind'],
      actor: e.actor,
      path,
      ...(e.scope.room !== undefined ? { room: e.scope.room } : {}),
      ...(e.kind === 'file.moved' ? { from: (e.payload as { from: string }).from } : {}),
      count: e.count,
    })
  }
  return days
}

/** The people (and "via" relays, and disk) the filter row can pick, by first appearance. */
export function changeActors(events: readonly AppEvent[]): Actor[] {
  const seen = new Map<string, Actor>()
  for (const e of changeEvents(events)) if (!seen.has(actorKey(e.actor))) seen.set(actorKey(e.actor), e.actor)
  return [...seen.values()]
}

/**
 * The tree's change ticks: notes someone else changed within `TICK_WINDOW_MS`
 * of `now`, plus each mount root holding one (so a folded shared folder
 * still says something moved inside it).
 */
export function changeTicks(
  events: readonly AppEvent[],
  now: number,
  mountRoots: readonly string[] = [],
  windowMs = TICK_WINDOW_MS
): Set<string> {
  const ticks = new Set<string>()
  for (const e of changeEvents(events)) {
    if (e.kind === 'file.deleted' || now - e.at > windowMs || e.at > now + windowMs) continue
    const path = e.scope.path!
    ticks.add(path)
    for (const root of mountRoots) if (root !== '' && path.startsWith(`${root}/`)) ticks.add(root)
  }
  return ticks
}

/** How many notes the drawer lists; the rest are the Log view's. */
export const DRAWER_GROUPS = 20

/** How many errors and warnings the drawer lists. */
export const DRAWER_PROBLEMS = 20

/** Changes older than this are the Log's, not the drawer's. */
export const DRAWER_WINDOW_MS = 24 * 60 * 60_000

/** One note's changes by others, as the drawer lists them (foundations-plan P6). */
export interface DrawerGroup {
  /** The note's path: the group's key and its jump. */
  path: string
  /** Who changed it, one per `actorKey`, newest first. */
  actors: Actor[]
  /** Changes folded into the group (each event's own `count` summed). */
  count: number
  /** The newest change. */
  at: number
}

export interface DrawerModel {
  /** Errors and warnings, newest first, capped. */
  problems: AppEvent[]
  /** Changes by others, one group per note, newest first, capped. */
  groups: DrawerGroup[]
  errors: number
  warnings: number
  /** Changes by others in the window, summed over every group (capped or not). */
  changes: number
  /** The Log rows behind all of it: zero → the drawer says it is empty. */
  rows: number
  /** The Log filter that shows those rows (`LogView`'s tab argument). */
  logArg: 'problems' | 'changes' | undefined
}

/**
 * The drawer's contents: errors and warnings first, then the changes others
 * made in the last day, grouped PER NOTE — "Cynthia and Sam · Raft · 3
 * changes · 2 min ago" — newest first. Pure over the log and `now`.
 */
export function groupForDrawer(
  events: readonly AppEvent[],
  now: number,
  opts: { groups?: number; problems?: number; windowMs?: number } = {}
): DrawerModel {
  const floor = now - (opts.windowMs ?? DRAWER_WINDOW_MS)
  const problems = events.filter((e) => e.level === 'error' || e.level === 'warn').sort((a, b) => b.at - a.at)
  const changed = changeEvents(events)
    .filter((e) => e.at >= floor)
    .sort((a, b) => b.at - a.at)
  const byPath = new Map<string, DrawerGroup>()
  let changes = 0
  for (const e of changed) {
    const path = e.scope.path!
    changes += e.count
    let group = byPath.get(path)
    if (!group) {
      group = { path, actors: [], count: 0, at: e.at }
      byPath.set(path, group)
    }
    group.count += e.count
    if (!group.actors.some((a) => actorKey(a) === actorKey(e.actor))) group.actors.push(e.actor)
  }
  const errors = problems.filter((e) => e.level === 'error').length
  const rows = problems.length + changed.length
  return {
    problems: problems.slice(0, opts.problems ?? DRAWER_PROBLEMS),
    groups: [...byPath.values()].slice(0, opts.groups ?? DRAWER_GROUPS),
    errors,
    warnings: problems.length - errors,
    changes,
    rows,
    logArg: problems.length && changed.length ? undefined : problems.length ? 'problems' : changed.length ? 'changes' : undefined,
  }
}
