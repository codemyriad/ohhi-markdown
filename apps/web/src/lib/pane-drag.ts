/**
 * Where a dragged tab lands on a strip — the geometry half of B10, kept pure
 * so the hit test is unit-tested rather than eyeballed.
 *
 * The component measures the strip once when a drag starts (a strip does not
 * reflow while you hold a tab over it) and hands the boxes here; `panes.ts`
 * owns the tree half (`zoneAt` for a pane body, `groupAtIndex` for "which
 * group did that land in").
 *
 * The rule the mock established and this reproduces: a drop lands INSIDE a
 * group only when it is unambiguously inside it — between two of its tabs,
 * immediately after its chip, or anywhere on a folded chip. Landing on a
 * group's leading edge leaves you outside it, which is what makes a group's
 * first tab draggable out at all.
 */

/** One item as drawn in a strip, in draw order. */
export type StripSlot =
  | {
      kind: 'tab'
      /** This tab's index in `pane.tabs`. */
      index: number
      left: number
      right: number
    }
  | {
      kind: 'chip'
      /** Index of the group's FIRST tab. */
      index: number
      /** Index one past the group's LAST tab. */
      endIndex: number
      groupId: string
      folded: boolean
      left: number
      right: number
    }

export interface StripDrop {
  /** Insertion index into `pane.tabs`, as the strip is drawn right now. */
  at: number
  /** Where to draw the 2 px insertion indicator, in client pixels. */
  indicatorX: number
  /**
   * The group the drop joins: an id forces that group, `null` forces
   * ungrouped, `undefined` means "whatever `groupAtIndex` says" — the
   * ordinary case of landing between two tabs.
   */
  groupId?: string | null
}

/** The highlight a drop zone paints, in client pixels. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The box a pane's drop zone highlights: the half the payload would land in,
 * or — for the centre, which joins the strip rather than splitting — the pane
 * inset a little, so "here, as it is" reads differently from "split here".
 *
 * `panes.ts`'s `zoneAt` decides WHICH zone the pointer is in; this is what
 * that zone looks like, kept beside the strip hit test because both are the
 * drag's geometry and neither is the tree's business.
 */
export function zoneBox(r: Box, zone: 'center' | 'left' | 'right' | 'up' | 'down'): Box {
  const { left, top, width, height } = r
  if (zone === 'center') {
    return { left: left + 10, top: top + 10, width: width - 20, height: height - 20 }
  }
  if (zone === 'left') return { left, top, width: width / 2, height }
  if (zone === 'right') return { left: left + width / 2, top, width: width / 2, height }
  if (zone === 'up') return { left, top, width, height: height / 2 }
  return { left, top: top + height / 2, width, height: height / 2 }
}

/**
 * The insertion point for a pointer at `x` over a strip of `slots`.
 *
 * `tabCount` is the pane's tab count: a pointer past the last item appends,
 * and an empty strip takes the first tab at `stripLeft`.
 */
export function stripDrop(
  slots: readonly StripSlot[],
  x: number,
  tabCount: number,
  stripLeft: number
): StripDrop {
  for (const slot of slots) {
    // A folded group is one box; anywhere on it means "put it in there".
    if (slot.kind === 'chip' && slot.folded && x >= slot.left && x <= slot.right) {
      return { at: slot.endIndex, indicatorX: slot.right, groupId: slot.groupId }
    }
    if (x < (slot.left + slot.right) / 2) {
      return slot.kind === 'tab'
        ? { at: slot.index, indicatorX: slot.left }
        : { at: slot.index, indicatorX: slot.left, groupId: null }
    }
    // Between an open chip's middle and its trailing edge = the slot between
    // the chip and its first tab, i.e. the head of the group. Past the edge
    // the next item decides.
    if (slot.kind === 'chip' && !slot.folded && x <= slot.right) {
      return { at: slot.index, indicatorX: slot.right, groupId: slot.groupId }
    }
  }
  const last = slots[slots.length - 1]
  return { at: tabCount, indicatorX: last ? last.right : stripLeft }
}

/** Measured boxes for a pane's strip items, read off the DOM in draw order. */
export function slotsFrom(
  elements: Iterable<HTMLElement>,
  boxOf: (el: HTMLElement) => { left: number; right: number }
): StripSlot[] {
  const out: StripSlot[] = []
  for (const el of elements) {
    const { left, right } = boxOf(el)
    const index = Number(el.dataset.slotIndex)
    if (!Number.isFinite(index)) continue
    if (el.dataset.slotKind === 'chip') {
      out.push({
        kind: 'chip',
        index,
        endIndex: Number(el.dataset.slotEnd),
        groupId: el.dataset.slotGroup ?? '',
        folded: el.dataset.slotFolded === 'true',
        left,
        right,
      })
    } else {
      out.push({ kind: 'tab', index, left, right })
    }
  }
  return out
}
