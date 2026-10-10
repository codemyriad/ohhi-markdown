/**
 * The Log view's pure half (quiet-shell F12, spike S22 Stage 4a): which
 * events a filter keeps, what an error row suggests doing next, and the
 * plain-text report *Copy as text* produces. The view (`LogView.svelte`) and
 * the drawer (`readouts/Drawer.svelte`) render over this; neither holds a
 * rule of its own.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import type { AppEvent, EventKind, EventLevel } from '@ohhi/workspace'
import { describeEvent } from './event-text.js'
import { localDay, shiftDays } from './relative-time.js'

export const LOG_LEVELS: readonly EventLevel[] = ['error', 'warn', 'info']

/**
 * What the scope picker can say. `vault` is everything NOT attributable to a
 * shared folder (the vault's own notes, and the app's own complaints);
 * `mount` is one shared folder — its room, its root, or a path under it.
 */
export type LogScope =
  | { kind: 'all' }
  | { kind: 'vault' }
  | { kind: 'mount'; path: string; room: string }
  | { kind: 'note'; path: string }

export type LogTime = 'today' | 'week' | 'all'

export interface LogFilter {
  levels: readonly EventLevel[]
  scope: LogScope
  time: LogTime
  /** Only these kinds (the Shared view's *Show all*: the change kinds); absent or null → every kind. */
  kinds?: readonly EventKind[] | null
  /**
   * Only `notice` events with one of these codes (the *Customise* chip:
   * `CUSTOMISE_CODES`); absent or null → every event.
   */
  codes?: readonly string[] | null
}

/**
 * The notices about the app's own files — layouts, keymaps, templates
 * (settings-shaping ST6): what the Log's *Customise* chip keeps. A reload of
 * a file in use, a file that can't be used, the keymap migration, a template
 * that could not insert.
 */
export const CUSTOMISE_CODES: readonly string[] = [
  'resource_reloaded',
  'layout_invalid',
  'keymap_invalid',
  'keymap_migrated',
  'keymap_migrate_failed',
  'template_failed',
]

function codeMatches(e: AppEvent, codes: readonly string[] | null): boolean {
  if (codes === null) return true
  return e.kind === 'notice' && codes.includes((e as AppEvent<'notice'>).payload.code)
}

/** A shared folder as the scope picker lists it (`ui.mounts`). */
export interface LogMount {
  path: string
  room: string
}

const under = (path: string, root: string): boolean => root === '' || path === root || path.startsWith(`${root}/`)

function inMount(e: AppEvent, m: LogMount): boolean {
  if (e.scope.room !== undefined) return e.scope.room === m.room
  if (e.scope.mount !== undefined) return e.scope.mount === m.path
  return e.scope.path !== undefined && under(e.scope.path, m.path)
}

export function scopeMatches(e: AppEvent, scope: LogScope, mounts: readonly LogMount[]): boolean {
  switch (scope.kind) {
    case 'all':
      return true
    case 'vault':
      return !mounts.some((m) => m.path !== '' && inMount(e, m))
    case 'mount':
      return inMount(e, scope)
    case 'note':
      return e.scope.path === scope.path
  }
}

/** The earliest time a range keeps (local midnight for today; seven calendar days back for the week). */
export function timeFloor(time: LogTime, now: number): number {
  if (time === 'all') return -Infinity
  if (time === 'week') return shiftDays(now, -7)
  return localDay(now)
}

/**
 * The events a filter keeps, in the order given (newest first from
 * `ui.events`) — the ONE log filter: levels, kinds, codes, scope and time. The Log
 * view filters through it; anything else that narrows the log by those
 * axes should too.
 */
export function filterLog(
  events: readonly AppEvent[],
  f: LogFilter,
  mounts: readonly LogMount[],
  now: number
): AppEvent[] {
  const floor = timeFloor(f.time, now)
  const kinds = f.kinds ?? null
  const codes = f.codes ?? null
  return events.filter(
    (e) =>
      f.levels.includes(e.level) &&
      (kinds === null || kinds.includes(e.kind)) &&
      codeMatches(e, codes) &&
      e.at >= floor &&
      scopeMatches(e, f.scope, mounts)
  )
}

/**
 * What to do about an error (or a warning), when the app knows: an error row
 * "carries what failed and what to do" (F12). Null when there is nothing
 * better to say than the text itself; never for info.
 */
export function eventHint(e: AppEvent, LL: TranslationFunctions = getLL()): string | null {
  if (e.level === 'info') return null
  if (e.kind === 'relay.state' && (e as AppEvent<'relay.state'>).payload.to === 'refused') {
    return LL.web.log.hints.relay_refused()
  }
  if (e.kind === 'notice' && (e as AppEvent<'notice'>).payload.code === 'no_token') return LL.web.log.hints.no_token()
  return null
}

/** Where an event happened, as the row and the report print it. */
export function eventWhere(e: AppEvent, LL: TranslationFunctions = getLL()): string | null {
  if (e.scope.path) return e.scope.path
  if (e.scope.mount) return e.scope.mount
  if (e.scope.room) return LL.web.log.room({ room: e.scope.room })
  return null
}

const iso = (at: number): string => new Date(at).toISOString()

/**
 * The plain-text bug report: a header, then one line per event — ISO time,
 * level, where, the words, ×N when folded — and an indented hint under an
 * error that has one. Absolute times, so it reads the same tomorrow.
 */
export function logReport(events: readonly AppEvent[], now: number, LL: TranslationFunctions = getLL()): string {
  const t = LL.web.log
  const lines: string[] = [t.report.header({ count: events.length, time: iso(now) })]
  for (const e of events) {
    const where = eventWhere(e, LL)
    const parts: string[] = [iso(e.at), t.level_name[e.level](), ...(where ? [where] : []), describeEvent(e, LL)]
    if (e.count > 1) parts.push(t.repeated({ count: e.count }))
    lines.push(parts.join('  '))
    const hint = eventHint(e, LL)
    if (hint) lines.push(`    ${t.report.hint({ hint })}`)
  }
  return lines.join('\n')
}
