<script lang="ts">
  /**
   * The editor area (tab-groups B1, B5, W2): the pane tree, the mode bar
   * under it, and the one `PaneRender` context every pane reads — the index
   * queries, the word count, the link resolver, the empty tab's launcher and
   * the strip's three group seams. Built here, where `PaneTree` is rendered,
   * because a snippet has to live with the markup that renders it.
   *
   * The FLOATING LAYER (round 3, Q2/Q4) hangs over the FOCUSED PANE, as the
   * dock does over the area: the format bar as a pill at the pane's bottom
   * centre (`regions.format: "bottom"`) or under its strip (`"top"`), and the
   * corner status (`regions.status: "corner"`, `bars.status`) and the pane
   * mode's cue at its bottom right — on the format bar's row (the bar
   * shifting off-centre when it must), or above it when the pane is too
   * narrow for both (measured). The layer is positioned and sized on the
   * focused pane's box (measured; one pane is the whole stage), so in a split
   * the bar centres in the pane being edited, never over the divider, and
   * its fold (a container query on the layer) follows that pane's width.
   * Neither ever covers a note's last (or first) line: the layer's height
   * becomes `--ed-float-bottom` / `--ed-float-top` on this area, and every
   * CM6 scroller under it pads by that much (every pane alike, so focusing
   * another pane never reflows its text). The layer clears the pane's top tab
   * strip and bottom status bar.
   *
   * The layer is the NOTE's chrome (devtools-shaping D7, R10): it draws only
   * while the focused pane's active tab is a note (`focusedIsNote`). Focus a
   * view tab (Inspector, Log, Shared, Settings) or an empty tab and the format
   * bar and the corner go, the scrollers pad nothing, and the dock's floating
   * strip goes with them; focus a note and all of it returns.
   */
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import { shareName } from '@ohhi/editor-lang'
  import { tick, untrack } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { GroupShell } from '../group-ui.svelte.js'
  import type { Navigation } from '../navigation.svelte.js'
  import { findPane, type Group, type Pane as PaneNode, type Tab as PaneTab } from '../panes.js'
  import { tagQuery } from '../read.svelte.js'
  import { recentPaths, touchPath } from '../recent.js'
  import { themeState } from '../theme.svelte.js'
  import type { ShellSpec } from '../layout-spec.js'
  import { getReadoutContext, inBar } from '../readouts.js'
  import { focusedIsNote } from '../readout-state.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import type { PaneChrome } from '../pane-chrome.js'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import { textPaths, type Workspace } from '../workspace.svelte.js'
  import CornerStatus from './CornerStatus.svelte'
  import Dock, { DOCK_CLEAR_PX } from './Dock.svelte'
  import FormatBar from './FormatBar.svelte'
  import GroupChip from './GroupChip.svelte'
  import ModeBar from './ModeBar.svelte'
  import ModeCue from './ModeCue.svelte'
  import { paneHints } from '../pane-hints.svelte.js'
  import { screen } from '../small-screen.svelte.js'
  import PaneTree, { type PaneRender } from './PaneTree.svelte'
  import StripGroupsMenu from './StripGroupsMenu.svelte'
  import TabGroupMenuItems from './TabGroupMenuItems.svelte'

  interface Props {
    workspace: Workspace
    panes: PaneShell
    groups: GroupShell
    nav: Navigation
    now: () => number
    /** Create the note an unresolved wikilink points at (`file-actions`). */
    onCreateFromLink: (target: string) => void
    /** Which pane chrome the layout spec gives every pane (spike S21); absent → today's. */
    chrome?: PaneChrome
    /**
     * The layout's `editor` section (quiet-shell F1): the measure becomes
     * `--ed-measure` on this area, typewriter scrolling reaches every pane's
     * view by reconfigure. Absent → the token's own measure, no typewriter.
     */
    editor?: ShellSpec['editor']
    /**
     * The shell layout (Round 2 P4; Round 3 Q3): the dock's strip floats
     * over this area whenever it is closed, pinned or not; open, its panel
     * floats here under `regions.rail: "dock"`. Absent → no dock.
     */
    layout?: ShellLayout
  }

  let { workspace, panes, groups, nav, now, onCreateFromLink, chrome, editor, layout }: Props = $props()

  /** The positioned box the floating dock measures and hangs in. */
  let area = $state<HTMLElement | null>(null)
  const floatingDock = $derived(layout !== undefined && layout.focusKeeps('rail'))

  // ---- the floating layer (round 3, Q2/Q4) ----

  const shellCtx = getReadoutContext()
  /** The bottom layer's readouts and menus open upward; the top one's downward. */
  const bottomCtx = $derived(shellCtx ? inBar(shellCtx, { side: 'top' }) : null)
  const topCtx = $derived(shellCtx ? inBar(shellCtx, { side: 'bottom' }) : null)
  /** The note's chrome only over a note (D7): a view or an empty tab draws none of it. */
  const onNote = $derived(focusedIsNote(panes.layout))
  const formatAt = $derived(
    onNote && layout && layout.spec.regions.format !== 'off' && layout.focusKeeps('format')
      ? layout.spec.regions.format
      : null
  )
  /** E6: a live pane mode's keys in the corner, above the count (Pane keys: Subtle / Off). */
  const cue = $derived(panes.mode !== null && paneHints.value !== 'full')
  const corner = $derived(
    onNote && layout !== undefined && layout.spec.regions.status === 'corner' && layout.focusKeeps('status')
  )
  /**
   * The closed dock strip floats at the top right over a file's tab. A
   * note's text sits in the measure's margin, clear of it; a view that
   * fills its pane (a collection's toolbar) reads `--ed-dock-clear` and
   * keeps that much of its first row free, so the strip never covers a
   * control. Zero when no strip floats there.
   */
  const dockClear = $derived(floatingDock && onNote && layout?.spec.dock.position === 'top-right' ? DOCK_CLEAR_PX : 0)

  /** The pane container the layer floats in, and what it must clear at its edges. */
  let stage = $state<HTMLElement | null>(null)
  let clearTop = $state(0)
  let clearBottom = $state(0)
  /** The focused pane's box within the stage: the layer's left, width and vertical insets. */
  let frame = $state<{ left: number; width: number; top: number; bottom: number } | null>(null)
  /** The pane the layer floats over: the zoomed one, else the focused one. */
  const framePane = $derived(panes.layout.zoom ?? panes.layout.focus)
  /** The two stacks' heights, measured: what the scrollers pad by. */
  let bottomH = $state(0)
  let topH = $state(0)
  /** The layer's gap to the edge it floats at (Tailwind's 2). */
  const GAP_PX = 8
  /** Between the bar and the corner column on one row (Tailwind's 4): the two read as apart. */
  const SEP_PX = 16

  /**
   * A tab strip along the top edge (the bar goes under it) and a per-pane
   * status bar along the bottom (the bar goes above it): the panes' own
   * chrome stays reachable under the layer.
   */
  function paneEl(): HTMLElement | null {
    if (!stage) return null
    return stage.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(framePane)}"]`)
  }

  function measureEdges(): void {
    if (!stage) return
    const outer = stage.getBoundingClientRect()
    const box = paneEl()?.getBoundingClientRect() ?? outer
    frame = {
      left: box.left - outer.left,
      width: box.width,
      top: box.top - outer.top,
      bottom: outer.bottom - box.bottom,
    }
    // Only this pane's own chrome: a strip along its top, a bar along its bottom.
    const across = (r: DOMRect): boolean => r.left < box.right - 1 && r.right > box.left + 1
    const strips = [...stage.querySelectorAll<HTMLElement>('[data-strip]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => across(r) && Math.abs(r.top - box.top) < 1)
    const bars = [...stage.querySelectorAll<HTMLElement>('[data-testid="status-bar"], [data-testid^="pane-status:"]')]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => across(r) && Math.abs(box.bottom - r.bottom) < 1)
    clearTop = strips.length ? Math.max(...strips.map((r) => r.bottom)) - box.top : 0
    clearBottom = bars.length ? box.bottom - Math.min(...bars.map((r) => r.top)) : 0
  }

  $effect(() => {
    if (!stage || (!formatAt && !corner && !cue)) return
    const el = stage
    let raf = 0
    const schedule = (): void => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measureEdges)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(el)
    // The focused pane resizes on its own when a divider is dragged; and a
    // focus change moves the layer (`framePane` is read here, so it re-runs).
    const pane = framePane ? paneEl() : null
    if (pane) resize.observe(pane)
    // Strips come and go with a second tab, panes split; typing never moves them.
    const mutations = new MutationObserver((records) => {
      if (records.every((r) => (r.target as Element).closest?.('.cm-editor'))) return
      schedule()
    })
    mutations.observe(el, { childList: true, subtree: true })
    schedule()
    return () => {
      cancelAnimationFrame(raf)
      resize.disconnect()
      mutations.disconnect()
    }
  })

  /**
   * The bottom row's widths, measured: the corner stays on the format bar's
   * row whenever the two fit side by side — the bar shifting off-centre to
   * make room (a pinned column narrows the panes) — and stacks above it only
   * when they do not. A width the layer itself decides (the bar folds at the
   * layer's 30rem), so stacking never feeds back into what is measured.
   */
  let rowW = $state(0)
  let barW = $state(0)
  let cornerW = $state(0)
  // Three tracks, two gaps (the first track is empty space, but its gap is there).
  // A small screen never stacks: the bar takes the row and the count is a chip.
  const stacked = $derived(
    !screen.small &&
      formatAt === 'bottom' &&
      (corner || cue) &&
      barW > 0 &&
      cornerW > 0 &&
      barW + cornerW + 2 * SEP_PX > rowW
  )

  /**
   * Focus where the dock's strip would have taken it, when no strip is drawn
   * (D7): the focused pane's selected tab, else the first control in it.
   */
  function focusPane(): void {
    const pane = stage?.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(panes.layout.focus)}"]`)
    const target =
      pane?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      pane?.querySelector<HTMLElement>('button:not([disabled]), [href], input, select, textarea, [tabindex="0"]')
    target?.focus()
  }

  /** The two floating stacks, for the focus handoff below. */
  let floatTop = $state<HTMLElement>()
  let floatBottom = $state<HTMLElement>()
  // The gate turning the layer off while focus is inside it (a key switched
  // the focused tab to a view): read before the DOM drops it, then hand focus
  // to the focused pane's tab — what the dock's strip does (`refocus`).
  $effect.pre(() => {
    if (onNote) return
    const held = untrack(() => {
      const el = document.activeElement
      return !!el && (!!floatTop?.contains(el) || !!floatBottom?.contains(el))
    })
    if (held) void tick().then(focusPane)
  })

  // A stack that is not drawn pads nothing: `bind:clientHeight` keeps its
  // last value when the element goes, so the gate is read here too.
  const padBottom = $derived((formatAt === 'bottom' || corner || cue) && bottomH > 0 ? bottomH + 2 * GAP_PX : 0)
  const padTop = $derived(formatAt === 'top' && topH > 0 ? topH + 2 * GAP_PX : 0)

  /** The three measures (F1) — set inline here, so the CM6 theme's `var(--ed-measure)` reads it. */
  const MEASURES: Record<ShellSpec['editor']['measure'], string> = {
    narrow: '36rem',
    comfortable: '44rem',
    wide: '60rem',
  }

  /**
   * Everything a pane needs that is the same for all of them. The reveal goes
   * to the focused pane only: a search result lands where you were looking.
   */
  const ctx = $derived<PaneRender>({
    panes,
    workspace,
    dark: themeState.dark,
    typewriter: editor?.typewriter ?? false,
    // P3: on unless the layout turns it off (a spec that predates the field).
    inlineTitle: editor?.inlineTitle ?? true,
    search: async (query) => {
      const page = await nav.index.quickOpen(query, { limit: 50 })
      return page.items.map((hit) => ({ path: hit.path, spans: hit.spans }))
    },
    /**
     * Recency is filtered against the file list rather than trusted: the
     * store survives renames and deletes made in another app, and a row
     * for a note that is gone opens nothing (P5).
     */
    recent: () => {
      const existing = new Set(textPaths(workspace.ui.files))
      return recentPaths(workspace.room).filter((p) => existing.has(p))
    },
    /**
     * *New note* fills THIS tab (`navigate`), never a new one beside it:
     * an empty tab is a slot waiting for a note.
     */
    newNote: (tabId) => {
      void (async () => {
        const created = await workspace.createFile('')
        if (!created) return
        panes.navigate(created, tabId)
        touchPath(workspace.room, created)
      })()
    },
    openQuick: () => nav.open('quick-open'),
    bindings: {
      newNote: nav.registry.binding('file.new'),
      openQuick: nav.registry.binding('nav.quick-open'),
    },
    resolveLink: (target, from) => nav.resolveLink(target, from),
    createFromLink: onCreateFromLink,
    linkCandidates: () => textPaths(workspace.ui.files),
    // The link popover's scope (E1, fork A2): every shared folder, by the
    // name the Shared view gives it (its last segment), and the recents.
    linkContext: () => ({
      mounts: workspace.ui.mounts
        .filter((m) => m.path !== '')
        .map((m) => ({ path: m.path, name: shareName(m.path) })),
      recents: recentPaths(workspace.room),
    }),
    linkHeadings: async (path) => {
      const guid = workspace.ui.files.find((f) => f.path === path)?.guid
      return guid ? nav.index.headings(guid) : []
    },
    searchTag: (tag) => nav.openSearch(tagQuery(tag)),
    tags: () => nav.tags(),
    reveal: nav.pending.reveal,
    groupChip,
    tabMenuGroupItems,
    moreMenuItems,
    chrome,
  })
  /** Zoom mounts one pane and nothing else — that is the whole memory story. */
  const treeRoot = $derived(
    (panes.layout.zoom ? findPane(panes.layout, panes.layout.zoom) : null) ?? panes.layout.tree
  )
</script>

<div bind:this={area} class="relative flex min-h-0 min-w-0 flex-1">
  <main
    data-testid="editor-area"
    aria-label={$LL.web.panes.area()}
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    style:--ed-measure={editor ? MEASURES[editor.measure] : undefined}
    style:--ed-float-bottom="{padBottom}px"
    style:--ed-float-top="{padTop}px"
    style:--ed-dock-clear="{dockClear}px"
  >
    <div bind:this={stage} class="relative flex min-h-0 min-w-0 flex-1 bg-base-200">
      <PaneTree node={treeRoot} {ctx} />
      {#if formatAt === 'top' && topCtx}
        <div
          bind:this={floatTop}
          data-testid="float-top"
          class="pointer-events-none absolute z-10 flex justify-center px-2 @container"
          style:left="{frame?.left ?? 0}px"
          style:width={frame ? `${frame.width}px` : '100%'}
          style:top="{(frame?.top ?? 0) + clearTop + GAP_PX}px"
        >
          <div bind:clientHeight={topH} class="flex min-w-0 justify-center {screen.small ? 'flex-1' : ''}">
            <FormatBar ids={layout!.spec.bars.format} edge="top" ctx={topCtx} registry={nav.registry} fill={screen.small} />
          </div>
        </div>
      {/if}
      {#if (formatAt === 'bottom' || corner || cue) && bottomCtx}
        <!-- Over the focused pane. One row while both fit: the bar centred
             and the corner at the right, a clear 16 px apart; the right
             track never shrinks below the corner (`minmax(max-content,
             1fr)`), so with less room the bar shifts left rather than the
             two meeting. Too narrow for both (measured): the corner stacks
             above the bar, right-aligned. -->
        <div
          bind:this={floatBottom}
          data-testid="float-bottom"
          data-stacked={stacked}
          class="pointer-events-none absolute z-10 px-2 @container"
          style:left="{frame?.left ?? 0}px"
          style:width={frame ? `${frame.width}px` : '100%'}
          style:bottom="{(frame?.bottom ?? 0) + clearBottom + GAP_PX}px"
        >
          <!-- A small screen (QA round 1): one flex row — the bar takes all
               of it but the count chip at its right end, and scrolls. -->
          <div
            bind:clientHeight={bottomH}
            bind:clientWidth={rowW}
            data-small={screen.small}
            class={screen.small
              ? 'flex items-end gap-2'
              : stacked
                ? 'flex flex-col items-center gap-2'
                : 'grid grid-cols-[minmax(0,1fr)_auto_minmax(max-content,1fr)] items-end gap-x-4'}
          >
            {#if corner || cue}
              <div
                class="col-start-3 row-start-1 flex justify-end {stacked ? 'self-end' : ''} {screen.small
                  ? 'order-last shrink-0'
                  : ''}"
              >
                <div bind:clientWidth={cornerW} class="flex flex-col items-end gap-1">
                  <ModeCue {panes} />
                  {#if corner}<CornerStatus ids={layout!.spec.bars.status} ctx={bottomCtx} compact={screen.small} />{/if}
                </div>
              </div>
            {/if}
            {#if formatAt === 'bottom'}
              <div
                class="col-start-2 row-start-1 flex min-w-0 {screen.small ? 'flex-1' : 'justify-center'} {stacked
                  ? 'max-w-full'
                  : ''}"
              >
                <div bind:clientWidth={barW} class="flex min-w-0 max-w-full {screen.small ? 'flex-1' : ''}">
                  <FormatBar
                    ids={layout!.spec.bars.format}
                    edge="bottom"
                    ctx={bottomCtx}
                    registry={nav.registry}
                    fill={screen.small}
                  />
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
    <ModeBar {panes} />
  </main>
  {#if floatingDock && layout}
    <Dock {workspace} {nav} {layout} form="float" {area} showStrip={onNote} refocus={focusPane} />
  {/if}
</div>

<style>
  /* The floating layer never covers a note's first or last line: every
     scroller under the area makes room for it (round 3, Q2). */
  main :global(.cm-scroller) {
    padding-top: var(--ed-float-top, 0px);
    padding-bottom: var(--ed-float-bottom, 0px);
  }
</style>

<!-- The strip's three W2 seams, filled once for every pane: B1 left them as
     snippet props so the group chrome could land without moving anything in
     `TabStrip`. -->
{#snippet groupChip(group: Group, pane: PaneNode)}
  <GroupChip {group} {pane} {panes} onManage={(id) => groups.openManage(id)} />
{/snippet}

{#snippet tabMenuGroupItems(attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }, tab: PaneTab)}
  <TabGroupMenuItems {attrs} {tab} {panes} {groups} />
{/snippet}

{#snippet moreMenuItems(attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }, pane: PaneNode)}
  <StripGroupsMenu {attrs} {pane} {panes} {groups} {now} />
{/snippet}
