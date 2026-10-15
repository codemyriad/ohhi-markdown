/**
 * The selection widget's host (selection explorations, shape B as Chris
 * chose it, 2026-10-15): a CodeMirror tooltip that hangs a small HANDLE at
 * the end of a settled selection — by default *Comment | Ask*.
 *
 * This module decides WHEN and WHERE; it draws nothing of its own. What the
 * handle holds is the host's (`SelectionBarHost.mount` gets the tooltip's
 * element and fills it — the app draws `bars.selection` there from the
 * command registry), so the same host can carry any list of items: the
 * proposal's Accept / Reject pair can move onto it later (R7).
 *
 * The rules, each pure and unit-tested (`test/selection-bar.test.ts`):
 *  - it shows only after the selection SETTLES: never while a pointer button
 *    is down (a drag), then `settleMs` after the last selection change, on
 *    the injected scheduler;
 *  - it hides on typing (any user edit except a format command's), on an
 *    empty or multi-range selection, on a selection change (to settle
 *    again), on Escape, and while the selection overlaps a proposal
 *    (`suggestions.ts`: the proposal's own pair is the only control there);
 *  - it sits at the selection's END (`handlePlacement`): beside the last
 *    selected character when the line has room, else just below that line —
 *    never over the selected text. Under a finger (`coarse`) it goes below
 *    the end line and clear of the OS's end handle, never above the
 *    selection, where the OS draws its own menu.
 */
import { Prec, StateEffect, StateField, type EditorState, type Extension, type Transaction } from '@codemirror/state'
import {
  EditorView,
  ViewPlugin,
  getTooltip,
  keymap,
  showTooltip,
  type Rect,
  type Tooltip,
  type TooltipView,
  type ViewUpdate,
} from '@codemirror/view'
import { suggestionsIn } from './suggestions.js'

/** Which pointer made the selection: a mouse (`fine`) or a finger or pen (`coarse`, clear of the OS's handles). */
export type SelectionBarForm = 'fine' | 'coarse'

/** What the host draws into the tooltip; called once per showing. */
export interface SelectionBarMount {
  /** Called after any transaction while the bar is up (the selection or the text moved). */
  update?(view: EditorView): void
  destroy?(): void
}

/** What the editor asks of its host. One per view. */
export interface SelectionBarHost {
  /** Fill `dom` (the tooltip's element) with the bar's items for `form`. */
  mount(dom: HTMLElement, view: EditorView, form: SelectionBarForm): SelectionBarMount
  /** Whether a bar is offered at all right now (the layout turns it off, no items…). Default: yes. */
  offered?(view: EditorView): boolean
  /**
   * Whether focus moving to `el` (outside the editor) keeps the bar up: a
   * menu or sheet the bar itself opened, portalled elsewhere. Default: no.
   */
  keepsFocus?(el: Element): boolean
}

/** A scheduler: run `fn` after `ms`, returning its cancel. Injected (golden rule 5); timers otherwise. */
export type Schedule = (fn: () => void, ms: number) => () => void

export interface SelectionBarOptions {
  host: SelectionBarHost
  /** How long a selection must stay put before the bar shows. */
  settleMs?: number
  schedule?: Schedule
  /** A finger or a pen made the selection: placed clear of the OS's handles. Default: the last pointer's type. */
  coarse?(view: EditorView): boolean
}

/** The default settle delay (selection explorations, fork 1-A). */
export const SETTLE_MS = 250

const timers: Schedule = (fn, ms) => {
  const id = globalThis.setTimeout(fn, ms)
  return () => globalThis.clearTimeout(id)
}

// ---------------------------------------------------------------------------
// The rules (pure)
// ---------------------------------------------------------------------------

/** One non-empty range that touches no proposal: the only selection a bar is offered for. */
export function barEligible(state: EditorState): boolean {
  const { ranges, main } = state.selection
  if (ranges.length !== 1 || main.empty) return false
  return !insideSuggestion(state, main.from, main.to)
}

/** Does `from…to` overlap (or touch the inside of) a proposal the editor is drawing? */
export function insideSuggestion(state: EditorState, from: number, to: number): boolean {
  return suggestionsIn(state).some((s) => s.from < to && from < s.to + (s.from === s.to ? 1 : 0))
}

/**
 * A transaction that is the person typing (or deleting, pasting, dropping,
 * undoing): what takes the bar down. A format command (`input.format`, the
 * Bold run while it is up) keeps it up, moved with the text.
 */
export function isTyping(tr: Transaction): boolean {
  if (!tr.docChanged) return false
  if (tr.isUserEvent('input.format')) return false
  return ['input', 'delete', 'paste', 'drop', 'undo', 'redo', 'move'].some((e) => tr.isUserEvent(e))
}

/** Show the bar in a form, or (null) take it down. */
export const showSelectionBar = StateEffect.define<SelectionBarForm | null>()

interface Bar {
  form: SelectionBarForm
  tooltip: Tooltip
}

/** Whether the bar is up, and in which form; null when it is not. */
export function selectionBarForm(state: EditorState): SelectionBarForm | null {
  return state.field(selectionBarField, false)?.form ?? null
}

const hostFacet = StateField.define<SelectionBarOptions | null>({
  create: () => null,
  update: (v) => v,
})

/**
 * The bar's state. The value stays the SAME object while it is up, so CM6
 * keeps its DOM; its position is read live from the selection (`getCoords`),
 * so a format command or a peer's edit moves it without a rebuild.
 */
export const selectionBarField = StateField.define<Bar | null>({
  create: () => null,
  update(bar, tr) {
    for (const e of tr.effects) {
      if (e.is(showSelectionBar)) {
        if (e.value === null) return null
        return barEligible(tr.state) ? (bar?.form === e.value ? bar : barFor(e.value, tr.state)) : null
      }
    }
    if (!bar) return null
    if (isTyping(tr)) return null
    if (!barEligible(tr.state)) return null
    // A move of the selection alone settles again before the bar comes back.
    if (tr.selection && !tr.docChanged) return null
    return bar
  },
  provide: (field) => showTooltip.from(field, (bar) => bar?.tooltip ?? null),
})

function barFor(form: SelectionBarForm, state: EditorState): Bar {
  const options = state.field(hostFacet, false)
  const tooltip: Tooltip = {
    pos: state.selection.main.from,
    above: false,
    strictSide: true,
    clip: true,
    create: (view) => createBar(view, form, options?.host ?? null),
  }
  return { form, tooltip }
}

// ---------------------------------------------------------------------------
// Where it sits
// ---------------------------------------------------------------------------

/** The gap between the handle and the text, in px. */
const GAP = 6
/** Room left for the OS's end handle (its knob hangs below the line), in px. */
const KNOB = 14

/**
 * Where the handle goes, given the selection's last character (`end`, its
 * line box at the end), the handle's size and the room across (`bounds`).
 * Pure, so its promise — never over the selected text, never above the
 * selection under a finger — is unit-tested.
 *
 *  - fine: beside the end, centred on its line, when the line has room;
 *    else just below the end line, its right edge at the end.
 *  - coarse: below the end line, right of the OS's end knob; when there is
 *    no room on the right, left of it, lower (clear of the knob).
 */
export function handlePlacement(
  end: { left: number; right: number; top: number; bottom: number },
  size: { width: number; height: number },
  bounds: { left: number; right: number },
  form: SelectionBarForm
): { left: number; top: number } {
  const roomRight = (dx: number): boolean => end.right + dx + size.width <= bounds.right
  if (form === 'fine') {
    if (roomRight(GAP)) return { left: end.right + GAP, top: (end.top + end.bottom) / 2 - size.height / 2 }
    return { left: Math.max(bounds.left, end.right - size.width), top: end.bottom + GAP / 2 }
  }
  if (roomRight(KNOB)) return { left: end.right + KNOB, top: end.bottom + 2 }
  return { left: Math.max(bounds.left, end.right - KNOB - size.width), top: end.bottom + KNOB }
}

const OUTSIDE: Rect = { left: -1e5, right: -1e5, top: -1e5, bottom: -1e5 }

/** The handle's anchor rect for CM6's tooltip layer: its top-left corner, from `handlePlacement`. */
function handleRect(view: EditorView, dom: HTMLElement, form: SelectionBarForm): Rect {
  const end = view.coordsAtPos(view.state.selection.main.to, -1)
  if (!end) return OUTSIDE
  const box = dom.getBoundingClientRect()
  const visible = view.contentDOM.getBoundingClientRect()
  const scroller = view.scrollDOM.getBoundingClientRect()
  const at = handlePlacement(end, box, { left: scroller.left, right: Math.min(scroller.right, visible.right + 48) }, form)
  return { left: at.left, right: at.left, top: at.top, bottom: at.top }
}

function createBar(view: EditorView, form: SelectionBarForm, host: SelectionBarHost | null): TooltipView {
  const dom = document.createElement('div')
  dom.className = `cm-selection-bar cm-selection-bar-${form}`
  dom.dataset.testid = 'selection-handle'
  dom.dataset.form = form
  // Escape from inside the bar: back to the text, the bar down.
  dom.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    view.dispatch({ effects: showSelectionBar.of(null) })
    view.focus()
  })
  let mounted: SelectionBarMount | null = null
  return {
    dom,
    // Placed whole by `handlePlacement`: the anchor is its top-left corner.
    getCoords: () => handleRect(view, dom, form),
    resize: false,
    mount(v) {
      mounted = host?.mount(dom, v, form) ?? null
    },
    update(u) {
      mounted?.update?.(u.view)
    },
    destroy() {
      mounted?.destroy?.()
      mounted = null
    },
  }
}

// ---------------------------------------------------------------------------
// When it shows: the settle rule
// ---------------------------------------------------------------------------

/**
 * The settle rule, apart from any DOM so it unit-tests on node: told about
 * every selection change and every pointer press and release, it calls
 * `show` once the selection has stayed put for `ms` with no button down.
 */
export interface Settle {
  /** The selection or the text changed: (re)start the wait, if a bar is wanted. */
  changed(state: EditorState): void
  /** A pointer button went down (true) or came up (false) over the text. */
  pointer(down: boolean, state: EditorState): void
  /** Stop waiting (Escape, the bar shown, the view going). */
  cancel(): void
  readonly pending: boolean
}

export function createSettle(schedule: Schedule, ms: number, show: () => void): Settle {
  let cancelTimer: (() => void) | null = null
  let down = false
  const cancel = (): void => {
    cancelTimer?.()
    cancelTimer = null
  }
  const wait = (state: EditorState): void => {
    cancel()
    if (down || !barEligible(state)) return
    cancelTimer = schedule(() => {
      cancelTimer = null
      if (!down) show()
    }, ms)
  }
  return {
    changed: wait,
    pointer(isDown, state) {
      down = isDown
      if (isDown) cancel()
      else wait(state)
    },
    cancel,
    get pending() {
      return cancelTimer !== null
    },
  }
}

/** The bar's DOM while it is up (for Alt+F10). */
function barDom(view: EditorView): HTMLElement | null {
  const bar = view.state.field(selectionBarField, false)
  return bar ? (getTooltip(view, bar.tooltip)?.dom ?? null) : null
}

/** Move the keyboard into the bar (Alt+F10, the toolbar pattern's key): its first control. */
export function focusSelectionBar(view: EditorView): boolean {
  const control = barDom(view)?.querySelector<HTMLElement>('button:not([disabled]), [tabindex="0"]')
  if (!control) return false
  control.focus()
  return true
}

const settlePlugin = ViewPlugin.define((view) => {
  const options = view.state.field(hostFacet, false)
  const host = options?.host ?? null
  let lastPointer = ''
  const coarse = (): boolean => {
    if (options?.coarse) return options.coarse(view)
    if (lastPointer) return lastPointer === 'touch' || lastPointer === 'pen'
    try {
      return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    } catch {
      return false
    }
  }
  const show = (): void => {
    if (!barEligible(view.state)) return
    if (host?.offered && !host.offered(view)) return
    // Only for the editor in use: a selection left in another pane stays quiet.
    if (!view.hasFocus) return
    const form: SelectionBarForm = coarse() ? 'coarse' : 'fine'
    if (selectionBarForm(view.state) === form) return
    view.dispatch({ effects: showSelectionBar.of(form) })
  }
  const settle = createSettle(options?.schedule ?? timers, options?.settleMs ?? SETTLE_MS, show)

  const onUp = (): void => {
    globalThis.removeEventListener('pointerup', onUp, true)
    globalThis.removeEventListener('pointercancel', onUp, true)
    settle.pointer(false, view.state)
  }
  const onDown = (e: PointerEvent): void => {
    lastPointer = e.pointerType
    settle.pointer(true, view.state)
    globalThis.addEventListener('pointerup', onUp, true)
    globalThis.addEventListener('pointercancel', onUp, true)
  }
  view.contentDOM.addEventListener('pointerdown', onDown)

  // The focus leaving the editor (and the bar, and whatever the bar opened) takes it down.
  let cancelBlur: (() => void) | null = null
  const onFocusOut = (): void => {
    cancelBlur?.()
    cancelBlur = (options?.schedule ?? timers)(() => {
      cancelBlur = null
      if (!view.state.field(selectionBarField, false)) return
      const active = view.root.activeElement
      if (active && (view.dom.contains(active) || host?.keepsFocus?.(active))) return
      view.dispatch({ effects: showSelectionBar.of(null) })
    }, 0)
  }
  view.dom.addEventListener('focusout', onFocusOut)

  return {
    update(u: ViewUpdate) {
      if (!u.selectionSet && !u.docChanged && !u.focusChanged) return
      if (u.state.field(selectionBarField, false)) return settle.cancel()
      if (u.focusChanged && !u.view.hasFocus) return
      settle.changed(u.state)
    },
    destroy() {
      settle.cancel()
      cancelBlur?.()
      view.contentDOM.removeEventListener('pointerdown', onDown)
      view.dom.removeEventListener('focusout', onFocusOut)
      onUp()
    },
  }
})

/**
 * The selection bar: the field, the tooltip, the settle rule, and two keys —
 * Escape takes the bar down (and stays in the text), Alt+F10 moves the
 * keyboard onto it.
 */
export function selectionBar(options: SelectionBarOptions): Extension {
  return [
    hostFacet.init(() => options),
    selectionBarField,
    settlePlugin,
    Prec.high(keymap.of([
      {
        key: 'Escape',
        run: (view) => {
          if (!view.state.field(selectionBarField, false)) return false
          view.dispatch({ effects: showSelectionBar.of(null) })
          return true
        },
      },
      { key: 'Alt-F10', run: focusSelectionBar },
    ])),
  ]
}
