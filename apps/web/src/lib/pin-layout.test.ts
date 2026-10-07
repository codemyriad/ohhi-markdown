/**
 * Pins are device overrides laid over the resolved layout (Round 2, P7):
 * one side at a time, never a file, and unpinning returns the side to the
 * layout's own setting.
 */
import { describe, expect, it } from 'vitest'
import { EXAMPLES, PRESETS } from './layout-spec.js'
import { applyPins, hasPins, normalizePins, withPin } from './pin-layout.js'

const base = PRESETS.default

describe('pins (Round 2, P7)', () => {
  it('pinning the rail makes only the rail a column — the navigator keeps the layout’s region', () => {
    const pinned = applyPins(base, withPin({}, 'rail', true))
    expect(pinned.regions.rail).toBe('column')
    expect(pinned.regions.navigator).toBe(base.regions.navigator)
    expect({ ...pinned.regions, rail: base.regions.rail }).toEqual(base.regions)
  })

  it('pinning the navigator makes only the navigator a column', () => {
    const pinned = applyPins(base, withPin({}, 'navigator', true))
    expect(pinned.regions.navigator).toBe('column')
    expect(pinned.regions.rail).toBe(base.regions.rail)
  })

  it('unpinning one side leaves the other pinned, and the unpinned side follows the layout again', () => {
    const both = withPin(withPin({}, 'navigator', true), 'rail', true)
    const pins = withPin(both, 'navigator', false)
    expect(pins).toEqual({ rail: 'column' })
    expect(applyPins(base, pins).regions.navigator).toBe(base.regions.navigator)
    expect(withPin(pins, 'rail', false)).toEqual({})
  })

  it('changes nothing — the same spec — when no side is pinned or the layout already has the column', () => {
    expect(applyPins(base, {})).toBe(base)
    expect(applyPins(EXAMPLES.dense, { navigator: 'column', rail: 'column' })).toBe(EXAMPLES.dense)
    expect(hasPins({})).toBe(false)
    expect(hasPins({ rail: 'column' })).toBe(true)
  })

  it('reads config tolerantly', () => {
    expect(normalizePins(null)).toEqual({})
    expect(normalizePins('column')).toEqual({})
    expect(normalizePins({ navigator: 'column', rail: 'drawer', other: 'column' })).toEqual({ navigator: 'column' })
  })
})
