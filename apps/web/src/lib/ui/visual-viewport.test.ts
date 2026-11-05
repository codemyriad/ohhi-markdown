/**
 * The visual-viewport insets the floating bars and the dock follow (Firefox's
 * sliding toolbar, iOS Safari's keyboard and address bar), driven by a fake
 * `visualViewport` — the browsers that move it are not in the e2e lanes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bodySafeBottom, currentInsets, NO_INSETS, trackVisualViewport, viewportInsets, type VisualViewportLike } from './visual-viewport.js'

function fakeViewport(height: number, offsetTop = 0) {
  const listeners = new Map<string, Set<() => void>>()
  const vv = {
    height,
    offsetTop,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  }
  const fire = (type: 'resize' | 'scroll') => listeners.get(type)?.forEach((fn) => fn())
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0)
  return { vv: vv as VisualViewportLike, set: (h: number, top = 0) => ((vv.height = h), (vv.offsetTop = top)), fire, count }
}

function fakeTarget() {
  const props = new Map<string, string>()
  const style = { setProperty: (k: string, v: string) => props.set(k, v), removeProperty: (k: string) => props.delete(k) }
  return { el: { style } as unknown as HTMLElement, props }
}

let stop: (() => void) | null = null
afterEach(() => {
  stop?.()
  stop = null
})

describe('viewportInsets', () => {
  it('is nothing without a visual viewport', () => {
    expect(viewportInsets(null, 800)).toEqual(NO_INSETS)
    expect(viewportInsets(undefined, 800)).toEqual(NO_INSETS)
  })

  it('measures what the visible area leaves of the layout viewport, top and bottom', () => {
    // A keyboard covers the bottom 300 px.
    expect(viewportInsets({ height: 500, offsetTop: 0 }, 800)).toEqual({ top: 0, bottom: 300, height: 500 })
    // The page scrolled under an address bar: the visible area starts 56 px down.
    expect(viewportInsets({ height: 600, offsetTop: 56 }, 800)).toEqual({ top: 56, bottom: 144, height: 600 })
    // A toolbar slid away: the visible area reaches 50 px past the layout viewport's bottom.
    expect(viewportInsets({ height: 850, offsetTop: 0 }, 800)).toEqual({ top: 0, bottom: -50, height: 850 })
    // Sub-pixel values round; a top above the page never pushes the bar up.
    expect(viewportInsets({ height: 799.6, offsetTop: -0.4 }, 800)).toEqual({ top: 0, bottom: 1, height: 800 })
  })

  it('takes the safe-area bottom inset out of a lift: the bars stand on the keyboard, not an inset above it', () => {
    // The shell sits 34 px above the layout viewport's bottom (the home indicator).
    expect(viewportInsets({ height: 500, offsetTop: 0 }, 800, 34)).toEqual({ top: 0, bottom: 266, height: 500 })
    // A lift smaller than the inset leaves the bars where the inset put them.
    expect(viewportInsets({ height: 790, offsetTop: 0 }, 800, 34)).toEqual({ top: 0, bottom: 0, height: 790 })
    // A visible area reaching past the bottom is not a lift: the inset does not change it.
    expect(viewportInsets({ height: 850, offsetTop: 0 }, 800, 34)).toEqual({ top: 0, bottom: -50, height: 850 })
  })
})

describe('trackVisualViewport', () => {
  it('writes nothing and listens to nothing in a browser without visualViewport', () => {
    const { el, props } = fakeTarget()
    stop = trackVisualViewport(el, null, () => 800)
    expect(props.size).toBe(0)
    expect(currentInsets()).toEqual(NO_INSETS)
  })

  it('writes the insets at once and again on every resize and scroll, then cleans up', () => {
    const fake = fakeViewport(800)
    const { el, props } = fakeTarget()
    stop = trackVisualViewport(el, fake.vv, () => 800)
    expect(Object.fromEntries(props)).toEqual({ '--vv-top': '0px', '--vv-bottom': '0px', '--vv-height': '800px' })

    fake.set(480)
    fake.fire('resize')
    expect(props.get('--vv-bottom')).toBe('320px')
    expect(currentInsets().bottom).toBe(320)

    fake.set(480, 40)
    fake.fire('scroll')
    expect(props.get('--vv-top')).toBe('40px')
    expect(props.get('--vv-bottom')).toBe('280px')

    stop()
    stop = null
    expect(props.size).toBe(0)
    expect(fake.count()).toBe(0)
    expect(currentInsets()).toEqual(NO_INSETS)
  })

  it('reads the safe-area inset the shell applies, so the keyboard lift matches the padding', () => {
    const fake = fakeViewport(800)
    const { el, props } = fakeTarget()
    stop = trackVisualViewport(el, fake.vv, () => 800, () => 34)
    // A keyboard covers 320 px; the shell already sits 34 px up.
    fake.set(480)
    fake.fire('resize')
    expect(props.get('--vv-bottom')).toBe('286px')
    expect(currentInsets().bottom).toBe(286)
  })

  it('reads the inset from the body’s bottom padding (what app.css sets), 0 without a body', () => {
    expect(bodySafeBottom()).toBe(0)
    const body = {}
    vi.stubGlobal('document', { body })
    vi.stubGlobal('getComputedStyle', (el: unknown) => ({ paddingBottom: el === body ? '21px' : '0px' }))
    try {
      expect(bodySafeBottom()).toBe(21)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
