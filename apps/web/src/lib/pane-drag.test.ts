import { describe, expect, it } from 'vitest'
import { slotsFrom, stripDrop, zoneBox, type StripSlot } from './pane-drag.js'

/** `[a] [chip Edible] [b] [c] [d]` — a group over tabs 1 and 2, 100 px each. */
function strip(folded = false): StripSlot[] {
  return [
    { kind: 'tab', index: 0, left: 0, right: 100 },
    { kind: 'chip', index: 1, endIndex: 3, groupId: 'g1', folded, left: 100, right: 180 },
    ...(folded
      ? []
      : ([
          { kind: 'tab', index: 1, left: 180, right: 280 },
          { kind: 'tab', index: 2, left: 280, right: 380 },
        ] as StripSlot[])),
    { kind: 'tab', index: 3, left: folded ? 180 : 380, right: folded ? 280 : 480 },
  ]
}

describe('stripDrop', () => {
  it('inserts before or after a tab at its midpoint', () => {
    expect(stripDrop(strip(), 10, 4, 0)).toEqual({ at: 0, indicatorX: 0 })
    // Past a's middle: the next slot decides, and that is the chip's leading edge.
    expect(stripDrop(strip(), 60, 4, 0)).toEqual({ at: 1, indicatorX: 100, groupId: null })
  })

  it('joins the group between two of its tabs, and leaves it at the leading edge', () => {
    // Between the group's two tabs — the one unambiguous "inside".
    expect(stripDrop(strip(), 260, 4, 0)).toEqual({ at: 2, indicatorX: 280 })
    // Right after the chip = the head of the group.
    expect(stripDrop(strip(), 160, 4, 0)).toEqual({ at: 1, indicatorX: 180, groupId: 'g1' })
    // Right before the chip = outside it, explicitly.
    expect(stripDrop(strip(), 120, 4, 0)).toEqual({ at: 1, indicatorX: 100, groupId: null })
  })

  it('appends to a folded group from anywhere on its chip', () => {
    expect(stripDrop(strip(true), 140, 4, 0)).toEqual({ at: 3, indicatorX: 180, groupId: 'g1' })
    expect(stripDrop(strip(true), 101, 4, 0)).toEqual({ at: 3, indicatorX: 180, groupId: 'g1' })
  })

  it('appends past the last item, and takes the first tab of an empty strip', () => {
    expect(stripDrop(strip(), 900, 4, 0)).toEqual({ at: 4, indicatorX: 480 })
    expect(stripDrop([], 900, 0, 24)).toEqual({ at: 0, indicatorX: 24 })
  })
})

describe('zoneBox', () => {
  const pane = { left: 100, top: 50, width: 400, height: 200 }

  it('paints the half a payload would land in', () => {
    expect(zoneBox(pane, 'left')).toEqual({ left: 100, top: 50, width: 200, height: 200 })
    expect(zoneBox(pane, 'right')).toEqual({ left: 300, top: 50, width: 200, height: 200 })
    expect(zoneBox(pane, 'up')).toEqual({ left: 100, top: 50, width: 400, height: 100 })
    expect(zoneBox(pane, 'down')).toEqual({ left: 100, top: 150, width: 400, height: 100 })
  })

  it('insets the centre, because joining the strip is not splitting', () => {
    expect(zoneBox(pane, 'center')).toEqual({ left: 110, top: 60, width: 380, height: 180 })
  })
})

describe('slotsFrom', () => {
  /**
   * A stand-in for one of `TabStrip`'s slot elements. The live markup is
   * asserted against this contract in `components/TabStrip.test.ts`; these are
   * the payloads a strip mid-render can hand over.
   */
  const el = (data: Record<string, string>): HTMLElement =>
    ({ dataset: data }) as unknown as HTMLElement
  const boxOf = (node: HTMLElement): { left: number; right: number } => ({
    left: Number(node.dataset.slotIndex) * 100,
    right: Number(node.dataset.slotIndex) * 100 + 100,
  })

  it('reads a tab and a chip out of their data attributes', () => {
    expect(
      slotsFrom(
        [
          el({ slotIndex: '0', slotKind: 'tab' }),
          el({ slotIndex: '1', slotKind: 'chip', slotEnd: '3', slotGroup: 'g1', slotFolded: 'true' }),
          el({ slotIndex: '3', slotKind: 'tab' }),
        ],
        boxOf
      )
    ).toEqual([
      { kind: 'tab', index: 0, left: 0, right: 100 },
      { kind: 'chip', index: 1, endIndex: 3, groupId: 'g1', folded: true, left: 100, right: 200 },
      { kind: 'tab', index: 3, left: 300, right: 400 },
    ])
  })

  it('reads `folded` as the flag it is, not as truthiness', () => {
    const [chip] = slotsFrom(
      [el({ slotIndex: '0', slotKind: 'chip', slotEnd: '2', slotGroup: 'g', slotFolded: 'false' })],
      boxOf
    )
    expect(chip).toMatchObject({ folded: false })
  })

  it('skips an element with no usable index rather than inventing one at 0', () => {
    expect(
      slotsFrom([el({ slotKind: 'tab' }), el({ slotIndex: 'x', slotKind: 'tab' })], boxOf)
    ).toEqual([])
  })
})
