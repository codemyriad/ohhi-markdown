import { describe, expect, it } from 'vitest'
import { hints } from './mode.js'
import { CUE_VERBS, cueHints } from './mode-cue.js'

const title = (id: string): string => id

describe('cueHints — the Subtle corner line (E6)', () => {
  it('pane mode: the h j k l focus row and split right, in that order', () => {
    const rows = cueHints('pane', hints('pane', title))
    expect(rows.map((r) => [r.key, r.label])).toEqual([
      ['h j k l', 'workspace.focus'],
      ['r', 'workspace.split-right'],
    ])
  })

  it('every mode has at most two verbs, and each is a row the mode really has', () => {
    for (const mode of Object.keys(CUE_VERBS) as (keyof typeof CUE_VERBS)[]) {
      const rows = cueHints(mode, hints(mode, title))
      expect(rows.length).toBe(CUE_VERBS[mode].length)
      expect(rows.length).toBeLessThanOrEqual(2)
    }
  })

  it('a verb whose row is gone (refused by its guard) is skipped, not invented', () => {
    const rows = hints('group', title).filter((h) => !h.ids.includes('group.toggle'))
    expect(cueHints('group', rows).map((r) => r.label)).toEqual(['group.new'])
  })

  it('a family id never matches a lone command that merely shares its prefix', () => {
    const rows = cueHints('resize', hints('resize', title))
    expect(rows.map((r) => r.key)).toEqual(['h j k l', '='])
  })
})
