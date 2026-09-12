/** Focusable-by-Tab candidates, in DOM order, that are actually rendered. */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The first control a keyboard user would reach inside `root`, or null. Uses
 * `getClientRects` for the rendered check — the same signal focus-trap's
 * `tabbable` uses — so a display:none control is skipped in a browser, and
 * the jsdom stub in test-setup makes every control count.
 */
export function firstTabbable(root: HTMLElement | null | undefined): HTMLElement | null {
  if (!root) return null
  for (const el of root.querySelectorAll<HTMLElement>(TABBABLE)) {
    if (el.getClientRects().length > 0) return el
  }
  return null
}

/**
 * Whoever holds focus at this instant — read at MOUNT by every overlay in the
 * shell, so that closing gives focus back to the tree row, header button or
 * chip it came from rather than to `<body>`. An overlay's own anchor cannot
 * stand in: a `Popover`'s is `aria-hidden` and unfocusable on purpose.
 */
export function currentFocus(): HTMLElement | null {
  return typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
}
