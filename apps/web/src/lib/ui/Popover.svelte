<script lang="ts">
  /**
   * The third overlay shape (shell-polish P1.3): a small panel anchored to the
   * thing it is about, with a focus trap, Escape, click-outside and focus
   * return, from Melt's popover builder. `DropdownMenu` cannot hold it (ARIA
   * lets a menu own nothing but menu items, and axe enforces that the moment a
   * text field appears in one) and `Dialog` centres it behind a scrim, which
   * is how the manage-group surface read as "a jumble" in mid-screen. So:
   * `role="dialog"`, named by `title` for assistive tech alone.
   *
   * **The trigger is an anchor, not a control.** A popover opened from a chip
   * or a command has no button of its own to hang off, so a zero-visual
   * element is placed over the anchor's rect for Melt's floating positioning.
   * It is `aria-hidden`, never tabbable (the thing it stands for is already in
   * the tab order) and `pointer-events-none`, so the element underneath keeps
   * its own clicks.
   */
  import { createPopover, melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'
  import { LAYER } from './Dialog.svelte'
  import { currentFocus, firstTabbable } from './focus.js'
  import type { MenuPlacement } from './placement.js'

  interface Props {
    /**
     * What the popover hangs off: an element (its rect), a point in client
     * pixels, or null — which parks it near the top of the viewport, because
     * a popover with nowhere to point is still better than no popover.
     */
    anchor: HTMLElement | { x: number; y: number } | null
    placement?: MenuPlacement
    /** Accessible name. Never rendered — the content is its own heading. */
    title: string
    testid?: string
    /**
     * Selector for the element to focus on open. Default: the first control
     * inside, else the content itself.
     */
    openFocus?: string
    /**
     * A hover card rather than a dialog you enter (the sync icon's people
     * list, P5): no focus trap, and focus is neither moved in on open nor
     * returned on close — opening on hover must not take the caret out of
     * the note. Escape and click-outside still close it.
     */
    peek?: boolean
    onClose: () => void
    children: Snippet
  }

  let {
    anchor,
    placement = 'bottom-start',
    title,
    testid,
    openFocus,
    peek = false,
    onClose,
    children,
  }: Props = $props()

  /** Fallback anchor: near the top, where an overlay is expected to appear. */
  const LOOSE_TOP_PX = 80

  const box = $derived.by(() => {
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect()
      return { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    if (anchor) return { left: anchor.x, top: anchor.y, width: 0, height: 0 }
    return { left: window.innerWidth / 2, top: LOOSE_TOP_PX, width: 0, height: 0 }
  })

  /**
   * The surface itself, because Melt's popover hands `openFocus` the TRIGGER
   * (its dialog hands it the content): without this the default would resolve
   * against the zero-size anchor stub and focus land on an `aria-hidden`
   * element instead of the first control inside.
   */
  let surface = $state<HTMLElement>()

  // The chip, a tab's menu item, or a command palette row.
  const opener = currentFocus()

  const {
    elements: { trigger, content },
    states: { open },
  } = createPopover({
    defaultOpen: true,
    forceVisible: true,
    closeOnOutsideClick: true,
    escapeBehavior: 'close',
    preventScroll: false,
    // In place, not portalled to <body> (see DropdownMenu): a portalled
    // overlay sits outside every landmark. `role="dialog"` below is what
    // keeps axe's `region` rule satisfied wherever the host mounts this.
    portal: null,
    // svelte-ignore state_referenced_locally -- placement is fixed at mount
    positioning: { placement, gutter: 4, strategy: 'fixed' },
    // svelte-ignore state_referenced_locally -- fixed at mount
    disableFocusTrap: peek,
    // svelte-ignore state_referenced_locally -- fixed at mount
    openFocus: peek ? () => null : (openFocus ?? (() => (surface ? (firstTabbable(surface) ?? surface) : null))),
    // svelte-ignore state_referenced_locally -- fixed at mount
    closeFocus: () => (peek ? null : opener),
    onOpenChange: ({ next }) => {
      if (!next) onClose()
      return next
    },
  })
</script>

<div
  use:melt={$trigger}
  aria-hidden="true"
  tabindex="-1"
  class="pointer-events-none fixed"
  style="left: {box.left}px; top: {box.top}px; width: {box.width}px; height: {box.height}px"
></div>

{#if $open}
  <div
    bind:this={surface}
    use:melt={$content}
    role="dialog"
    aria-label={title}
    data-testid={testid}
    class="{LAYER.dialog} rounded-lg border border-base-300 bg-base-100 text-base-content shadow-xl focus:outline-none"
  >
    {@render children()}
  </div>
{/if}
