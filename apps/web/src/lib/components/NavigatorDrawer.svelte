<script lang="ts">
  /**
   * The navigator, unpinned (quiet-shell F3; Chris, 2026-10-06): in a layout
   * whose `regions.navigator` is `drawer`, the same `Navigator` floats in
   * from the LEFT edge of the editor area, over the leftmost panes' bodies
   * (below the tab strip, above the bottom bars — the dock overlay's own
   * bounds) — the dock's overlay form mirrored on the left (rounded, bordered,
   * shadowed, 6 px in), NOT a modal: no scrim, no focus trap, the panes stay
   * live under and beside it, so a tree row drags onto a pane as from the
   * column. Open is `layout.treeOpen`, exactly as the column's is, so
   * `view.sidebar`, the toolbar's files button and a breadcrumb reveal all
   * reach it. Like the dock's panel it is a floating SECTION, not a menu: a
   * click into the editor leaves it open (Chris, 2026-10-06). It closes on
   * its toggle, on Escape from inside it (focus back to the files button),
   * and — the host's doing — when a note opens in place (`panes.open:
   * "replace"`). Its header row offers *Pin as a column* as an
   * icon (Round 2, P7): a device pin (`layout.pin('navigator')`), never a
   * layout file. The testid stays `navigator-drawer`.
   *
   * Positioned against the workspace row in `App.svelte` (`relative`), the
   * box the header and the bottom toolbar bound.
   */
  import { onMount, type ComponentProps } from 'svelte'
  import Navigator from './Navigator.svelte'

  type Props = Omit<ComponentProps<typeof Navigator>, 'onPin'> & {
    onClose: () => void
    /** *Pin as a column*: this device shows the navigator as a column (`layout.pin`). */
    onPin: () => void
  }

  let { onClose, onPin, ...navigator }: Props = $props()

  let panel = $state<HTMLElement>()

  /**
   * Its span, as the dock overlay's: the leftmost panes' BODIES, top to
   * bottom — below the tab strip, above a status bar or the bottom toolbar
   * — 6 px in. Px from the positioned row's edges; measured, re-measured
   * when the editor area resizes or its panes change.
   */
  const GAP_PX = 6
  let span = $state({ top: GAP_PX, bottom: GAP_PX })
  function measure(): void {
    const row = panel?.offsetParent as HTMLElement | null
    const area = row?.querySelector<HTMLElement>('[data-testid="editor-area"]')
    if (!row || !area) return
    const box = row.getBoundingClientRect()
    const bodies = [...area.querySelectorAll<HTMLElement>('[data-pane-id]')].map(
      (pane) => (pane.querySelector<HTMLElement>('[data-testid^="editor-pane"]') ?? pane).getBoundingClientRect()
    )
    if (bodies.length === 0) return
    const left = Math.min(...bodies.map((r) => r.left))
    const edge = bodies.filter((r) => r.left <= left + 1)
    span = {
      top: Math.min(...edge.map((r) => r.top)) - box.top + GAP_PX,
      bottom: box.bottom - Math.max(...edge.map((r) => r.bottom)) + GAP_PX,
    }
  }
  $effect(() => {
    const area = (panel?.offsetParent as HTMLElement | null)?.querySelector<HTMLElement>('[data-testid="editor-area"]')
    if (!area) return
    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(area)
    // Strips come and go, panes split; typing never moves the span.
    const mutations = new MutationObserver((records) => {
      if (records.every((r) => (r.target as Element).closest?.('.cm-editor'))) return
      schedule()
    })
    mutations.observe(area, { childList: true, subtree: true })
    measure()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
    }
  })

  /** What a press or a key inside belongs to even when it is portalled out: a menu, a dialog, a popover. */
  const OWNED = '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"], [data-melt-popover-content]'
  /** The control that opens and closes it: where Escape gives focus back. */
  const TOGGLE = '[data-testid="toggle-tree"]'

  function closeToToggle(): void {
    onClose()
    queueMicrotask(() => document.querySelector<HTMLElement>(TOGGLE)?.focus())
  }

  onMount(() => {
    // Opened by key or button: the keyboard lands in it, as it did in the drawer.
    if (!panel?.contains(document.activeElement)) panel?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const target = e.target as Element | null
      // A menu or dialog over it owns its own Escape.
      if (target?.closest(OWNED)) return
      // Escape from inside it only: elsewhere Escape is the editor's (or Focus mode's).
      if (!target || !panel?.contains(target)) return
      e.preventDefault()
      closeToToggle()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  })
</script>

<div
  bind:this={panel}
  tabindex="-1"
  data-testid="navigator-drawer"
  style:top="{span.top}px"
  style:bottom="{span.bottom}px"
  class="absolute left-1.5 z-20 flex max-w-[calc(100%-0.75rem)] overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-lg focus:outline-none"
>
  <Navigator {...navigator} {onPin} />
</div>
