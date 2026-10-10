/**
 * The readout catalogue (quiet-shell F6): one Svelte component per
 * `ReadoutId`, each a small view over state that already exists. A bar — the
 * toolbar's left and right groups, and the per-pane status bar's
 * `bars.statusbar` — is a list of ids from the layout spec, rendered through
 * this map by ONE list renderer (`components/BarItems.svelte`).
 *
 * Every readout follows the FOCUSED pane (spike S21 Q3): `panes.layout.focus`
 * and its active tab, which is the tab `ui.selectedPath` names, so the words,
 * the mode and the pill on screen are always about the same note. A per-pane
 * status bar sets `ctx.pane`, and its readouts follow that pane instead.
 *
 * ONE map, in one file, on purpose: add your entry here; nothing else needs
 * to know a readout exists. Readouts read STATE from the context; their
 * verbs (open a note, a view, create, pin) are the `ViewShell`'s
 * (`getViewShell()`, views.ts) — the one verb surface every readout and view
 * shares, so a row opened from the drawer behaves as one opened anywhere.
 */
import { getContext, hasContext, setContext, type Component } from 'svelte'
import type { DailyShell } from './daily.svelte.js'
import type { GroupShell } from './group-ui.svelte.js'
import type { ReadoutId } from './layout-spec.js'
import type { Navigation } from './navigation.svelte.js'
import { focusedOf, type Focused } from './readout-state.js'
import type { ShellLayout } from './shell-layout.svelte.js'
import { menuPlacement, type MenuPlacement, type Side } from './ui/placement.js'
import type { PaneShell } from './workspace-panes.svelte.js'
import type { Workspace } from './workspace.svelte.js'
import Breadcrumb from './components/readouts/BreadcrumbReadout.svelte'
import Chars from './components/readouts/Chars.svelte'
import DailyNav from './components/readouts/DailyNav.svelte'
import Drawer from './components/readouts/Drawer.svelte'
import Inspector from './components/readouts/Inspector.svelte'
import Help from './components/readouts/Help.svelte'
import LastAgentWrite from './components/readouts/LastAgentWrite.svelte'
import GroupChip from './components/readouts/GroupChipReadout.svelte'
import Mode from './components/readouts/ModeReadout.svelte'
import Nav from './components/readouts/Nav.svelte'
import PaneLead from './components/readouts/PaneLead.svelte'
import ReadingTime from './components/readouts/ReadingTime.svelte'
import Sync from './components/readouts/Sync.svelte'
import Title from './components/readouts/Title.svelte'
import Words from './components/readouts/Words.svelte'

/** The pane a per-pane status bar's readouts report on. */
export interface ReadoutPane {
  id: string
  /** The focused pane's bar keeps the bare testids the specs drive. */
  focused: boolean
  /** The layout's `panes.lead`: "Pane 2 · 3 tabs" in this bar. */
  lead: boolean
}

/** What every readout may read. Shell state, never per-pane props (S21 Q3). */
export interface ReadoutContext {
  workspace: Workspace
  panes: PaneShell
  layout: ShellLayout
  nav: Navigation
  daily: DailyShell
  groups: GroupShell
  /**
   * The readouts stand in for the per-pane status bar (`regions.statusbar:
   * 'merged'`): the note readouts carry the status bar's testids
   * (`word-count`, `mode-menu`, `sync-pill-note`, `pane-zoomed`), because
   * they ARE that bar now. Otherwise they take `toolbar-` ones, so the two
   * never collide.
   */
  merged: boolean
  /**
   * Which way this bar's menus, popovers and tooltips open — away from the
   * edge the bar sits on (a bottom toolbar, a status bar: `top`). Set by the
   * host bar; absent → `bottom`.
   */
  side?: Side
  /** Set by a per-pane status bar: the pane its readouts follow. Absent → the focused pane. */
  pane?: ReadoutPane
  /** Whether developer tools are on (Settings › Developer, `?debug=1`); absent → off. */
  devtools?: () => boolean
}

export type Readout = Component<{ ctx: ReadoutContext }>

/** The pane a readout reports on: the status bar's own, or the focused one. */
export function targetOf(ctx: Pick<ReadoutContext, 'panes' | 'pane'>): Focused {
  return focusedOf(ctx.panes.layout, ctx.pane?.id)
}

/** A status bar's own testid: the focused pane's is the one the specs drive. */
export function statusBarTestid(pane: Pick<ReadoutPane, 'id' | 'focused'>): string {
  return pane.focused ? 'status-bar' : `pane-status:${pane.id}`
}

/** An unfocused pane's name for a status-bar testid, where it is not `<id>:<pane>`. */
const UNFOCUSED: Record<string, string> = { 'sync-pill-note': 'sync-pill-pane' }

/**
 * The testid a note readout carries. In a status bar: the bare id for the
 * focused pane, `<id>:<pane>` for the others (`sync-pill-pane:<pane>` for the
 * pill). In the toolbar: the status bar's own when merged, `toolbar-<id>`
 * otherwise.
 */
export function readoutTestid(ctx: Pick<ReadoutContext, 'merged' | 'pane'>, id: string): string {
  if (ctx.pane) return ctx.pane.focused ? id : `${UNFOCUSED[id] ?? id}:${ctx.pane.id}`
  return ctx.merged ? id : `toolbar-${id}`
}

/** Where a readout's menu or popover opens, aligned to `align` (its bar's `side`). */
export function readoutPlacement(ctx: Pick<ReadoutContext, 'side'>, align: 'start' | 'end' = 'end'): MenuPlacement {
  return menuPlacement(ctx.side ?? 'bottom', align)
}

/**
 * A bar inside a host bar: the same context with this bar's `side` (and
 * pane). The host's object stays the prototype, so its getters stay live.
 */
export function inBar(ctx: ReadoutContext, own: Pick<ReadoutContext, 'side' | 'pane'>): ReadoutContext {
  return Object.assign(Object.create(ctx) as ReadoutContext, own)
}

const READOUT_CONTEXT = Symbol('readout-context')

/** Provide the readout context to every bar below (App.svelte, at init): the status bars read it. */
export function setReadoutContext(ctx: ReadoutContext): void {
  setContext(READOUT_CONTEXT, ctx)
}

/** The readout context, or null when no shell provided one. Call during component init. */
export function getReadoutContext(): ReadoutContext | null {
  return hasContext(READOUT_CONTEXT) ? getContext<ReadoutContext>(READOUT_CONTEXT) : null
}

export const READOUTS: Record<ReadoutId, Readout> = {
  // Round 2, P1: back/forward, and the focused tab's name as its handle.
  nav: Nav,
  title: Title,
  // Round 2, P5: the one sync readout. `note.pill` and `people` are its old
  // ids — a file naming them is read as `sync` (`READOUT_ALIASES`), so they
  // only render here when a spec is built in code. `vault.pill` is the same
  // icon: it shows the vault rollup whenever no note with a relay is focused.
  sync: Sync,
  words: Words,
  // Round 3, Q4: the corner's other number, counted beside `words`.
  chars: Chars,
  'reading-time': ReadingTime,
  mode: Mode,
  'note.pill': Sync,
  'vault.pill': Sync,
  'pane.lead': PaneLead,
  breadcrumb: Breadcrumb,
  'daily.nav': DailyNav,
  'group.chip': GroupChip,
  drawer: Drawer,
  // Chris, 2026-10-06: the inspector view's door, right of the bell; nothing while devtools are off.
  inspector: Inspector,
  // first-run E1: the Help menu, at the toolbar's right end after the inspector.
  help: Help,
  // Writing-harness B7: "Tighten edited Plan 3 min ago"; nothing until the in-app agent has written.
  'last-agent-write': LastAgentWrite,
  people: Sync,
}
