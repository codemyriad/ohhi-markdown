/**
 * Roving focus for a `role=toolbar` (the WAI-ARIA toolbar pattern): one tab
 * stop, arrows move along the bar, Home and End jump to its ends. A Svelte
 * action — `use:roving` on the toolbar's root. Shared by the header toolbar
 * and the format bar, so the two bars behave as one pattern.
 */

/** The bar's own controls: not a menu's rows, a tooltip, or anything hidden or disabled. */
function controls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, a[href], [tabindex]')].filter(
    (el) =>
      !el.closest('[role="menu"], [role="tooltip"], [role="dialog"]') &&
      !(el as HTMLButtonElement).disabled &&
      el.getClientRects().length > 0
  )
}

export function roving(root: HTMLElement): { destroy(): void } {
  let current: HTMLElement | null = null
  const sync = (): void => {
    const list = controls(root)
    if (!current || !list.includes(current)) current = list[0] ?? null
    for (const el of list) {
      const want = el === current ? '0' : '-1'
      if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want)
    }
  }
  const onFocusIn = (e: FocusEvent): void => {
    const el = e.target as HTMLElement
    if (controls(root).includes(el)) {
      current = el
      sync()
    }
  }
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const list = controls(root)
    const at = list.indexOf(e.target as HTMLElement)
    if (at < 0 || list.length === 0) return
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? list.length - 1
          : (at + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length
    e.preventDefault()
    current = list[next]!
    sync()
    current.focus()
  }
  // A control appears, disappears or is re-enabled (a note opens, a menu
  // trigger resets its own tabindex), or the width folds a group.
  const observer = new MutationObserver(sync)
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex', 'disabled'] })
  const resize = new ResizeObserver(sync)
  resize.observe(root)
  root.addEventListener('focusin', onFocusIn)
  root.addEventListener('keydown', onKeyDown)
  sync()
  return {
    destroy() {
      observer.disconnect()
      resize.disconnect()
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('keydown', onKeyDown)
    },
  }
}
