import { describe, expect, it } from 'vitest'
import { slotsFrom, stripDrop, zoneBox, type StripSlot } from './pane-drag.js'

/** `[a] [chip Edible] [b] [c] [d]` — a group over tabs 1 and 2, 100 px each. */
function strip(folded = false): StripSlot[] {
  return [
    { kind: 'tab', index: 0, groupId: null, left: 0, right: 100 },
    { kind: 'chip', index: 1, endIndex: 3, groupId: 'g1', folded, left: 100, right: 180 },
    ...(folded
      ? []
      : ([
          { kind: 'tab', index: 1, groupId: 'g1', left: 180, right: 280 },
          { kind: 'tab', index: 2, groupId: 'g1', left: 280, right: 380 },
        ] as StripSlot[])),
    {
      kind: 'tab',
      index: 3,
      groupId: null,
      left: folded ? 180 : 380,
      right: folded ? 280 : 480,
    },
  ]
}

/** `[chip Solo] [a]` at the strip's end — the one-tab group P1.1 is about. */
function soloAtEnd(): StripSlot[] {
  return [
    { kind: 'chip', index: 0, endIndex: 1, groupId: 'g9', folded: false, left: 0, right: 80 },
    { kind: 'tab', index: 0, groupId: 'g9', left: 80, right: 180 },
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

  it('joins from the right too: the trailing half of the run is the tail (P1.1)', () => {
    // Past the middle of the group's LAST tab — the mirror of the chip's
    // trailing half. This is the drop that used to be impossible.
    expect(stripDrop(strip(), 340, 4, 0)).toEqual({ at: 3, indicatorX: 380, groupId: 'g1' })
    // Past its trailing edge, on the tab that follows: outside, as before.
    expect(stripDrop(strip(), 400, 4, 0)).toEqual({ at: 3, indicatorX: 380 })
    // The group's FIRST tab is not its last, so its trailing half still means
    // "between the two", which `groupAtIndex` reads as inside anyway.
    expect(stripDrop(strip(), 260, 4, 0)).toEqual({ at: 2, indicatorX: 280 })
  })

  it('joins a one-tab group from the right, and appends outside past the strip', () => {
    // A one-tab group has no "between two of its tabs" to aim at; its single
    // tab is both the first and the last of the run.
    expect(stripDrop(soloAtEnd(), 150, 1, 0)).toEqual({ at: 1, indicatorX: 180, groupId: 'g9' })
    // Before that tab's middle is the head of the group (the chip's rule).
    expect(stripDrop(soloAtEnd(), 60, 1, 0)).toEqual({ at: 0, indicatorX: 80, groupId: 'g9' })
    // Past the last slot there is no slot to be inside of: append, ungrouped.
    expect(stripDrop(soloAtEnd(), 400, 1, 0)).toEqual({ at: 1, indicatorX: 180 })
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
          // A tab inside that group: the strip stamps its id, which is what
          // makes the tail rule above possible.
          el({ slotIndex: '2', slotKind: 'tab', slotGroup: 'g1' }),
          el({ slotIndex: '3', slotKind: 'tab' }),
        ],
        boxOf
      )
    ).toEqual([
      { kind: 'tab', index: 0, groupId: null, left: 0, right: 100 },
      { kind: 'chip', index: 1, endIndex: 3, groupId: 'g1', folded: true, left: 100, right: 200 },
      { kind: 'tab', index: 2, groupId: 'g1', left: 200, right: 300 },
      { kind: 'tab', index: 3, groupId: null, left: 300, right: 400 },
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
