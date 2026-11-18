<script lang="ts" module>
  /** The strip's width (p-1 around a 24 px `IconButton`) and its gap to the edge. */
  const STRIP_PX = 32
  const GAP_PX = 6

  /**
   * What a full-width view under the closed strip keeps clear at its top
   * right (a collection's toolbar, QA round 1): the strip and a gap either
   * side. `EditorArea` publishes it as `--ed-dock-clear` while the strip
   * floats top right; a view that fills its pane pads its first row by it.
   */
  export const DOCK_CLEAR_PX = STRIP_PX + GAP_PX * 2

  /**
   * Focus handed between the two `Dock`s (Round 3 Q3): pinned, the strip
   * lives in the editor area's instance and the open column in `Rail`'s, so
   * "land on the panel's tab" and "go back to the strip" cross instances.
   */
  const handoff = $state({ panel: false, strip: false })
</script>

<script lang="ts">
  /**
   * The dock (Round 2 P4, after Cursor's right edge; Round 3 Q3). Closed,
   * it is ALWAYS a small floating strip of icons — one per tab, and `«` —
   * that opens `DockPanel` on that tab, pinned or not. Pinning changes only
   * the open form. One pair of states (`layout.railOpen`, `layout.railTab`)
   * and two instances:
   *
   * - `float` (`EditorArea`): the strip floats over the editor's right
   *   margin at `dock.position`, 6 px in from the top-right pane's body
   *   (below its tab strip; above its status bar when bottom-right, and
   *   above the corner count or format bar beneath it — `liftOver`), in
   *   every layout; when the margin is too narrow for it, it shrinks to the
   *   `«` alone. Open under `regions.rail: "dock"`, the panel floats at the
   *   area's right edge, over the editor; open under `"column"`, this
   *   instance draws nothing.
   * - `column` (`Rail`, pinned, `regions.rail: "column"`): open, the panel
   *   IS the right column, and its header offers unpin alone — a pinned
   *   column is unpinned, not collapsed; closed (a session that closed it),
   *   nothing — the editor takes the width back and the floating strip is
   *   the way in.
   *
   * Focus: the strip is one tab stop (`role=toolbar`, arrows rove); opening
   * from it lands on the panel's active tab, and collapsing (`»`, Escape)
   * gives focus back to the strip.
   *
   * The strip is the NOTE's door (devtools-shaping D7, R10): `showStrip`
   * (the focused tab is a note) gates it, so a view tab or an empty tab
   * draws no strip. The open floating panel and the pinned column are not
   * gated. Where the strip would have taken focus — a collapse, or the strip
   * going while it held focus — `refocus` takes it instead (the focused
   * pane), so focus never falls to `body`.
   */
  import { ChevronsLeft } from '@lucide/svelte'
  import { tick, untrack } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { RAIL_SECTIONS, railForm } from '../layout.js'
  import type { Navigation } from '../navigation.svelte.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import IconButton from '../ui/IconButton.svelte'
  import { currentInsets } from '../ui/visual-viewport.js'
  import type { Workspace } from '../workspace.svelte.js'
  import DockPanel, { DOCK_ICONS } from './DockPanel.svelte'

  interface Props {
    workspace: Workspace
    nav: Navigation
    layout: ShellLayout
    form: 'float' | 'column'
    /** `float`: the editor area the strip measures its place in. */
    area?: HTMLElement | null
    /** `float`: whether the closed strip is drawn (D7: only over a note). Absent → drawn. */
    showStrip?: boolean
    /** `float`: where focus goes when the strip it was meant for is not drawn. */
    refocus?: () => void
  }

  let { workspace, nav, layout, form, area = null, showStrip = true, refocus }: Props = $props()

  const t = $derived($LL.web.rail)
  const open = $derived(layout.railOpen)
  const position = $derived(layout.spec.dock.position)
  /** Pinned (`regions.rail: "column"`): open is `Rail`'s column, not a float. */
  const pinnedColumn = $derived(railForm(layout.spec.regions) === 'column')

  let strip = $state<HTMLElement>()

  function openOn(id?: (typeof RAIL_SECTIONS)[number]): void {
    if (id) layout.railTab = id
    handoff.panel = strip?.contains(document.activeElement) ?? false
    layout.railOpen = true
  }
  function collapse(): void {
    handoff.strip = true
    handoff.panel = false
    layout.railOpen = false
  }
  $effect(() => {
    if (form !== 'float' || !handoff.strip) return
    if (!showStrip) {
      // No strip to land on (a view tab is focused): the pane takes focus.
      handoff.strip = false
      requestAnimationFrame(() => refocus?.())
      return
    }
    if (!strip) return
    handoff.strip = false
    // The strip's place was last measured with the panel (or the pinned
    // column) open; measure it as it is now first, so focus lands on the
    // tab's icon rather than on a `«` that is about to grow its icons.
    // No cleanup: clearing the request re-runs this effect.
    requestAnimationFrame(() => {
      measure()
      void tick().then(() => {
        const own = strip?.querySelector<HTMLElement>(`[data-testid="rail-icon:${layout.railTab}"]`)
        ;(own ?? strip?.querySelector<HTMLElement>('button'))?.focus()
      })
    })
  })

  // The strip going while it holds focus (a key switched the focused tab to a
  // view): read before the DOM drops it, then hand focus to the pane.
  $effect.pre(() => {
    if (showStrip) return
    if (untrack(() => strip?.contains(document.activeElement))) void tick().then(() => refocus?.())
  })

  // ---- the floating strip's place (form: float) ----

  interface Place {
    /** Px from the area's edges to the pane body the strip sits on. */
    top: number
    bottom: number
    right: number
    /** The panel's span: the rightmost panes' bodies, top to bottom. */
    panelTop: number
    panelBottom: number
    /** No room in the margin beside the measure: `«` alone. */
    compact: boolean
  }
  let place = $state<Place>({ top: 0, bottom: 0, right: 0, panelTop: 0, panelBottom: 0, compact: false })

  function measure(): void {
    if (!area) return
    const box = area.getBoundingClientRect()
    const bodies = [...area.querySelectorAll<HTMLElement>('[data-pane-id]')].map((pane) => ({
      pane,
      body: pane.querySelector<HTMLElement>('[data-testid^="editor-pane"]') ?? pane,
    }))
    if (bodies.length === 0) return
    const rects = bodies.map((b) => ({ ...b, rect: b.body.getBoundingClientRect() }))
    const right = Math.max(...rects.map((r) => r.rect.right))
    const edge = rects.filter((r) => r.rect.right >= right - 1)
    const anchor = edge.reduce((a, b) =>
      position === 'top-right' ? (b.rect.top < a.rect.top ? b : a) : b.rect.bottom > a.rect.bottom ? b : a
    )
    const scroller = anchor.body.querySelector<HTMLElement>('.cm-scroller')
    const scrollbar = scroller ? scroller.offsetWidth - scroller.clientWidth : 0
    const content = anchor.body.querySelector<HTMLElement>('.cm-content')
    // The text ends a line's padding (1rem) inside `.cm-content`; a view tab
    // (no CodeMirror) fills its pane, so there is no margin to sit in.
    const margin = content ? anchor.rect.right - scrollbar - content.getBoundingClientRect().right + 16 : 0
    place = {
      top: anchor.rect.top - box.top,
      bottom:
        position === 'bottom-right'
          ? liftOver(box, anchor.rect.bottom, anchor.rect.right - scrollbar)
          : box.bottom - anchor.rect.bottom,
      right: box.right - anchor.rect.right + scrollbar,
      panelTop: Math.min(...edge.map((r) => r.rect.top)) - box.top,
      panelBottom: box.bottom - Math.max(...edge.map((r) => r.rect.bottom)),
      compact: margin < STRIP_PX + GAP_PX * 2,
    }
  }

  /**
   * Floating, the dock follows the visible area as the format bar does
   * (`ui/visual-viewport.ts`): its offsets are measured in the layout
   * viewport, and the CSS adds the visual viewport's insets.
   */
  const vvTop = (px: number): string => `calc(${px}px + var(--vv-top, 0px))`
  const vvBottom = (px: number): string => `calc(${px}px + var(--vv-bottom, 0px))`

  /** What else floats along the editor's bottom edge (`EditorArea`'s layer): the corner, the format bar. */
  const BOTTOM_FLOATS = '[data-testid="float-bottom"] [data-testid="corner-status"], [data-testid="float-bottom"] [data-testid="format-bar"]'

  /**
   * Bottom-right, the strip stands ON the floating layer rather than over it
   * (Chris, 2026-10-06): above whatever of it lies in the strip's own
   * column — the corner's count, or the format bar when the panes are too
   * narrow for the two to sit apart. With nothing there it takes the
   * corner's place. Px from the area's bottom edge.
   */
  function liftOver(box: DOMRect, paneBottom: number, paneRight: number): number {
    const right = paneRight - GAP_PX
    const left = right - STRIP_PX
    let bottom = box.bottom - paneBottom
    for (const el of area?.querySelectorAll<HTMLElement>(BOTTOM_FLOATS) ?? []) {
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.right <= left || r.left >= right) continue
      // The bar is drawn lifted by the visual viewport's bottom inset, which
      // this strip's own CSS adds again: measure where it stands in the layout.
      bottom = Math.max(bottom, box.bottom - (r.top + currentInsets().bottom))
    }
    return bottom
  }

  $effect(() => {
    if (form !== 'float' || !area) return
    void position
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    // Panes split and close, strips come and go, the window resizes; what
    // happens inside an editor (typing) never moves the strip.
    const resize = new ResizeObserver(schedule)
    resize.observe(area)
    const observeBodies = (): void => {
      // …and the floating layer's row, which grows when the corner stacks.
      const watched = `[data-pane-id], [data-testid^="editor-pane"], .cm-content, [data-testid="float-bottom"], ${BOTTOM_FLOATS}`
      for (const el of area.querySelectorAll(watched)) {
        resize.observe(el)
      }
    }
    const mutations = new MutationObserver((records) => {
      if (records.every((r) => (r.target as Element).closest?.('.cm-editor'))) return
      observeBodies()
      schedule()
    })
    mutations.observe(area, { childList: true, subtree: true })
    observeBodies()
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
    }
  })

  // ---- the strip's roving focus (the WAI-ARIA toolbar pattern, vertical) ----

  function roving(root: HTMLElement) {
    const controls = (): HTMLButtonElement[] => [...root.querySelectorAll<HTMLButtonElement>('button')]
    let current = 0
    const sync = (): void => {
      const list = controls()
      current = Math.min(current, list.length - 1)
      list.forEach((el, i) => {
        const want = i === current ? '0' : '-1'
        if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want)
      })
    }
    const onFocusIn = (e: FocusEvent): void => {
      const at = controls().indexOf(e.target as HTMLButtonElement)
      if (at >= 0) {
        current = at
        sync()
      }
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
      const list = controls()
      if (list.length === 0) return
      current =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? list.length - 1
            : (current + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length
      e.preventDefault()
      sync()
      list[current].focus()
    }
    // A Melt tooltip trigger resets its own tabindex; put the roving one back.
    const observer = new MutationObserver(sync)
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['tabindex'] })
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('keydown', onKeyDown)
    sync()
    return {
      destroy() {
        observer.disconnect()
        root.removeEventListener('focusin', onFocusIn)
        root.removeEventListener('keydown', onKeyDown)
      },
    }
  }

  const compact = $derived(form === 'float' && place.compact)
  const tooltipSide = 'left' as const
</script>

{#snippet stripButtons()}
  {#if !compact}
    {#each RAIL_SECTIONS as id (id)}
      <IconButton
        label={t.sections[id]()}
        icon={DOCK_ICONS[id]}
        placement={tooltipSide}
        pressed={open && layout.railTab === id}
        testid="rail-icon:{id}"
        onclick={() => openOn(id)}
      />
    {/each}
  {/if}
  <IconButton
    label={t.expand()}
    icon={ChevronsLeft}
    placement={tooltipSide}
    testid="rail-expand"
    aria-expanded={false}
    onclick={() => openOn()}
  />
{/snippet}

{#if form === 'column'}
  {#if open}
    <aside
      data-testid="right-rail"
      data-state="expanded"
      aria-label={t.label()}
      class="flex shrink-0 border-l border-base-300 bg-base-100"
    >
      <div class="flex w-80 min-w-0 flex-col">
        <DockPanel {workspace} {nav} {layout} form="column" autofocus={handoff.panel} onCollapse={collapse} />
      </div>
    </aside>
  {/if}
{:else if open ? !pinnedColumn : showStrip}
  <!-- A landmark of its own beside `main`, positioned over it: the editor
       area's wrapper is the containing block. Open, the panel hangs off the
       area's right edge; closed, the strip sits on the anchor pane's body —
       over a note only (D7): a view or an empty tab draws no strip. -->
  <aside
    data-testid="dock-region"
    data-state={open ? 'expanded' : 'collapsed'}
    aria-label={t.label()}
    class="absolute z-20 flex flex-col rounded-lg border border-base-300 bg-base-100
      {open ? 'w-[min(20rem,calc(100%-2rem))] overflow-hidden shadow-lg' : 'shadow-sm'}"
    style:top={open ? vvTop(place.panelTop + GAP_PX) : position === 'top-right' ? vvTop(place.top + GAP_PX) : undefined}
    style:bottom={open ? vvBottom(place.panelBottom + GAP_PX) : position === 'bottom-right' ? vvBottom(place.bottom + GAP_PX) : undefined}
    style:right="{open ? GAP_PX : place.right + GAP_PX}px"
  >
    {#if open}
      <DockPanel {workspace} {nav} {layout} form="float" autofocus={handoff.panel} onCollapse={collapse} />
    {:else}
      <div
        bind:this={strip}
        use:roving
        role="toolbar"
        aria-orientation="vertical"
        aria-label={t.strip()}
        data-testid="dock"
        data-form="float"
        data-position={position}
        data-compact={compact}
        class="flex flex-col items-center gap-0.5 p-1"
      >
        {@render stripButtons()}
      </div>
    {/if}
  </aside>
{/if}
