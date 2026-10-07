export type Placement = 'top' | 'bottom' | 'left' | 'right'
export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

/** Which way a bar's tooltips, menus and popovers open: away from the edge the bar sits on. */
export type Side = 'top' | 'bottom'

/** A bar docked at `position` opens its overlays toward the other edge. */
export function sideAwayFrom(position: Side): Side {
  return position === 'bottom' ? 'top' : 'bottom'
}

/** A menu or popover opening toward `side`, aligned to its anchor's `align` edge. */
export function menuPlacement(side: Side, align: 'start' | 'end'): MenuPlacement {
  return `${side}-${align}`
}
