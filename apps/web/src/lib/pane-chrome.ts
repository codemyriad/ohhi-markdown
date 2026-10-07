/**
 * Which pane chrome exists (spike S21, quiet-shell F3) — pure, so the rules
 * the quiet default rests on are unit-tested rather than read off markup.
 *
 * Structure only: whether the strip, the per-pane status bar, the focus edge
 * and the off-focus sync dot are in the DOM. How each one looks is the
 * `--ed-pane-*` tokens (`docs/theming.md`, *Panes & tabs*).
 */
import type { ShellSpec } from './layout-spec.js'
import type { PillStatus } from './pill-status.js'
import type { Pane } from './panes.js'

export interface PaneChrome {
  /** `auto`: the strip only at two or more tabs, or any group. */
  tabs: ShellSpec['regions']['tabs']
  /** `merged`: no per-pane status bar; an unfocused pane off green shows a sync dot. */
  statusbar: ShellSpec['regions']['statusbar']
  /** `none`: no hairline between splits (the separator stays). */
  borders: ShellSpec['panes']['borders']
  /** The focused pane's own edge when two or more panes are on screen. */
  focusMark: boolean
  /** "Pane 2 · 3 tabs" in the status bar. */
  lead: boolean
  /** Focus mode is on: no strip either. */
  focusMode: boolean
}

/** Today's chrome — what `dense` resolves to — for a host that passes none. */
export const DENSE_CHROME: PaneChrome = {
  tabs: 'always',
  statusbar: 'pane',
  borders: 'hairline',
  focusMark: false,
  lead: true,
  focusMode: false,
}

/** The chrome a resolved spec gives a pane, plus the session's Focus mode. */
export function paneChrome(spec: Pick<ShellSpec, 'regions' | 'panes'>, focusMode = false): PaneChrome {
  return {
    tabs: spec.regions.tabs,
    statusbar: spec.regions.statusbar,
    borders: spec.panes.borders,
    focusMark: spec.panes.focusMark,
    lead: spec.panes.lead,
    focusMode,
  }
}

/**
 * Does this pane draw its tab strip? `auto` hides it for a lone tab with no
 * group — a group always keeps its strip, because its chip lives there. Not
 * rendered means not rendered: a zero-height strip would leave an invisible
 * tab stop (S21 Q2).
 */
export function showsStrip(chrome: PaneChrome, pane: Pick<Pane, 'tabs' | 'groups'>): boolean {
  if (chrome.focusMode) return false
  return chrome.tabs === 'always' || pane.tabs.length > 1 || pane.groups.length > 0
}

/**
 * Where the strip's new-tab `+` goes (Chris, 2026-10-06): right after the last
 * tab while the tabs fit, docked at the strip's right end (left of the mode
 * control) once they overflow. `content` is the scrolling run's content width
 * and `room` its visible width, measured in whichever place the `+` is now.
 * The one test holds in both: in the run, content = tabs + `+`; docked, the
 * `+` left the run AND took its own width from the run's room — so moving it
 * never flips the answer back (no oscillation at the boundary).
 */
export function newTabDocks(run: { content: number; room: number }): boolean {
  return run.content > run.room + 0.5
}

/** The focused pane's own edge: only when there is more than one pane to tell apart. */
export function showsFocusEdge(chrome: PaneChrome, focused: boolean, panesOnScreen: number): boolean {
  return chrome.focusMark && focused && panesOnScreen > 1
}

/**
 * Golden rule 4 under a merged status bar: the toolbar's pill speaks for the
 * FOCUSED note only, so every other pane on screen whose note is not green
 * says so itself. Green panes, and panes with no note, show nothing.
 */
export function showsSyncDot(
  chrome: PaneChrome,
  focused: boolean,
  status: PillStatus | null
): status is Exclude<PillStatus, 'green'> {
  return chrome.statusbar === 'merged' && !focused && status !== null && status !== 'green'
}
