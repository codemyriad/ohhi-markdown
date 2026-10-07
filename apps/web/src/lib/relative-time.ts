/**
 * "3 min ago" for the Log view and the drawer (quiet-shell F12/F13). Pure:
 * the caller hands in `now` — from the injected clock, re-read on a tick
 * (`clockTick`) so the words age while the view is open.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import { readable, type Readable } from 'svelte/store'
import type { Clock } from '@ohhi/vault'

const S = 1_000
const M = 60 * S
const H = 60 * M
const D = 24 * H

export function relativeTime(at: number, now: number, LL: TranslationFunctions = getLL()): string {
  const t = LL.web.relative_time
  const ago = now - at
  // A clock that stepped back, or the same tick: never "in 2s".
  if (ago < 10 * S) return t.now()
  if (ago < M) return t.seconds({ count: Math.floor(ago / S) })
  if (ago < H) return t.minutes({ count: Math.floor(ago / M) })
  if (ago < D) return t.hours({ count: Math.floor(ago / H) })
  return t.days({ count: Math.floor(ago / D) })
}

/** Local midnight of the day `at` falls on (the calendar's day, not a 24 h bucket). */
export function localDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * `at` moved by `days` calendar days at the same wall-clock time. DST-safe:
 * a day is not always 86 400 000 ms, so "yesterday" is
 * `localDay(shiftDays(now, -1))`, never `localDay(now) - 86_400_000`.
 */
export function shiftDays(at: number, days: number): number {
  const d = new Date(at)
  d.setDate(d.getDate() + days)
  return d.getTime()
}

/**
 * Which calendar day `day` (any time on it) is from where `now` stands:
 * `'today'`, `'yesterday'`, or null for an older one the caller dates. By
 * the calendar (`localDay(shiftDays(now, -1))`), so the 23- and 25-hour
 * days of a daylight-saving change still have exactly one yesterday.
 */
export function dayWord(day: number, now: number): 'today' | 'yesterday' | null {
  const d = localDay(day)
  if (d === localDay(now)) return 'today'
  if (d === localDay(shiftDays(now, -1))) return 'yesterday'
  return null
}

/** How often the relative times are re-worded while something shows them. */
export const TICK_MS = 15_000

/**
 * The clock's `now()`, re-read every `ms` on the clock's own scheduler (golden
 * rule 5) while anything subscribes; nothing is armed when nobody does.
 */
export function clockTick(clock: Clock, ms: number = TICK_MS): Readable<number> {
  return readable(clock.now(), (set) => {
    let cancel: () => void = () => {}
    const arm = (): void => {
      cancel = clock.schedule(() => {
        set(clock.now())
        arm()
      }, ms)
    }
    set(clock.now())
    arm()
    return () => cancel()
  })
}
