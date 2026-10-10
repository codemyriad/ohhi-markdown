/**
 * The shell's pane state (tab-groups W1): the tree, the mode, the drag
 * session and the device-local persistence around them.
 *
 * `panes.ts` / `groups.ts` / `mode.ts` are pure and know nothing about the
 * DOM, documents or storage; the components are thin renderers. This is the
 * one module that sees all three — it holds the current `Layout`, turns every
 * command and gesture into one of the pure ops, and re-derives the two things
 * the rest of the app reads from a layout change: the set of paths that have
 * a live view (`setLiveViews`, the S9 seam) and the focused pane's active
 * path (`ui.selectedPath`, which the rail, breadcrumb, index and links panel
 * follow).
 *
 * Two rules keep it honest:
 *
 * - **Every mutation goes through `commit`**, so nothing can change the tree
 *   without the save being scheduled and the derivations re-running.
 * - **Geometry is measured, never assumed**: `neighbour`, the split-auto axis
 *   and the drag hit test all read real rects off the elements the components
 *   register here, because the tree has no idea how wide anything is.
 */
import { untrack } from 'svelte'
import { getLL } from '@ohhi/i18n'
import type { FormatBindings, FormatCommandId } from '@ohhi/editor'
import type { TableCommandId } from '@ohhi/editor-lang'
import type { Clock } from '@ohhi/vault'
import type { Command, CommandRegistry } from './commands.js'
import * as groupOps from './groups.js'
import { MODES, hints as modeHints, step as modeStep, type Hint, type Mode } from './mode.js'
import { familyTitle, formatCommands, paneCommands, tableCommands } from './pane-commands.js'
import { slotsFrom, stripDrop, zoneBox, type Box } from './pane-drag.js'
import * as tree from './panes.js'
import {
  afterToggleReading,
  afterToggleSource,
  readCommands,
  readState,
} from './read.svelte.js'
import type {
  ClosedTab,
  Dir,
  Group,
  GroupColor,
  Layout,
  Pane,
  Rect,
  SavedGroup,
  Side,
  Tab,
  TabView,
  ViewMode,
} from './panes.js'
import { loadLayout, loadSavedGroups, saveWorkspace } from './workspace-layout.js'
import { textPaths, type Workspace } from './workspace.svelte.js'

/**
 * Is something other than the pane tree holding the keyboard right now?
 *
 * A live pane mode `preventDefault`s every key until Escape, and the flat
 * chords act on the tabs behind whatever is on top — so `Mod+P` pressed in
 * Settings' relay-URL field used to swallow the rest of the typing, and
 * `Mod+W` in a dialog closed a tab nobody could see (M4). Two things claim
 * the keyboard: a text field outside the panes (CodeMirror, and any field a
 * pane draws itself, are where the pane keys are SUPPOSED to work), and an
 * open modal overlay.
 *
 * Read off the document rather than from a shell-level counter because there
 * is no such counter: `Dialog` is mounted and unmounted by its parent, and
 * Melt's own `aria-modal` is the one mark every MODAL overlay in the shell
 * carries. `Popover` (shell-polish P1.3) is deliberately NOT modal, so it
 * carries no `aria-modal` — but it is still an overlay with a focus trap, and
 * a pane mode entered behind it would act on the tabs its verbs are about. Its
 * own builder mark stands in.
 */
export function keyboardClaimed(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return false
  if (doc.querySelector('[aria-modal="true"], [data-melt-popover-content]')) return true
  const el = doc.activeElement
  if (!el || !(el instanceof Element)) return false
  // A field that is part of a pane — the empty tab's picker, a view's filter,
  // the inline title — is the pane tree's own: the tab keys act on THAT tab
  // (`Mod+W` closes it, `Mod+Shift+T` reopens what it replaced), as in a
  // browser's address bar. Only fields outside the panes claim the keyboard.
  if (el.closest('.cm-editor, [data-pane-id]')) return false
  const tag = el.tagName.toLowerCase()
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    (el as HTMLElement).isContentEditable === true
  )
}

/** Layout writes are device-local and cheap; this only keeps a drag quiet. */
const SAVE_DEBOUNCE_MS = 400
/**
 * Pointer travel before a press on a tab or a chip becomes a drag (B10).
 * Exported because a chip's own click handler has to tell the two apart: a
 * drag that ends where it started would otherwise fold the group.
 */
export const DRAG_THRESHOLD_PX = 6
/** One keyboard/mode resize step, in percent of the split. */
const RESIZE_STEP_PCT = 5

export interface DragPayload {
  tabIds: string[]
  fromPaneId: string
  /** Set when the payload IS a whole group (a chip drag — W2). */
  groupId: string | null
  label: string
  color: number | null
  /**
   * Set when the drag started OUTSIDE the strip — a file-tree row, which is an
   * HTML5 drag source carrying a path and no tab at all (P1.2). The hit test
   * and the indicator are the same; what a drop DOES differs, and the browser
   * draws the row, so `DropZones` leaves the ghost out.
   */
  external?: true
}

/** Where a tab was when its view went away: the cursor and the scroll (B2). */
export interface Resume {
  cursor: { anchor: number; head: number }
  scroll: number
}

/**
 * What a live view can be asked to do to its text from outside (read X2).
 * Deliberately not the CM6 handle: the controller is DOM-free by design, and
 * `edit.toggle-checkbox` only needs the one command.
 */
export interface PaneEditor {
  /** `toggleTask` over the main selection; false when no line qualifies. */
  toggleTask(): boolean
  /** One of `FORMAT_COMMANDS` by id (quiet-shell F4); false when it did nothing. */
  format(id: FormatCommandId): boolean
  /** One of `TABLE_COMMANDS` by id (E4); false when it did nothing. */
  table?(id: TableCommandId): boolean
  /** The caret is inside a GFM table — the `table.*` rows' gate (E4). */
  inTable?(): boolean
  /** Replace the selection with `text` at the caret (a template, F11); false when read-only. */
  insertText?(text: string): boolean
  /** Re-key the view's own format keymap to the resolved keymap (F10). */
  setFormatBindings?(bindings: FormatBindings): void
}

export type { Box }

export type DropTarget =
  /** Over something that cannot take the payload — paint nothing. */
  | { kind: 'none' }
  | {
      kind: 'strip'
      paneId: string
      at: number
      groupId?: string | null
      /** The joined group's token slot, so the indicator wears its colour. */
      color?: number
      /** Where the 2 px insertion indicator goes. */
      x: number
      top: number
      height: number
    }
  | { kind: 'zone'; paneId: string; zone: 'center' | Side; box: Box }

export interface DragState {
  payload: DragPayload
  x: number
  y: number
  target: DropTarget | null
}

export interface PaneShell {
  readonly layout: Layout
  readonly savedGroups: readonly SavedGroup[]
  readonly mode: Mode | null
  /**
   * E6: `?` in a live mode asked for every key (the corner cue expands to
   * the mode's full list). Closed again whenever a mode is entered.
   */
  readonly modeKeysOpen: boolean
  readonly drag: DragState | null
  /** 1-based, in strip (DFS) order — what the status bar and menus call it. */
  paneIndex(paneId: string): number
  /** Every `workspace.*` / `tab.*` row of the command table. */
  commands(): Command[]
  /** The live mode's hint rows, already translated; empty when no mode. */
  hints(): Hint[]
  /** What Escape does in the live mode — sticky modes say "done". */
  escapeLabel(): string
  modeBadge(): string
  attach(workspace: Workspace | null, vaultKey: string): void
  /** A key press while a mode is live; true = swallowed, never reaches CM6. */
  handleKey(e: KeyboardEvent): boolean
  leaveMode(): void

  // ---- opening (B5) ----
  /**
   * Fork 1-B: every open is a tab. `background` = Mod+click / Mod+Enter.
   * `replace` (the layout's `panes.open: 'replace'`) navigates the pane's
   * active tab in place instead — never a pinned or view tab, never a
   * background open (`panes.ts` `openPath`).
   */
  open(path: string, opts?: { background?: boolean; paneId?: string; replace?: boolean }): void
  /** The one in-place navigation: a `[[link]]`, or the empty tab's picker. */
  navigate(path: string, tabId?: string): void
  /** A shell surface as a tab (devtools-shaping D1-A); one per pane per (view, arg). */
  openView(view: TabView, arg?: string): void
  travel(delta: number): void
  canTravel(delta: number): boolean

  // ---- the strip's own affordances ----
  activate(paneId: string, tabId: string): void
  focusPane(paneId: string): void
  closeTab(tabId: string): void
  togglePin(tabId: string): void
  newTabIn(paneId: string): void
  closeOthersIn(paneId: string): void
  closePaneById(paneId: string): void
  moveTabToPane(tabId: string, paneId: string): void
  /** The pane on `side` of the focused one, by geometry, or null. */
  neighbourPane(side: Side): string | null
  resizeSplit(splitId: string, index: number, deltaPct: number): void
  /** Write the layout out now — what a drag gesture's END calls (chrome U2). */
  persistNow(): void

  // ---- geometry the components own ----
  registerPane(paneId: string, el: HTMLElement | null): void
  /**
   * A pane's live view offers its resume point on demand (B2).
   *
   * A view only reports one when it is TORN DOWN, which is a beat too late
   * for anything that SNAPSHOTS a tab: `closeGroup` and `closePane` read the
   * tab's cursor before the teardown runs, and would tuck a stale one into
   * the saved list. So the ops that keep a resume point ask for it first.
   */
  registerCapture(paneId: string, capture: (() => Resume | null) | null): void
  /**
   * A pane's live view, as the commands that act on its TEXT see it (read
   * X2). Registered and dropped with the view like the capture above, so
   * `Mod+L` reaches whichever pane holds the focus without the controller
   * ever learning what a CodeMirror is.
   */
  registerEditor(paneId: string, editor: PaneEditor | null): void
  /**
   * Insert text at the focused pane's caret (`template.insert`, quiet-shell
   * F11). False when no live, editable note holds the focus.
   */
  insertText(text: string): boolean
  /**
   * The resolved keymap's `format.*` chords (F10), handed to every live view
   * now and to each one as it registers — so a keymap that clears
   * `format.bold` takes `Mod-b` out of CodeMirror too.
   */
  setFormatBindings(bindings: FormatBindings): void
  beginDrag(e: PointerEvent, payload: DragPayload): void

  // ---- view modes (read-shaping B3) ----
  /** The `view.*` and `edit.toggle-checkbox` rows of the command table. */
  readCommands(): Command[]
  /** The `format.*` rows (quiet-shell F4), run in the focused pane's view. */
  formatCommands(): Command[]
  /** The `table.*` rows (E4), offered while the focused view's caret is in a table. */
  tableCommands(): Command[]
  /** A tab's mode — its own, or the Settings default when it has none. */
  modeOf(tab: Tab | null): ViewMode
  setMode(tabId: string, mode: ViewMode): void
  /**
   * Obsidian's `Mod+E` pair on one tab: editing ↔ Reading, back to whichever
   * of Live/Source it last had. One method rather than a rule the strip
   * button and the command each apply, so both remember the same way.
   */
  toggleReading(tabId: string): void

  // ---- the file tree as a drag source (P1.2) ----
  /**
   * A native drag is hovering a pane at `x, y`. The tree is an HTML5 drag
   * source and the strip is a pointer-drag surface, so these three calls are
   * the bridge: same hit test, same indicator, same outcomes — a tree row
   * behaves exactly like a tab.
   */
  hoverExternal(x: number, y: number): void
  /** The native drag left the pane; drop the indicator without applying it. */
  leaveExternal(): void
  /** It was let go here: open `path` wherever the live target says. */
  dropExternal(path: string): void

  // ---- groups (W2, B4/B8) ----
  /** A new group holding `tabId`; answers its id so the caller can name it. */
  newGroup(tabId: string, paneId: string): string | null
  addToGroup(tabId: string, groupId: string): void
  removeFromGroup(tabId: string): void
  renameGroup(groupId: string, name: string): void
  recolorGroup(groupId: string, color: GroupColor): void
  toggleGroup(groupId: string): void
  /**
   * To the list, not away (R2.2) — the ONE path *Close group* takes, whether
   * it came from the chip's popover, a tab's menu or the mode, so a group can
   * never be closed without landing in `savedGroups`.
   */
  closeGroup(groupId: string): void
  ungroupGroup(groupId: string): void
  /** The one destructive op; the caller confirms first (B4). */
  deleteGroup(groupId: string): void
  newTabInGroup(groupId: string): void
  /**
   * Move a whole group to another pane — the keyboard and menu equivalent of
   * dragging its chip there (R8: no gesture is drag-only).
   */
  moveGroupToPane(groupId: string, paneId: string): void
  /** Reopen a saved group and drop it from the list — no duplicate on reopen. */
  openSavedGroup(savedId: string, paneId?: string): void
  groupFromLinks(name: string, paths: readonly string[], paneId?: string): void
  /** The group holding the focused pane's active tab, or null. */
  activeGroup(): Group | null
  findGroup(groupId: string): Group | null
  groupPaths(groupId: string): string[]

  // ---- vault events (B6/R5) ----
  onRenamed(moves: { from: string; to: string }[]): void
  closeUnder(prefix: string): void
  /** Capture the active view's resume point into its tab (B2). */
  setResume(tabId: string, resume: Resume): void
}

export function createPanes(
  clock: Clock,
  registry: CommandRegistry,
  ids: () => string = tree.nextId
): PaneShell {
  let workspace = $state.raw<Workspace | null>(null)
  let vaultKey = ''
  /**
   * The tree, twice on purpose.
   *
   * `current` is what every op reads and writes; `rendered` is the signal the
   * components render. They are always the same object — but Svelte runs an
   * effect's TEARDOWN with the values the effect last saw, and the resume
   * point (B2) is captured in exactly such a teardown. Reading the signal
   * there would hand an op the tree as it was before the tab switch that is
   * tearing the view down, and the op would then write that stale tree back.
   */
  let current: Layout = tree.createLayout(ids)
  let rendered = $state.raw<Layout>(current)
  let savedGroups = $state.raw<SavedGroup[]>([])
  let mode = $state.raw<Mode | null>(null)
  let modeKeysOpen = $state(false)
  let drag = $state.raw<DragState | null>(null)
  /** Closed-tab stack for `tab.reopen`, newest last; session-only. */
  const closed: ClosedTab[] = []
  const paneEls = new Map<string, HTMLElement>()
  /**
   * Each pane's last box measured while the layout was NOT zoomed.
   *
   * A zoom unmounts every other pane and gives the survivor the whole editor
   * area, so live boxes would say every pane is in the same place and
   * `neighbour` would answer nothing — which used to make the whole
   * focus/move/resize family dead while zoomed.
   */
  const lastRects = new Map<string, Rect>()
  const captures = new Map<string, () => Resume | null>()
  let cancelSave: (() => void) | null = null

  const now = (): number => clock.now()

  /**
   * Pull every live view's cursor and scroll into the tree, before something
   * reads them. See `registerCapture`: a view reports on teardown, which is
   * after `closeGroup`/`closePane` have already snapshotted the tab, and
   * after the debounced write has already gone out.
   */
  function captureLive(): void {
    let next = current
    for (const [paneId, capture] of captures) {
      const p = tree.findPane(next, paneId)
      const t = p ? tree.activeTab(p) : null
      if (!t) continue
      const resume = capture()
      if (!resume || sameResume(t, resume)) continue
      next = tree.editLayout(next, (d) => {
        const dt = tree.tabOf(d, t.id)
        if (!dt) return
        dt.cursor = { ...resume.cursor }
        dt.scroll = resume.scroll
      })
    }
    if (next !== current) commit(next)
  }

  const sameResume = (t: Tab, r: Resume): boolean =>
    t.scroll === r.scroll && t.cursor?.anchor === r.cursor.anchor && t.cursor?.head === r.cursor.head

  function flushSave(): void {
    // `captureLive` may commit, which schedules another save; cancelling
    // AFTER it rather than before is what keeps this to one write.
    captureLive()
    cancelSave?.()
    cancelSave = null
    // Both halves, from memory, in one write (M2): a saved-group write that
    // re-read the debounced layout half — or the other way round — is how
    // *Open saved group* could leave a group in neither (R2.2).
    if (vaultKey) saveWorkspace(vaultKey, current, savedGroups)
  }

  function scheduleSave(): void {
    cancelSave?.()
    cancelSave = clock.schedule(() => {
      cancelSave = null
      flushSave()
    }, SAVE_DEBOUNCE_MS)
  }

  /** The one way the tree changes: set it, then let the derivations catch up. */
  function commit(next: Layout): void {
    current = next
    rendered = next
    scheduleSave()
  }

  function keepSaved(groups: readonly SavedGroup[]): void {
    if (!groups.length) return
    savedGroups = [...groups, ...savedGroups]
    scheduleSave()
  }

  /** Taking a group out of the list, which is what reopening one does. */
  function dropSaved(savedId: string): void {
    const next = savedGroups.filter((g) => g.id !== savedId)
    if (next.length === savedGroups.length) return
    savedGroups = next
    scheduleSave()
  }

  /**
   * The group the `group.*` verbs act on: the one holding the focused pane's
   * active tab, else the pane's most recently used group.
   *
   * The fallback is what makes fold and unfold the same key — folding a group
   * moves the active tab OUT of it (a folded tab has no view to sit in), so
   * without it `group.toggle` could fold but never unfold.
   */
  function activeGroup(): Group | null {
    // Through the RENDER signal, not the plain mirror: this is asked from a
    // `$derived` (the `group.*` guards, the popover) as well as from an op, so
    // it has to re-run when the tree changes. `findGroup` reads the same way.
    const p = tree.focusedPane(rendered)
    const held = p.active ? tree.groupOf(p, p.active) : null
    if (held) return held
    return [...p.groups].sort((a, b) => b.lastActive - a.lastActive)[0] ?? null
  }

  function closeGroupById(groupId: string): void {
    // A group closed is a group SAVED (R2.2), so it has to carry the cursor
    // the note is actually at, not the one it was at when the tab last lost
    // its view.
    captureLive()
    const { layout: next, saved } = groupOps.closeGroup(current, groupId, ids, now())
    if (saved) keepSaved([saved])
    commit(next)
  }

  const focused = (): Pane => tree.focusedPane(current)
  const active = (): Tab | null => tree.activeTab(focused())

  // ---- view modes (read-shaping B3, Fork 2-A) ----

  /**
   * Per tab, the mode it was in before Reading — what `Mod+E` comes back to.
   * Session-only on purpose: it is a "where was I a moment ago", and a tab
   * reopened tomorrow should follow the preference, not a stale keystroke.
   */
  const lastEditing = new Map<string, ViewMode>()
  const editors = new Map<string, PaneEditor>()
  /** The resolved keymap's format chords; null until a keymap was applied (the editor's defaults hold). */
  let formatBindings: FormatBindings | null = null

  const modeOf = (tab: Tab | null): ViewMode => tab?.mode ?? readState.defaultMode

  function applyMode(tabId: string, mode: ViewMode): void {
    const t = tree.tabOf(current, tabId)
    if (!t) return
    const from = modeOf(t)
    if (mode === 'reading' && from !== 'reading') lastEditing.set(tabId, from)
    commit(tree.setMode(current, tabId, mode))
  }

  function toggleReadingOf(tabId: string): void {
    const t = tree.tabOf(current, tabId)
    if (t) applyMode(t.id, afterToggleReading(modeOf(t), lastEditing.get(t.id)))
  }

  function rects(): Record<string, Rect> {
    if (current.zoom === null) {
      for (const [id, el] of paneEls) {
        const r = el.getBoundingClientRect()
        lastRects.set(id, { x: r.x, y: r.y, width: r.width, height: r.height })
      }
    }
    const out: Record<string, Rect> = {}
    for (const p of tree.panes(current.tree)) {
      const r = lastRects.get(p.id)
      if (r) out[p.id] = r
    }
    return out
  }

  // ---- what the rest of the app reads off a current change (B3, S9-Q1) ----

  $effect(() => {
    const l = rendered
    const ws = workspace
    if (!ws) return
    ws.setLiveViews(new Set(tree.liveGuidsInput(l).map((v) => v.path)))
    // Not a second source of truth: one derived value, so the rail, the
    // breadcrumb, the links panel and the index keep the API they had.
    ws.ui.selectedPath = tree.activeTab(tree.focusedPane(l))?.path ?? null
  })

  /**
   * Deleted notes take their tabs and their history entries with them (R5) —
   * but only once the file list has SETTLED.
   *
   * Carve, unshare and unmount take mounts out of the registry and put them
   * back a few awaits later, and the tree refreshes in between: acting on
   * that intermediate list would close every tab of a vault that is merely
   * being rebuilt. So the check is debounced through the injected clock and
   * re-reads the list when it fires. A rename never reaches here at all — it
   * lands through `onRenamed`, in the same synchronous turn.
   */
  const PRUNE_SETTLE_MS = 400
  let lastLive = ''
  let cancelPrune: (() => void) | null = null
  /** A halved file list a first pass saw and refused to act on (see below). */
  let shrinkSeen = ''
  const livePaths = (ws: Workspace): string[] => textPaths(ws.ui.files)
  const liveKey = (paths: readonly string[]): string => [...paths].sort().join('|')

  $effect(() => {
    const ws = workspace
    if (!ws) return
    // `ui.settling` is true while the vault is booting or a mount is being
    // carved, unshared, linked or absorbed. Those take mounts out of the
    // registry and put them back seconds later (a first join pulls a whole
    // room — 11 s measured), and the tree refreshes in between. The 400 ms
    // quiet period alone does not outlast that, so a near-empty intermediate
    // list would close every tab of a vault that is merely being rebuilt.
    // Reading it here is what re-arms the check when it flips back.
    const settling = ws.ui.settling
    const key = liveKey(livePaths(ws))
    if (settling || key === lastLive) return
    cancelPrune?.()
    cancelPrune = clock.schedule(() => {
      cancelPrune = null
      untrack(() => prunePass(ws))
    }, PRUNE_SETTLE_MS)
  })

  /** The debounced check itself — re-reads the list, because it may have moved. */
  function prunePass(ws: Workspace): void {
    const paths = livePaths(ws)
    const key = liveKey(paths)
    if (ws.ui.settling) return
    // Belt and braces behind `settling`: a live set that just lost more than
    // half of itself is far likelier to be a vault mid-rebuild than a hundred
    // notes deleted at once, so it has to say the same thing twice.
    const before = lastLive ? lastLive.split('|').length : 0
    if (before > 0 && paths.length * 2 < before && shrinkSeen !== key) {
      shrinkSeen = key
      cancelPrune = clock.schedule(() => {
        cancelPrune = null
        untrack(() => prunePass(ws))
      }, PRUNE_SETTLE_MS)
      return
    }
    shrinkSeen = ''
    lastLive = key
    const next = tree.prune(current, new Set(paths), ids)
    if (JSON.stringify(tree.serialize(next)) !== JSON.stringify(tree.serialize(current))) {
      commit(next)
    }
  }

  // ---- the command table's actions ----

  function splitFocused(dir: Dir): void {
    commit(tree.split(current, current.focus, dir, ids))
  }

  function focusSide(side: Side): void {
    const next = tree.neighbour(current, current.focus, side, rects())
    if (next) commit(tree.focusPane(current, next))
  }

  const actions = {
    splitAuto: (): void => {
      // The longer side splits, so a wide pane halves horizontally — the mock's
      // rule, and tmux's.
      const r = paneEls.get(current.focus)?.getBoundingClientRect()
      splitFocused(r && r.width > r.height * 1.2 ? 'row' : 'col')
    },
    split: splitFocused,
    closePane: (): void => closePaneById(current.focus),
    focus: focusSide,
    focusNext: (): void => commit(tree.focusNext(current)),
    zoom: (): void => commit(tree.zoom(current, current.zoom ? null : current.focus)),
    rotate: (): void => commit(tree.rotate(current, current.focus)),
    movePane: (side: Side): void => {
      const other = tree.neighbour(current, current.focus, side, rects())
      if (other) commit(tree.swapPanes(current, current.focus, other))
    },
    resizePane: (side: Side): void =>
      commit(tree.resizeBy(current, current.focus, side, RESIZE_STEP_PCT)),
    equalize: (): void => commit(tree.equalize(current)),
    closeOthers: (): void => closeOthersIn(current.focus),
    enterMode: (): void => {
      // A mode swallows every key until Escape, so it must not start while a
      // field or a dialog owns the keyboard (M4).
      if (keyboardClaimed()) return
      mode = 'pane'
      modeKeysOpen = false
    },
    newTab: (): void => newTabIn(current.focus),
    closeTab: (): void => {
      const t = active()
      if (t && !t.pinned) closeTab(t.id)
    },
    stepTab: (delta: number): void => {
      const p = focused()
      const list = tree.visibleTabs(p)
      const at = list.findIndex((t) => t.id === p.active)
      const next = list[(at + delta + list.length) % list.length]
      if (next) commit(tree.activate(current, p.id, next.id, now()))
    },
    gotoTab: (n: number): void => {
      const p = focused()
      // The strip as DRAWN: a folded group's tabs are not on screen, so they
      // cannot be the third one. `stepTab` counts the same way.
      const t = tree.visibleTabs(p)[n - 1]
      if (t) commit(tree.activate(current, p.id, t.id, now()))
    },
    moveTabTo: (side: Side): void => {
      const t = active()
      const other = tree.neighbour(current, current.focus, side, rects())
      if (t && other) commit(tree.moveTab(current, t.id, other, undefined, undefined, ids, now()))
    },
    pinTab: (): void => {
      const t = active()
      if (t) togglePin(t.id)
    },
    reopenTab: (): void => {
      const last = closed.pop()
      if (last) commit(tree.reopenTab(current, last, ids, now()))
    },
  }

  // ---- strip affordances ----

  function closeTab(tabId: string): void {
    captureLive()
    const snapshot = tree.closedTabOf(current, tabId)
    if (snapshot?.tab.path) closed.push(snapshot)
    commit(tree.closeTab(current, tabId, ids))
  }

  function togglePin(tabId: string): void {
    commit(
      tree.editLayout(current, (d) => {
        const t = tree.tabOf(d, tabId)
        if (t) t.pinned = !t.pinned
      })
    )
  }

  function newTabIn(paneId: string): void {
    commit(
      tree.editLayout(current, (d) => {
        const p = tree.findPane(d, paneId)
        if (!p) return
        const t = tree.insertTab(p, tree.newTab(ids), tree.activeTab(p)?.id ?? null)
        p.active = t.id
        d.focus = p.id
      })
    )
  }

  function closeOthersIn(paneId: string): void {
    captureLive()
    const { layout: next, saved } = tree.closeOthers(current, paneId, ids, now())
    keepSaved(saved)
    commit(next)
  }

  function closePaneById(paneId: string): void {
    captureLive()
    const { layout: next, saved } = tree.closePane(current, paneId, now())
    keepSaved(saved)
    commit(next)
  }

  // ---- the drag session (B10) ----

  function hitTest(x: number, y: number, payload: DragPayload): DropTarget | null {
    const hit = document.elementFromPoint(x, y)
    const el = hit instanceof Element ? hit.closest<HTMLElement>('[data-pane-id]') : null
    const paneId = el?.dataset.paneId
    const pane = paneId ? tree.findPane(current, paneId) : null
    if (!el || !paneId || !pane) return null

    const strip = el.querySelector<HTMLElement>('[data-strip]')
    const sr = strip?.getBoundingClientRect()
    if (strip && sr && y >= sr.top && y <= sr.bottom) {
      const slots = slotsFrom(strip.querySelectorAll<HTMLElement>('[data-slot-index]'), (node) => {
        const r = node.getBoundingClientRect()
        return { left: r.left, right: r.right }
      })
      const spot = stripDrop(slots, x, pane.tabs.length, sr.left)
      return {
        kind: 'strip',
        paneId,
        at: spot.at,
        groupId: spot.groupId,
        color: pane.groups.find((g) => g.id === spot.groupId)?.color,
        x: spot.indicatorX,
        top: sr.top + 4,
        height: sr.height - 8,
      }
    }

    const r = el.getBoundingClientRect()
    const zone = tree.zoneAt({ x: r.x, y: r.y, width: r.width, height: r.height }, x, y)
    const whole = payload.fromPaneId === paneId && payload.tabIds.length === pane.tabs.length
    // Dissolving a pane onto its own edge would rebuild the same pane; joining
    // the strip you came from is a reorder, and that is the strip's job.
    if (payload.fromPaneId === paneId && (zone === 'center' || whole)) return { kind: 'none' }
    return { kind: 'zone', paneId, zone, box: zoneBox(r, zone) }
  }

  function applyDrop(target: DropTarget, payload: DragPayload): void {
    if (target.kind === 'none') return
    // A chip drag moves the whole group, label and all (Decision 4). An edge
    // drop is `splitWith`'s job either way — it already carries a group into
    // the pane it makes — so only the strip and the centre are handled here.
    if (payload.groupId && target.kind === 'strip') {
      commit(groupOps.moveGroup(current, payload.groupId, target.paneId, target.at, ids, now()))
      return
    }
    if (payload.groupId && target.kind === 'zone' && target.zone === 'center') {
      commit(groupOps.moveGroup(current, payload.groupId, target.paneId, undefined, ids, now()))
      return
    }
    if (target.kind === 'strip') {
      let next = current
      payload.tabIds.forEach((tabId, i) => {
        next =
          payload.fromPaneId === target.paneId
            ? tree.reorder(next, target.paneId, tabId, target.at + i, target.groupId)
            : tree.moveTab(next, tabId, target.paneId, target.at + i, target.groupId, ids, now())
      })
      commit(next)
      return
    }
    if (target.zone === 'center') {
      let next = current
      for (const tabId of payload.tabIds) {
        next = tree.moveTab(next, tabId, target.paneId, undefined, undefined, ids, now())
      }
      commit(next)
      return
    }
    commit(
      tree.splitWith(current, target.paneId, target.zone, { tabIds: payload.tabIds }, ids, now())
    )
  }

  function beginDrag(e: PointerEvent, payload: DragPayload): void {
    if (e.button !== 0) return
    const startX = e.clientX
    const startY = e.clientY
    let live = false
    let cancelled = false

    const move = (ev: PointerEvent): void => {
      if (cancelled) return
      if (!live) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return
        live = true
        // A global hotkey landing mid-drag would rearrange the tree under the
        // pointer; the registry is the one place that can be told to stop.
        registry.setSuspended(true)
      }
      drag = {
        payload,
        x: ev.clientX,
        y: ev.clientY,
        target: hitTest(ev.clientX, ev.clientY, payload),
      }
    }

    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', done)
      window.removeEventListener('pointercancel', done)
      window.removeEventListener('keydown', onKey, true)
      drag = null
      if (live) registry.setSuspended(false)
    }

    const done = (ev: PointerEvent): void => {
      const state = drag
      const wasLive = live
      stop()
      if (cancelled || !wasLive) return
      if (state?.target && ev.type === 'pointerup') applyDrop(state.target, payload)
    }

    // Escape abandons the drag, as it does in every file manager: the ghost
    // goes, the hotkeys come back, and the pointer-up that follows drops
    // nothing (Minor 9).
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return
      ev.preventDefault()
      ev.stopPropagation()
      cancelled = true
      stop()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', done)
    window.addEventListener('pointercancel', done)
    window.addEventListener('keydown', onKey, true)
  }

  // ---- the file tree as a drag source (P1.2) ----

  function hoverExternal(x: number, y: number): void {
    // A pointer drag owns the session until it ends: the two cannot both be
    // live, and the one with tabs in it is the one whose `pointerup` will
    // apply a target. Overwriting it here would hand that drop the geometry
    // computed for a payload it is not carrying.
    if (drag && !drag.payload.external) return
    // No tabs, no source pane, no label: a tree row is a PATH readable only on
    // `drop`, the browser draws its own ghost (so nothing prints a label), and
    // the geometry is all the hit test needs.
    const payload: DragPayload = {
      tabIds: [],
      fromPaneId: '',
      groupId: null,
      label: '',
      color: null,
      external: true,
    }
    drag = { payload, x, y, target: hitTest(x, y, payload) }
  }

  function leaveExternal(): void {
    if (drag?.payload.external) drag = null
  }

  function dropExternal(path: string): void {
    const target = drag?.payload.external ? drag.target : null
    drag = null
    if (!target || target.kind === 'none') return
    if (target.kind === 'strip') {
      commit(
        tree.openPathAt(
          current,
          path,
          { paneId: target.paneId, index: target.at, groupId: target.groupId },
          ids,
          now()
        )
      )
      return
    }
    if (target.zone === 'center') {
      commit(tree.openPath(current, path, { paneId: target.paneId }, ids, now()))
      return
    }
    // An edge makes a pane, and `splitWith` is the only op that does — it
    // moves tabs that already exist. So the note opens at the end of the
    // target's strip first, and that fresh tab is what gets carried out.
    const opened = tree.openPathAt(current, path, { paneId: target.paneId }, ids, now())
    const landed = tree.findPane(opened, target.paneId)?.tabs.find((t) => t.path === path)
    if (!landed) return
    commit(tree.splitWith(opened, target.paneId, target.zone, { tabIds: [landed.id] }, ids, now()))
  }

  // ---- the mode (B12) ----

  function titleOf(id: string): string {
    return registry.get(id)?.title ?? familyTitle(id)
  }

  const runnable = (id: string): boolean => {
    const c = registry.get(id)
    return c !== undefined && (!c.when || c.when())
  }

  /** A collapsed row survives while ANY of the commands it stands for does. */
  const runnableRow = (h: Hint): boolean => h.ids.length === 0 || h.ids.some(runnable)

  return {
    get layout() {
      return rendered
    },
    get savedGroups() {
      return savedGroups
    },
    get mode() {
      return mode
    },
    get modeKeysOpen() {
      return modeKeysOpen
    },
    get drag() {
      return drag
    },

    paneIndex: (paneId) => tree.panes(current.tree).findIndex((p) => p.id === paneId) + 1,

    commands: () => paneCommands(actions),

    readCommands: () =>
      readCommands({
        hasNote: () => active()?.path != null,
        // Every `view.*` command acts on the tab the keyboard is in.
        mode: () => modeOf(active()),
        setMode: (mode) => {
          const t = active()
          if (t) applyMode(t.id, mode)
        },
        toggleReading: () => {
          const t = active()
          if (t) toggleReadingOf(t.id)
        },
        toggleSource: () => {
          const t = active()
          if (t) applyMode(t.id, afterToggleSource(modeOf(t)))
        },
        toggleCheckbox: () => void editors.get(current.focus)?.toggleTask(),
      }),

    formatCommands: () =>
      formatCommands({
        // A note, with a live view to act on, that is not being read.
        canFormat: () => {
          const t = active()
          return t?.path != null && modeOf(t) !== 'reading' && editors.has(current.focus)
        },
        format: (id) => void editors.get(current.focus)?.format(id),
      }),

    tableCommands: () =>
      tableCommands({
        canFormat: () => {
          const t = active()
          return t?.path != null && modeOf(t) !== 'reading' && editors.has(current.focus)
        },
        inTable: () => editors.get(current.focus)?.inTable?.() ?? false,
        table: (id) => void editors.get(current.focus)?.table?.(id),
      }),

    modeOf,
    setMode: applyMode,
    toggleReading: toggleReadingOf,

    hints: () =>
      mode
        ? // A row is printed only if it does something: no title means the
          // command is not registered, and a `when` that says no means the key
          // is refused (the `group.*` verbs with no group to act on). The bar
          // must not advertise a key that does nothing.
          modeHints(mode, titleOf).filter((h) => h.label !== '' && runnableRow(h))
        : [],

    escapeLabel: () => {
      const t = getLL().web.mode
      return mode && MODES[mode].sticky ? t.done() : t.leave()
    },

    modeBadge: () => (mode ? getLL().web.mode.names[mode]() : ''),

    attach(next, key) {
      cancelSave?.()
      cancelSave = null
      cancelPrune?.()
      cancelPrune = null
      workspace = next
      vaultKey = key
      lastLive = ''
      shrinkSeen = ''
      lastRects.clear()
      closed.length = 0
      if (!next) {
        commit(tree.createLayout(ids))
        savedGroups = []
        return
      }
      const live = new Set(textPaths(next.ui.files))
      const stored = loadLayout(key, ids)
      // A restored tree is checked against the vault before it is shown, so a
      // note deleted in Obsidian while this device was closed cannot open (R5).
      commit(stored ? tree.prune(stored, live, ids) : tree.createLayout(ids))
      savedGroups = loadSavedGroups(key)
    },

    handleKey(e) {
      if (!mode) return false
      // A chord is not a mode letter: `step` matches on `key` alone, so
      // `Mod+W` in pane mode used to run *rotate* and a second `Mod+P`
      // *focus next*. Let it through to the registry instead (Minor 7).
      if (e.ctrlKey || e.metaKey || e.altKey) return false
      // …and a mode must never eat what a field or a dialog is being typed
      // into. Leaving the mode is the honest answer: the keyboard has moved on.
      if (keyboardClaimed()) {
        mode = null
        return false
      }
      // Capture phase + preventDefault: a mode letter is never editor input.
      e.preventDefault()
      e.stopPropagation()
      // `?` (E6): every key of the mode, or back to the short line. Not a
      // mode letter, so the mode stays.
      if (e.key === '?') {
        modeKeysOpen = !modeKeysOpen
        return true
      }
      const next = modeStep(mode, e.key)
      mode = next.mode
      if (next.command) {
        // A guarded-off command (the `group.*` verbs with no group to act on)
        // is not runnable from its key, so it must not be runnable from its
        // mode letter either.
        const command = registry.get(next.command)
        if (command && (!command.when || command.when())) void command.run()
      }
      return true
    },

    leaveMode() {
      mode = null
    },

    open(path, opts = {}) {
      const p = opts.paneId ? tree.findPane(current, opts.paneId) : focused()
      const slot = p ? tree.activeTab(p) : null
      // An empty tab is a slot waiting for a note (that is what its picker is
      // for), so a foreground open fills it rather than leaving it behind.
      if (!opts.background && p && slot && slot.path === null && !slot.view) {
        commit(tree.navigateInTab(current, slot.id, path, now()))
        return
      }
      // Replacing leaves the note on the tab's Back trail: where the view is
      // NOW is what that trail entry keeps, exactly as `navigate` does.
      if (opts.replace && !opts.background) captureLive()
      commit(tree.openPath(current, path, opts, ids, now()))
    },

    openView(view, arg) {
      commit(tree.openView(current, view, arg === undefined ? {} : { arg }, ids, now()))
    },

    navigate(path, tabId) {
      const t = tabId ?? active()?.id
      if (!t) return
      // Where the view is NOW is what the trail entry being left keeps, so
      // Back lands on the line the link was followed from (R2.3).
      captureLive()
      commit(tree.navigateInTab(current, t, path, now()))
    },

    travel(delta) {
      const t = active()
      if (!t) return
      captureLive()
      commit(tree.travelTab(current, t.id, delta, now()))
    },

    canTravel: (delta) => tree.canTravel(active(), delta),

    activate: (paneId, tabId) => commit(tree.activate(current, paneId, tabId, now())),
    focusPane: (paneId) => {
      if (paneId !== current.focus) commit(tree.focusPane(current, paneId))
    },
    closeTab,
    togglePin,
    newTabIn,
    closeOthersIn,
    closePaneById,
    moveTabToPane: (tabId, paneId) =>
      commit(tree.moveTab(current, tabId, paneId, undefined, undefined, ids, now())),

    neighbourPane: (side) => tree.neighbour(current, current.focus, side, rects()),
    moveGroupToPane: (groupId, paneId) => {
      if (!tree.findPane(current, paneId)) return
      commit(groupOps.moveGroup(current, groupId, paneId, undefined, ids, now()))
    },

    resizeSplit(splitId, index, deltaPct) {
      commit(tree.resize(current, splitId, index, deltaPct))
    },

    // A resize is a stream of tiny commits; the debounce keeps them off
    // storage, and the gesture's end is what makes the result durable — the
    // navigator's rule (chrome U2), so a reload right after a drag is safe.
    persistNow: flushSave,

    registerPane(paneId, el) {
      if (el) paneEls.set(paneId, el)
      else paneEls.delete(paneId)
    },

    insertText(text) {
      const t = active()
      if (t?.path == null || modeOf(t) === 'reading') return false
      return editors.get(current.focus)?.insertText?.(text) ?? false
    },

    setFormatBindings(bindings) {
      formatBindings = bindings
      for (const editor of editors.values()) editor.setFormatBindings?.(bindings)
    },

    registerCapture(paneId, capture) {
      if (capture) captures.set(paneId, capture)
      else captures.delete(paneId)
    },

    registerEditor(paneId, editor) {
      if (editor) {
        editors.set(paneId, editor)
        if (formatBindings) editor.setFormatBindings?.(formatBindings)
      } else editors.delete(paneId)
    },

    beginDrag,
    hoverExternal,
    leaveExternal,
    dropExternal,

    newGroup(tabId, paneId) {
      commit(groupOps.newGroup(current, paneId, tabId, ids, '', now()))
      const p = tree.findPane(current, paneId)
      return p ? (tree.groupOf(p, tabId)?.id ?? null) : null
    },
    addToGroup: (tabId, groupId) => commit(groupOps.addToGroup(current, tabId, groupId)),
    removeFromGroup: (tabId) => commit(groupOps.removeFromGroup(current, tabId)),
    renameGroup: (groupId, name) => commit(groupOps.renameGroup(current, groupId, name)),
    recolorGroup: (groupId, color) => commit(groupOps.recolor(current, groupId, color)),
    toggleGroup: (groupId) => commit(groupOps.toggleCollapsed(current, groupId, ids, now())),
    closeGroup: closeGroupById,
    ungroupGroup: (groupId) => commit(groupOps.ungroup(current, groupId)),
    deleteGroup: (groupId) => commit(groupOps.deleteGroup(current, groupId, ids)),

    newTabInGroup(groupId) {
      const found = tree.findGroup(current, groupId)
      if (!found) return
      const { pane: p, group: g } = found
      commit(
        tree.editLayout(current, (d) => {
          const dp = tree.findPane(d, p.id)
          if (!dp) return
          // After the group's LAST tab, so the new tab lands inside the run
          // rather than beside it (`insertTab` joins the tab it follows).
          const t = tree.insertTab(dp, tree.newTab(ids), g.tabIds[g.tabIds.length - 1] ?? null)
          dp.active = t.id
          d.focus = dp.id
        })
      )
    },

    openSavedGroup(savedId, paneId) {
      const saved = savedGroups.find((g) => g.id === savedId)
      if (!saved) return
      commit(groupOps.openSaved(current, paneId ?? current.focus, saved, ids, now()))
      // Out of the list the moment it is back on a strip: the two places a
      // group can be are exclusive, so reopening twice cannot double it.
      dropSaved(savedId)
    },

    groupFromLinks: (name, paths, paneId) =>
      commit(groupOps.groupFromLinks(current, paneId ?? current.focus, name, [...paths], ids, now())),

    activeGroup,
    // Read through the RENDER signal, not the plain mirror: this one is asked
    // from a `$derived` (the popover follows the group it is open on), so it
    // has to re-run when the tree changes. Ops keep reading `current` — see
    // the note on the pair above.
    findGroup: (groupId) => tree.findGroup(rendered, groupId)?.group ?? null,
    groupPaths: (groupId) => groupOps.groupPaths(current, groupId),

    onRenamed(moves) {
      let next = current
      for (const { from, to } of moves) next = tree.rename(next, from, to, ids)
      commit(next)
      // A rename is also a new file set; keep the prune effect from re-running
      // over the pre-rename snapshot.
      lastLive = ''
      flushSave()
    },

    closeUnder(prefix) {
      commit(tree.closeUnder(current, prefix, ids))
    },

    setResume(tabId, resume) {
      const held = tree.tabOf(current, tabId)
      if (!held) return
      // A capture that says nothing new is not a layout change: re-committing
      // the same cursor on every tab switch would churn the tree, and the
      // save, for nothing.
      if (sameResume(held, resume)) return
      commit(
        tree.editLayout(current, (d) => {
          const t = tree.tabOf(d, tabId)
          if (!t) return
          t.cursor = { ...resume.cursor }
          t.scroll = resume.scroll
        })
      )
    },
  }
}
