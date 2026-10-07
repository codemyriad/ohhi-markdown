import { describe, expect, it } from 'vitest'
import { getLL } from '@ohhi/i18n'
import { formatSize, formatStamp } from './history.js'

const at = (y: number, m: number, d: number, h: number, min: number): number =>
  new Date(y, m - 1, d, h, min).getTime()

describe('formatStamp', () => {
  const now = at(2026, 9, 10, 18, 0)

  it('is just the clock time for a version from today', () => {
    const stamp = formatStamp(at(2026, 9, 10, 14, 37), now)
    expect(stamp).toMatch(/\b14[:.]37\b|\b0?2[:.]37\b/) // 24h or 12h locale
    expect(stamp).not.toMatch(/\d{1,2} \w{3}/)
  })

  it('carries the day once the version is not from today', () => {
    // Same clock time, a day earlier: the date has to be part of the label or
    // two rows read identically.
    const yesterday = formatStamp(at(2026, 9, 9, 14, 37), now)
    expect(yesterday).not.toBe(formatStamp(at(2026, 9, 10, 14, 37), now))
    expect(yesterday).toMatch(/9|Sep/)
  })
})

describe('formatSize', () => {
  const t = getLL().web.history

  it('counts small versions in bytes, including an empty one', () => {
    expect(formatSize(0)).toBe(t.bytes({ count: 0 }))
    expect(formatSize(1)).toBe(t.bytes({ count: 1 }))
    expect(formatSize(1023)).toBe(t.bytes({ count: 1023 }))
  })

  it('switches to kB with one decimal, then drops it once it stops helping', () => {
    expect(formatSize(1024)).toBe(t.kilobytes({ size: '1.0' }))
    expect(formatSize(4096)).toBe(t.kilobytes({ size: '4.0' }))
    expect(formatSize(120 * 1024)).toBe(t.kilobytes({ size: '120' }))
  })
})
