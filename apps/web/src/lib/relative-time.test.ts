import { getLL } from '@ohhi/i18n'
import { get } from 'svelte/store'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clockTick, dayWord, localDay, relativeTime, shiftDays, TICK_MS } from './relative-time.js'

const S = 1_000
const M = 60 * S
const H = 60 * M
const D = 24 * H

describe('relativeTime', () => {
  const t = getLL().web.relative_time
  const now = 10 * D

  it('words the gap in the largest whole unit', () => {
    expect(relativeTime(now, now)).toBe(t.now())
    expect(relativeTime(now - 9 * S, now)).toBe(t.now())
    expect(relativeTime(now - 42 * S, now)).toBe(t.seconds({ count: 42 }))
    expect(relativeTime(now - 3 * M - 59 * S, now)).toBe(t.minutes({ count: 3 }))
    expect(relativeTime(now - 2 * H, now)).toBe(t.hours({ count: 2 }))
    expect(relativeTime(now - 1 * D, now)).toBe(t.days({ count: 1 }))
    expect(relativeTime(now - 3 * D, now)).toBe('3 days ago')
  })

  it('never words a future time as one', () => {
    expect(relativeTime(now + 5 * M, now)).toBe(t.now())
  })
})

describe('clockTick', () => {
  it('re-reads the injected clock on its own scheduler, and only while subscribed', () => {
    let time = 1_000
    const armed: { fn: () => void; ms: number }[] = []
    const clock = {
      now: () => time,
      schedule: (fn: () => void, ms: number) => {
        const entry = { fn, ms }
        armed.push(entry)
        return () => armed.splice(armed.indexOf(entry), 1)
      },
    }
    const tick = clockTick(clock)
    expect(armed).toHaveLength(0)
    const seen: number[] = []
    const stop = tick.subscribe((v) => seen.push(v))
    expect(armed.map((a) => a.ms)).toEqual([TICK_MS])
    time = 20_000
    armed.shift()!.fn()
    expect(get(tick)).toBe(20_000)
    expect(seen.at(-1)).toBe(20_000)
    stop()
    expect(armed).toHaveLength(0)
  })
})

describe('localDay / shiftDays (calendar days, DST-safe)', () => {
  it('local midnight of the same day, and yesterday by the calendar, not by 24 h', () => {
    const at = new Date(2026, 2, 29, 15, 30).getTime() // the EU spring-forward day
    expect(localDay(at)).toBe(new Date(2026, 2, 29).getTime())
    expect(localDay(shiftDays(at, -1))).toBe(new Date(2026, 2, 28).getTime())
    expect(new Date(shiftDays(at, -7)).getDate()).toBe(22)
    expect(new Date(shiftDays(at, -7)).getHours()).toBe(15)
  })
})

describe('dayWord across a daylight-saving change (Shared › Changes, the Log)', () => {
  // Pinned to a zone with DST, whatever the machine's: Node re-reads TZ on assignment.
  const was = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Europe/London'
  })
  afterAll(() => {
    if (was === undefined) delete process.env.TZ
    else process.env.TZ = was
  })

  it('the zone took: 29 March 2026 is a 23-hour day', () => {
    expect(new Date(2026, 2, 30).getTime() - new Date(2026, 2, 29).getTime()).toBe(23 * H)
  })

  it('has exactly one yesterday the morning after spring-forward, where today − 24 h lands on the day before', () => {
    const now = new Date(2026, 2, 30, 0, 30).getTime() // 00:30 on the Monday after the change
    const sunday = new Date(2026, 2, 29, 9).getTime()
    const saturday = new Date(2026, 2, 28, 23, 50).getTime()
    expect(dayWord(now, now)).toBe('today')
    expect(dayWord(sunday, now)).toBe('yesterday')
    expect(dayWord(saturday, now)).toBeNull()
    // The bug this replaces: a fixed 24 h from today's midnight is Saturday 23:00, not Sunday.
    expect(localDay(localDay(now) - D)).toBe(localDay(saturday))
  })

  it('and after fall-back, the 25-hour day is still yesterday', () => {
    const now = new Date(2026, 9, 26, 12).getTime() // the Monday after 25 October
    expect(dayWord(new Date(2026, 9, 25, 0, 30).getTime(), now)).toBe('yesterday')
    expect(dayWord(new Date(2026, 9, 25, 23, 30).getTime(), now)).toBe('yesterday')
    expect(dayWord(new Date(2026, 9, 24, 23, 59).getTime(), now)).toBeNull()
  })
})
