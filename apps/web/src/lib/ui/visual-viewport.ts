/**
 * The visual viewport, as CSS variables for what floats over the editor.
 *
 * The shell fills the layout viewport. On a phone the part a person can see
 * is the visual viewport, and the two differ: Firefox's toolbar slides in
 * and out over the page and iOS Safari's keyboard and address bar cover its
 * bottom and top, so a bar placed against the layout viewport's edge sits
 * too high, or scrolls under the address bar. `trackVisualViewport` follows
 * `window.visualViewport` (resize and scroll) and writes, on the element it
 * is given (the document root):
 *
 * - `--vv-top`: how far the visible area starts below the layout viewport's
 *   top (px, never negative) — the format bar at the top moves down by it;
 * - `--vv-bottom`: how far the visible area ends above the layout viewport's
 *   bottom (px; negative when the visible area reaches past it) — the bars
 *   along the bottom move up by it;
 * - `--vv-height`: the visible height (px).
 *
 * A browser without `visualViewport` gets nothing written, and every reader
 * falls back to `0px`: the bars sit where they always did.
 */

/** What the insets are computed from: `window.visualViewport`'s two numbers. */
export interface ViewportBox {
  height: number
  offsetTop: number
}

/** `window.visualViewport`, as far as the tracker uses it. */
export interface VisualViewportLike extends ViewportBox {
  addEventListener(type: 'resize' | 'scroll', listener: () => void): void
  removeEventListener(type: 'resize' | 'scroll', listener: () => void): void
}

export interface ViewportInsets {
  top: number
  bottom: number
  /** The visible height; null with no visual viewport. */
  height: number | null
}

export const NO_INSETS: ViewportInsets = { top: 0, bottom: 0, height: null }

/** The insets of the visible area within a layout viewport `layoutHeight` tall. Pure. */
export function viewportInsets(vv: ViewportBox | null | undefined, layoutHeight: number): ViewportInsets {
  if (!vv || !(vv.height > 0)) return NO_INSETS
  const top = Math.max(0, Math.round(vv.offsetTop))
  const bottom = Math.round(layoutHeight - vv.offsetTop - vv.height)
  return { top, bottom: Object.is(bottom, -0) ? 0 : bottom, height: Math.round(vv.height) }
}

let current: ViewportInsets = NO_INSETS

/**
 * The insets last written. For code that measures a floating bar's rect and
 * needs it in layout coordinates (the dock standing on the format bar): the
 * rect already carries the lift, which the CSS variable will add again.
 */
export function currentInsets(): ViewportInsets {
  return current
}

const VARS = ['--vv-top', '--vv-bottom', '--vv-height'] as const

/**
 * Follow the visual viewport until the returned function is called. `layout`
 * reads the layout viewport's height (the document root's `clientHeight`).
 */
export function trackVisualViewport(
  target: HTMLElement,
  vv: VisualViewportLike | null | undefined = globalThis.visualViewport,
  layout: () => number = () => document.documentElement.clientHeight
): () => void {
  if (!vv) return () => {}
  const apply = (): void => {
    const next = viewportInsets(vv, layout())
    if (next.top === current.top && next.bottom === current.bottom && next.height === current.height) return
    current = next
    target.style.setProperty('--vv-top', `${next.top}px`)
    target.style.setProperty('--vv-bottom', `${next.bottom}px`)
    if (next.height !== null) target.style.setProperty('--vv-height', `${next.height}px`)
  }
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  apply()
  return () => {
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    for (const name of VARS) target.style.removeProperty(name)
    current = NO_INSETS
  }
}
