/**
 * The shell's chrome state (chrome U2, U5; quiet-shell F1/F2): the active
 * layout's resolved spec, which columns are open and how wide, which dock
 * tab is active, and the notice bookkeeping that hangs off them —
 * what has toasted, what counts as unread.
 *
 * The spec is what the shell renders from (`layout-spec.ts`), resolved
 * through the resource roots (`resources.svelte.ts`). The column toggles
 * are SEEDED from it — on a new tab, on a pick, on `app.reload-resources`
 * and whenever the spec's column regions change — and are session-only
 * after that: kept in this tab's sessionStorage (so a page reload keeps
 * them), never in config and never in the layout file (Settings › Layout
 * is the only writer of that). Persisted like the theme (`config.ts`): the active layout's NAME
 * and the width only when a resize gesture ENDS. The pure half — clamping,
 * the dock's tab ids — is `layout.ts`.
 */
import { untrack } from 'svelte'
import { getLL } from '@ohhi/i18n'
import {
  drawerSeenAt,
  layoutOverrides,
  layoutPins,
  layoutPrefs,
  setDrawerSeenAt,
  setLayoutOverrides,
  setLayoutPins,
  setLayoutPrefs,
} from './config.js'
import { layoutName, railSection, type LayoutChoice, type RailSectionId } from './layout.js'
import {
  NO_OVERRIDES,
  PRESETS,
  applyOverrides,
  shippedSpec,
  type LayoutFile,
  type RegionId,
  type ShellSpec,
} from './layout-spec.js'
import { paneChrome, type PaneChrome } from './pane-chrome.js'
import { applyPins, withPin, type LayoutPins, type PinSide } from './pin-layout.js'
import type { ResolvedLayout, ResourceChange, ResourceEntry } from './resources.svelte.js'
import type { AppEvent } from '@ohhi/workspace'
import { describeEvent, toastsWhenLogged } from './event-text.js'
import { isForeignChange, type Flash } from './notices.js'
import { toast as showToast, type ToastData } from './ui/toaster.js'

/** What the layout needs from the rest of the shell. */
export interface LayoutHost {
  /** True while the workspace (not the manager or the connecting view) is showing. */
  inWorkspace(): boolean
  /** The session event log (`ui.events`), newest first; null between vaults. */
  events(): AppEvent[] | null
  /** Gesture feedback waiting to toast (`ui.flashes`), newest first. */
  flashes(): Flash[] | null
  /**
   * The identity of the log `events()` reads (the open workspace). A change
   * means a new log whose ids restart, so what has toasted is forgotten.
   */
  eventSource?(): unknown
  /**
   * When the open vault's session began (the workspace's injected clock);
   * null/absent → no floor. Stored history merged on a mount's open is older
   * than this: it is history, so it never toasts and never counts as unread.
   */
  sessionStart?(): number | null
  now(): number
  /** Injected so a test can see what toasted without a DOM. */
  toast?: (data: ToastData) => void
  /**
   * Resolves a layout choice through the resource roots, this device's
   * overrides and pins laid over it (`resources.resolveLayout`); absent →
   * the built-in (and the examples) only.
   */
  resolveLayout?: (active: LayoutChoice, pins: LayoutPins, overrides: LayoutFile) => Promise<ResolvedLayout>
  /** Where the device's pins live (Round 2, P7); absent → `config.layout.pins`. */
  pins?: { read(): LayoutPins; write(pins: LayoutPins): void }
  /** Where the device's layout overrides live (round 3, Q6); absent → `config.layout.overrides`. */
  overrides?: { read(): LayoutFile; write(overrides: LayoutFile): void }
  /** Re-list the resources (on reload); absent → nothing to list. */
  refreshResources?: () => Promise<unknown>
  /**
   * A session-only choice that wins over the stored one (`?layout=`, which the
   * e2e fixtures use to force the `dense` example). `clear` drops it when a
   * person picks a layout file.
   */
  layoutOverride?: { get(): LayoutChoice | null; clear(): void }
  /**
   * The layouts' change feed (`resources.onChange('layouts', …)`): another
   * vault (or none) and a change under `.ohhi/layouts/` re-resolve, keeping
   * this session's toggles; `app.reload-resources` re-resolves and re-seeds
   * them. Subscribed once, when the layout is made.
   */
  onLayoutsChange?: (cb: (why: ResourceChange) => void) => () => void
  /**
   * The open vault's room; null between vaults. When the drawer was last
   * opened is kept per device per vault under it (spike-one-log: the log
   * persists, so its read state does), so a warning from an earlier session
   * that was never looked at still counts.
   */
  room?: () => string | null
  /**
   * Where this tab keeps its column toggles across a page reload
   * (sessionStorage by default; null keeps nothing). Never config, never the file.
   */
  session?: Storage | null
}

export interface ShellLayout {
  /**
   * The resolved spec of the active layout — what Stage 2's renderers read
   * (`regions`, `bars`, `toolbar`, `panes`, `editor`, `focus`). Until they
   * land, `drawer` / `menu` / `merged` / `auto` render as a closed column, a
   * closed rail, today's strip and today's status bar.
   */
  readonly spec: ShellSpec
  /** The layout file in force: `default` or `custom:<name>`. */
  readonly active: LayoutChoice
  /** The active layout file's own spec, before this device's overrides and pins. */
  readonly fileSpec: ShellSpec
  /** The file's spec with this device's overrides — everything but the pins. */
  readonly ownSpec: ShellSpec
  /**
   * This device's overrides (round 3, Q6): Settings › Layout's edits, a
   * layout-file delta over the active file. Config, never a file.
   */
  readonly overrides: LayoutFile
  /** Replace the overrides: persisted, and the shell re-renders at once (live, under the dialog). */
  setOverrides(overrides: LayoutFile): void
  /** Drop every override (Settings › Layout › *Reset to default*). */
  resetOverrides(): void
  /** Where the active layout was read from; null when it fell back to the built-in default. */
  readonly source: ResourceEntry | null
  /**
   * The device's pins (Round 2, P7): the sides shown as a column whatever the
   * layout says. Config, never a file; applied over the spec after it resolves.
   */
  readonly pins: LayoutPins
  /** True when this device pins `side` as a column. */
  pinned(side: PinSide): boolean
  /** Pin `side` as a column (and open it); the other side is untouched. */
  pin(side: PinSide): void
  /** Return `side` to the layout's own setting (the drawer, the dock); the other side is untouched. */
  unpin(side: PinSide): void
  /** Drop every pin (Settings › Layout › *Reset pins*). */
  resetPins(): void
  /** Why the active layout fell back, when it did. */
  readonly specError: string | null
  /** Choose a layout file (the palette's *Use layout file…*): persisted as the device's choice, then applied. */
  setActive(choice: LayoutChoice): Promise<void>
  /** Re-read the roots and re-apply the spec, re-seeding the columns (`app.reload-resources`). */
  reload(): Promise<void>
  treeOpen: boolean
  treeWidth: number
  /**
   * The dock is open (Round 2 P4) — ONE state for both of its forms: the
   * floating panel over the editor (`regions.rail: "dock"`) and the pinned
   * column (`"column"`). Seeded from the spec like `treeOpen`. Closed, the
   * dock is the floating strip in either form (Round 3 Q3).
   */
  railOpen: boolean
  /** The dock's active tab — the same tab in the floating panel and the column. */
  railTab: RailSectionId
  /** A folder the breadcrumb (or a new-folder confirm) asked the navigator to show; new object per ask. */
  revealDir: { path: string } | null
  readonly linksVisible: boolean
  /**
   * The notification drawer (quiet-shell F13) is open. While it is, the log
   * reads as seen — including anything that arrives while it is open.
   */
  drawerOpen: boolean
  /**
   * When the drawer was last opened (the injected clock), kept per device per
   * vault (`host.room`); 0 when this vault's drawer was never opened here.
   */
  readonly lastSeenAt: number
  /**
   * Errors, warnings and changes by someone else (`isForeignChange`) logged
   * since `lastSeenAt` — or, for a vault whose drawer was never opened on this
   * device, since the session began. Other info never counts.
   */
  readonly unread: number
  /** Mark everything logged so far as seen (opening the drawer does this). */
  markSeen(): void
  /** Open the navigator and reveal this folder in it. */
  revealInTree(dir: string): void
  /** Open the dock on this tab (a non-tab id opens it where it was). */
  showSection(id: string): void
  /** The resize gesture ended: the width persists now, not per pointer move. */
  commitTreeWidth(): void
  /**
   * Focus mode (quiet-shell F7, Decision 6): a WINDOW state over the spec,
   * never saved — not in config, not in the session store, not in the file.
   * While it is on, every region outside `spec.focus.keep` hides: `treeOpen`
   * and `railOpen` read false (their own values are untouched and come back
   * on leaving), and the toolbar, header, strip and status bars ask
   * `focusKeeps`. Opening a hidden column (its toggle, a reveal) leaves it.
   */
  readonly focus: boolean
  /** Enter or leave Focus mode. */
  setFocus(on: boolean): void
  toggleFocus(): void
  /** True when `region` is on screen as far as Focus mode is concerned — always, outside it. */
  focusKeeps(region: RegionId): boolean
  /** The toolbar is the header (quiet-shell F5) and Focus mode has not hidden it (F7). */
  readonly toolbarShown: boolean
  /**
   * Which pane chrome the layout gives every pane (spike S21), with Focus mode
   * over it: status bars Focus mode hides read as merged, so the unfocused
   * panes' dots stay honest.
   */
  readonly paneChrome: PaneChrome
}

/**
 * What a spec seeds the column toggles from: `<navigator>|<rail>`. Each side
 * is seeded from its own half, so a change to one side's region (a pin)
 * never re-seeds the other's toggle.
 */
const seedKey = (spec: ShellSpec): string => `${spec.regions.navigator}|${spec.regions.rail}`
const seedSides = (key: string | undefined): [string, string] => {
  const [nav = '', rail = ''] = (key ?? '').split('|')
  return [nav, rail]
}

const K_SESSION_COLUMNS = 'ohhi:columns'

interface SessionColumns {
  seed: string
  treeOpen: boolean
  railOpen: boolean
}

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null
  } catch {
    return null
  }
}

function readSession(store: Storage | null): SessionColumns | null {
  try {
    const raw = JSON.parse(store?.getItem(K_SESSION_COLUMNS) ?? 'null') as Partial<SessionColumns> | null
    if (raw && typeof raw.seed === 'string' && typeof raw.treeOpen === 'boolean' && typeof raw.railOpen === 'boolean') {
      return raw as SessionColumns
    }
  } catch {
    /* garbage or no storage — seed from the spec */
  }
  return null
}

function writeSession(store: Storage | null, value: SessionColumns): void {
  try {
    store?.setItem(K_SESSION_COLUMNS, JSON.stringify(value))
  } catch {
    /* private mode — the toggles still hold for this page */
  }
}

export function createShellLayout(host: LayoutHost): ShellLayout {
  const saved = layoutPrefs()
  const session = host.session === undefined ? sessionStore() : host.session
  const pinStore = host.pins ?? { read: layoutPins, write: setLayoutPins }
  const overrideStore = host.overrides ?? { read: layoutOverrides, write: setLayoutOverrides }
  let pins = $state.raw<LayoutPins>(pinStore.read())
  let overrides = $state.raw<LayoutFile>(overrideStore.read())
  let active = $state<LayoutChoice>(host.layoutOverride?.get() ?? saved.active)
  /** What a choice paints before the roots answer: the built-in or an example by name, else the default. */
  const shipped = (choice: LayoutChoice): ShellSpec => shippedSpec(layoutName(choice)) ?? PRESETS.default
  // A built-in resolves synchronously, so the first paint is already right;
  // a custom file paints as the default until the roots answer. The
  // overrides and the pins are config, so they are right from the first paint too.
  let fileSpec = $state.raw<ShellSpec>(shipped(active))
  let ownSpec = $state.raw<ShellSpec>(applyOverrides(fileSpec, overrides))
  let spec = $state.raw<ShellSpec>(applyPins(ownSpec, pins))
  let source = $state.raw<ResourceEntry | null>(null)
  let specError = $state<string | null>(null)
  /** The column regions the toggles were last seeded from. */
  let seededFrom = seedKey(spec)
  // This tab's own toggles survive a page reload, each as long as it was
  // seeded from the same region; anything else starts from the spec.
  const kept = readSession(session)
  const [keptNav, keptRail] = seedSides(kept?.seed)
  const [nowNav, nowRail] = seedSides(seededFrom)
  let treeOpen = $state(kept && keptNav === nowNav ? kept.treeOpen : spec.regions.navigator === 'column')
  let treeWidth = $state(saved.treeWidth)
  let railOpen = $state(kept && keptRail === nowRail ? kept.railOpen : spec.regions.rail === 'column')
  let railTab = $state<RailSectionId>('links')
  let revealDir = $state<{ path: string } | null>(null)
  /** Focus mode: session-only, starts off on every boot (never persisted). */
  let focus = $state(false)
  const keeps = (region: RegionId): boolean => !focus || spec.focus.keep.includes(region)
  /** A hidden column asked for by name: Focus mode gives way rather than swallow the ask. */
  const reveal = (region: RegionId): void => {
    if (!keeps(region)) focus = false
  }

  /**
   * Take a resolved spec (the file's own; the overrides and the pins go over
   * it here). The toggles are re-seeded from it when `force`d (a pick,
   * `app.reload-resources`); otherwise EACH side is re-seeded only when its
   * own region changed — a vault opening with the same layout keeps what
   * this session toggled, and pinning (or overriding) one side never
   * re-seeds the other.
   */
  function apply(file: ShellSpec, force: boolean): void {
    fileSpec = file
    ownSpec = applyOverrides(file, overrides)
    const next = applyPins(ownSpec, pins)
    spec = next
    const key = seedKey(next)
    const [wasNav, wasRail] = seedSides(seededFrom)
    seededFrom = key
    if (force || wasNav !== next.regions.navigator) treeOpen = next.regions.navigator === 'column'
    if (force || wasRail !== next.regions.rail) railOpen = next.regions.rail === 'column'
  }

  /** Pin or unpin one side: config, then the spec re-applied — only that side's region (and toggle) moves. */
  function setPin(side: PinSide, on: boolean): void {
    pins = withPin(pins, side, on)
    pinStore.write(pins)
    apply(fileSpec, false)
    if (on) reveal(side)
  }

  /** Replace the overrides: config, then the spec re-applied at once — no read of the roots. */
  function writeOverrides(next: LayoutFile): void {
    overrides = next
    overrideStore.write(next)
    apply(fileSpec, false)
  }

  /** Only the newest resolve applies: a vault switch mid-read must not land the old vault's file. */
  let generation = 0
  async function resolve(force: boolean): Promise<void> {
    const gen = ++generation
    const choice = active
    void host.refreshResources?.()
    if (!host.resolveLayout) {
      if (gen === generation) apply(shipped(choice), force)
      return
    }
    const resolved = await host.resolveLayout(choice, pins, overrides)
    if (gen !== generation) return
    source = resolved.entry
    specError = resolved.error
    // The overrides and pins in force NOW go over the file's own spec (an
    // edit made while this read was in flight is not lost).
    apply(resolved.file ?? resolved.unpinned ?? resolved.spec, force)
  }
  const reload = (): Promise<void> => resolve(true)

  // A new vault (or none) re-resolves: its `.ohhi/layouts/` may hold the
  // active file, or shadow a built-in. A change under it re-applies;
  // `app.reload-resources` re-applies and re-seeds the columns.
  host.onLayoutsChange?.((why) => void resolve(why === 'reload'))

  // The toggles are this tab's: kept in sessionStorage, never in config and
  // never in the layout file.
  $effect(() => {
    writeSession(session, { seed: seededFrom, treeOpen, railOpen })
  })

  const linksVisible = $derived(railOpen && keeps('rail') && railTab === 'links')

  // The width persists when a resize gesture ENDS (ResizeHandle's onCommit),
  // not on every pointer move. The column toggles do not persist at all: the
  // layout seeds them.

  // ---- notices (chrome U5, spike S22 Stage 4a) ----
  // Logged events toast once each when they are errors or warnings (info
  // never toasts, and a code whose own surface shows it opts out); flashes —
  // gesture feedback, never logged — toast once each. Everything logged stays
  // in the Log view; the drawer shows the last errors and warnings.
  /**
   * When the drawer was last opened in this vault, on this device (F13);
   * null until it ever was. Re-read whenever another vault opens.
   */
  let seenAt = $state<number | null>(null)
  let drawerOpen = $state(false)
  $effect(() => {
    const room = host.room?.() ?? null
    seenAt = room === null ? null : drawerSeenAt(room)
  })
  // Errors, warnings and changes by someone else (`isForeignChange`, the
  // drawer list's own test) since it was last opened; a vault never opened
  // here counts from the session's start, so old history never badges.
  const unread = $derived.by(() => {
    const since = seenAt ?? host.sessionStart?.() ?? -Infinity
    return (host.events() ?? []).filter(
      (e) => e.at > since && (e.level === 'error' || e.level === 'warn' || isForeignChange(e))
    ).length
  })
  const markSeen = (): void => {
    seenAt = host.now()
    const room = host.room?.() ?? null
    if (room !== null) setDrawerSeenAt(room, seenAt)
  }
  const toolbarShown = $derived(spec.regions.header === 'toolbar' && keeps('toolbar'))
  const chrome = $derived(
    paneChrome(
      {
        regions: { ...spec.regions, statusbar: keeps('statusbar') ? spec.regions.statusbar : 'merged' },
        panes: spec.panes,
      },
      !keeps('tabs')
    )
  )
  const toast = host.toast ?? showToast

  /**
   * Once per event: a folded repeat keeps its id, so it does not toast again
   * (a relay refusal reported by every connection is one toast, and the log
   * carries the count). A new log — another vault — starts over.
   */
  let seenEvents = new Set<string>()
  let seenSource: unknown = undefined
  let seenFlashes = new Set<string>()

  $effect(() => {
    const events = host.events() ?? []
    const source = host.eventSource?.()
    if (source !== seenSource) {
      seenSource = source
      seenEvents = new Set()
    }
    // Stored history (a room log merged on mount open) predates the session:
    // it is read in the Log, never announced as if it just happened.
    const start = host.sessionStart?.() ?? -Infinity
    const fresh = events.filter((e) => !seenEvents.has(e.id) && e.at >= start)
    seenEvents = new Set(events.map((e) => e.id))
    // Oldest first, so two in one tick both toast, in the order they happened.
    for (const e of fresh.reverse()) {
      if (!toastsWhenLogged(e)) continue
      const LL = getLL()
      toast({ level: e.level, title: LL.web.notices.toast_title[e.level](), description: describeEvent(e, LL) })
    }
  })
  $effect(() => {
    const flashes = host.flashes() ?? []
    const fresh = flashes.filter((f) => !seenFlashes.has(f.id))
    seenFlashes = new Set(flashes.map((f) => f.id))
    for (const f of fresh.reverse()) {
      toast({ level: f.level, title: getLL().web.notices.toast_title[f.level](), description: f.text })
    }
  })
  $effect(() => {
    // Looking at the drawer reads it — including anything that arrives while it is open.
    host.events()
    if (drawerOpen && host.inWorkspace()) untrack(markSeen)
  })

  return {
    get spec() {
      return spec
    },
    get active() {
      return active
    },
    get fileSpec() {
      return fileSpec
    },
    get ownSpec() {
      return ownSpec
    },
    get overrides() {
      return overrides
    },
    setOverrides: writeOverrides,
    resetOverrides: () => writeOverrides(NO_OVERRIDES),
    get source() {
      return source
    },
    get pins() {
      return pins
    },
    pinned: (side) => pins[side] === 'column',
    pin: (side) => setPin(side, true),
    unpin: (side) => setPin(side, false),
    resetPins() {
      pins = {}
      pinStore.write(pins)
      apply(fileSpec, false)
    },
    get specError() {
      return specError
    },
    async setActive(choice) {
      host.layoutOverride?.clear()
      active = choice
      setLayoutPrefs({ active: choice })
      await reload()
    },
    reload,
    get treeOpen() {
      return treeOpen && keeps('navigator')
    },
    set treeOpen(next) {
      if (next) reveal('navigator')
      treeOpen = next
    },
    get treeWidth() {
      return treeWidth
    },
    set treeWidth(next) {
      treeWidth = next
    },
    get railOpen() {
      return railOpen && keeps('rail')
    },
    set railOpen(next) {
      if (next) reveal('rail')
      railOpen = next
    },
    get railTab() {
      return railTab
    },
    set railTab(next) {
      railTab = next
    },
    get revealDir() {
      return revealDir
    },
    set revealDir(next) {
      revealDir = next
    },
    get linksVisible() {
      return linksVisible
    },
    get drawerOpen() {
      return drawerOpen
    },
    set drawerOpen(next) {
      drawerOpen = next
      if (next) markSeen()
    },
    get lastSeenAt() {
      return seenAt ?? 0
    },
    get unread() {
      return unread
    },
    markSeen,
    revealInTree(dir) {
      reveal('navigator')
      treeOpen = true
      revealDir = { path: dir }
    },
    showSection(id) {
      reveal('rail')
      railOpen = true
      railTab = railSection(id) ?? railTab
    },
    commitTreeWidth() {
      setLayoutPrefs({ treeWidth })
    },
    get focus() {
      return focus
    },
    setFocus(on) {
      focus = on
    },
    toggleFocus() {
      focus = !focus
    },
    focusKeeps: keeps,
    get toolbarShown() {
      return toolbarShown
    },
    get paneChrome() {
      return chrome
    },
  }
}
