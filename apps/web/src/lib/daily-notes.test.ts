/**
 * Daily notes (W3). The oracle is Chris's own vault: `.obsidian/daily-notes.json`
 * is `{"format":"DD-M-Y","folder":"Daily"}` and `Daily/` holds `29-8-2026.md`,
 * `03-01-2025.md`, `05-10-2022.md` — so those exact names are what the format
 * and the parser are held to, alongside Obsidian's own defaults.
 */
import { describe, expect, it } from 'vitest'
import {
  DAILY_CONFIG_PATH,
  DAILY_DEFAULTS,
  dailyPath,
  dateOfPath,
  findDaily,
  formatDate,
  loadDailyConfig,
  neighbours,
  parseDate,
  today,
  unsupportedTokens,
  type DailyConfig,
} from './daily-notes.js'

const CHRIS: DailyConfig = { format: 'DD-M-Y', folder: 'Daily' }
const d = (y: number, m: number, day: number): Date => new Date(y, m - 1, day)

describe('formatDate', () => {
  it("writes Chris's DD-M-Y exactly as his vault has it", () => {
    expect(formatDate('DD-M-Y', d(2026, 8, 29))).toBe('29-8-2026')
    expect(formatDate('DD-M-Y', d(2026, 9, 2))).toBe('02-9-2026')
    expect(formatDate('DD-M-Y', d(2022, 10, 5))).toBe('05-10-2022')
  })

  it("writes Obsidian's default", () => {
    expect(formatDate(DAILY_DEFAULTS.format, d(2026, 9, 2))).toBe('2026-09-02')
  })

  it('covers the moment tokens the vault could carry', () => {
    const date = d(2026, 9, 2) // a Wednesday
    expect(formatDate('YYYY-MM-DD', date)).toBe('2026-09-02')
    expect(formatDate('YY.M.D', date)).toBe('26.9.2')
    expect(formatDate('MMMM D, YYYY', date)).toBe('September 2, 2026')
    expect(formatDate('ddd MMM DD', date)).toBe('Wed Sep 02')
    expect(formatDate('dddd', date)).toBe('Wednesday')
  })

  it('keeps text in [brackets] literal, and unknown letters as themselves', () => {
    expect(formatDate('[Day] YYYY', d(2026, 1, 1))).toBe('Day 2026')
    // 'q' is not a token we support: it prints itself rather than vanishing.
    expect(formatDate('YYYY-q', d(2026, 1, 1))).toBe('2026-q')
  })
})

describe('parseDate', () => {
  it('round-trips every format it can write', () => {
    const date = d(2026, 9, 2)
    for (const format of ['DD-M-Y', 'YYYY-MM-DD', 'YY.M.D', 'MMMM D, YYYY', 'ddd MMM DD YYYY']) {
      expect(parseDate(format, formatDate(format, date))?.getTime()).toBe(date.getTime())
    }
  })

  it("reads the real names in Chris's Daily folder", () => {
    expect(parseDate('DD-M-Y', '29-8-2026')?.getTime()).toBe(d(2026, 8, 29).getTime())
    expect(parseDate('DD-M-Y', '05-10-2022')?.getTime()).toBe(d(2022, 10, 5).getTime())
    // Zero-padded month under a single-M format: an older note, still a daily.
    expect(parseDate('DD-M-Y', '03-01-2025')?.getTime()).toBe(d(2025, 1, 3).getTime())
  })

  it('refuses what is not this format, and what is not a date', () => {
    expect(parseDate('DD-M-Y', 'Meeting notes')).toBeNull()
    expect(parseDate('DD-M-Y', '2026-08-29')).toBeNull()
    expect(parseDate('DD-M-Y', '29-8-2026-extra')).toBeNull()
    expect(parseDate('DD-M-Y', '32-8-2026')).toBeNull() // no 32nd
    expect(parseDate('DD-M-Y', '29-13-2026')).toBeNull() // no 13th month
  })

  it("applies moment's two-digit year pivot", () => {
    expect(parseDate('YY-MM-DD', '26-01-01')?.getFullYear()).toBe(2026)
    expect(parseDate('YY-MM-DD', '99-01-01')?.getFullYear()).toBe(1999)
  })
})

describe('dailyPath / dateOfPath', () => {
  it("puts today's note in the configured folder", () => {
    expect(dailyPath(CHRIS, d(2026, 9, 10))).toBe('Daily/10-9-2026.md')
    expect(dailyPath({ format: 'YYYY-MM-DD', folder: '' }, d(2026, 9, 10))).toBe('2026-09-10.md')
    expect(dailyPath({ format: 'DD-M-Y', folder: '/Daily/' }, d(2026, 9, 10))).toBe('Daily/10-9-2026.md')
  })

  it('recognises a daily note by its path, and only in its own folder', () => {
    expect(dateOfPath(CHRIS, 'Daily/29-8-2026.md')?.getTime()).toBe(d(2026, 8, 29).getTime())
    expect(dateOfPath(CHRIS, 'Daily/Archive/29-8-2026.md')).toBeNull()
    expect(dateOfPath(CHRIS, '29-8-2026.md')).toBeNull()
    expect(dateOfPath(CHRIS, 'Daily/Content Inbox.md')).toBeNull()
    expect(dateOfPath(CHRIS, null)).toBeNull()
  })
})

describe('neighbours', () => {
  const files = [
    'Daily/25-8-2026.md',
    'Daily/29-8-2026.md',
    'Daily/02-9-2026.md',
    'Daily/Content Inbox.md',
    'Projects/WIP.md',
  ]

  it('steps to the dailies that exist, in date order — not by filename', () => {
    // Lexically '02-9-2026' sorts first; by date it is the newest of the three.
    expect(neighbours(CHRIS, files, d(2026, 8, 29))).toEqual({
      prev: 'Daily/25-8-2026.md',
      next: 'Daily/02-9-2026.md',
    })
  })

  it('reports the end of the walk as null, so the command can grey out', () => {
    expect(neighbours(CHRIS, files, d(2026, 8, 25)).prev).toBeNull()
    expect(neighbours(CHRIS, files, d(2026, 9, 2)).next).toBeNull()
    expect(neighbours(CHRIS, [], d(2026, 9, 2))).toEqual({ prev: null, next: null })
  })

  it('walks from today even when today has no note yet', () => {
    expect(neighbours(CHRIS, files, d(2026, 9, 10))).toEqual({
      prev: 'Daily/02-9-2026.md',
      next: null,
    })
  })
})

describe('findDaily', () => {
  it("finds the note a padded old name gives the day — his Daily/03-01-2025.md", () => {
    // `DD-M-Y` WRITES '03-1-2025', so matching on the formatted string missed
    // this note and `Mod+\\` created a second daily for a day that had one.
    const files = ['Daily/03-01-2025.md', 'Daily/29-8-2026.md', 'Daily/Content Inbox.md']
    expect(dailyPath(CHRIS, d(2025, 1, 3))).toBe('Daily/03-1-2025.md') // not on disk
    expect(findDaily(CHRIS, files, d(2025, 1, 3))).toBe('Daily/03-01-2025.md')
    expect(findDaily(CHRIS, files, d(2026, 8, 29))).toBe('Daily/29-8-2026.md')
  })

  it('answers null when the day has no note, and is stable when it has two', () => {
    const files = ['Daily/3-1-2025.md', 'Daily/03-01-2025.md']
    expect(findDaily(CHRIS, files, d(2025, 1, 4))).toBeNull()
    // Both spellings ARE that day; the answer must not depend on listing order.
    expect(findDaily(CHRIS, files, d(2025, 1, 3))).toBe('Daily/03-01-2025.md')
    expect(findDaily(CHRIS, [...files].reverse(), d(2025, 1, 3))).toBe('Daily/03-01-2025.md')
  })

  it('is what neighbours breaks its own ties by, so the two agree', () => {
    const files = ['Daily/3-1-2025.md', 'Daily/03-01-2025.md', 'Daily/05-10-2022.md']
    expect(neighbours(CHRIS, files, d(2022, 10, 5)).next).toBe('Daily/03-01-2025.md')
    expect(neighbours(CHRIS, [...files].reverse(), d(2022, 10, 5)).next).toBe('Daily/03-01-2025.md')
  })
})

describe('unsupportedTokens', () => {
  it('is empty for everything the module actually formats', () => {
    for (const format of ['DD-M-Y', 'YYYY-MM-DD', 'YY.M.D', 'MMMM D, YYYY', 'ddd MMM DD']) {
      expect(unsupportedTokens(format), format).toEqual([])
    }
    // Bracketed text is literal by definition, letters and all.
    expect(unsupportedTokens('[Week of] YYYY-MM-DD')).toEqual([])
  })

  it('names the moment tokens that would silently print themselves', () => {
    // A vault on either of these disagrees with Obsidian about which file
    // today is, and the person is told rather than left to find out.
    expect(unsupportedTokens('gggg-[W]ww')).toEqual(['gggg', 'ww'])
    // `Do` is moment's D + ordinal suffix: the `D` is understood and prints
    // '3', the `o` is not and prints itself — so 'o' is the honest answer.
    expect(unsupportedTokens('MMMM Do, YYYY')).toEqual(['o'])
    expect(unsupportedTokens('YYYY-Q-DD')).toEqual(['Q'])
  })
})

describe('today', () => {
  it('is local midnight of the injected clock, never Date.now()', () => {
    const at = new Date(2026, 8, 10, 14, 37, 12).getTime()
    expect(today(() => at).getTime()).toBe(d(2026, 9, 10).getTime())
  })
})

describe('loadDailyConfig', () => {
  it("reads Obsidian's own file", async () => {
    const read = async (path: string): Promise<string | null> =>
      path === DAILY_CONFIG_PATH ? '{"format":"DD-M-Y","folder":"Daily"}' : null
    expect(await loadDailyConfig(read)).toEqual(CHRIS)
  })

  it("falls back to Obsidian's defaults for absent, empty, broken or partial config", async () => {
    expect(await loadDailyConfig(async () => null)).toEqual(DAILY_DEFAULTS)
    expect(await loadDailyConfig(async () => '')).toEqual(DAILY_DEFAULTS)
    expect(await loadDailyConfig(async () => 'not json')).toEqual(DAILY_DEFAULTS)
    expect(await loadDailyConfig(async () => '{"folder":"Journal"}')).toEqual({
      format: DAILY_DEFAULTS.format,
      folder: 'Journal',
    })
    expect(
      await loadDailyConfig(() => Promise.reject(new Error('no vault')))
    ).toEqual(DAILY_DEFAULTS)
  })
})
