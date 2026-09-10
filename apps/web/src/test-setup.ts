// Vitest setup: jest-dom matchers (`toBeVisible`, `toHaveAccessibleName`, …)
// for the component tests. Harmless in node-environment suites.
import '@testing-library/jest-dom/vitest'

// jsdom has no layout: Melt's floating-ui positioning observes element size
// and menus scroll their focused item into view. Neither matters to what the
// component tests assert (roles, names, focus, keyboard), so both are inert.
if (typeof window !== 'undefined') {
  window.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Element.prototype.scrollIntoView ??= () => {}
  // focus-trap (inside Melt's dialog) asks `tabbable` for the controls it may
  // move focus to, and `tabbable` treats an element with no client rects as
  // hidden — which, without layout, is every element. One rect each.
  const rect = { x: 0, y: 0, width: 1, height: 1, top: 0, left: 0, right: 1, bottom: 1 }
  Element.prototype.getClientRects = function () {
    const list = [rect] as unknown as DOMRectList
    return list
  }
}
