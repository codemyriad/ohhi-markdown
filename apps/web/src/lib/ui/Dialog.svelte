<script lang="ts">
  /**
   * The one overlay primitive (chrome-shaping U1, R1.1): scrim, z-scale,
   * portal, focus trap + restore, Escape and click-outside — all from Melt's
   * dialog builder, so no dialog in the shell re-implements any of it. Seven
   * of the eight overlays used to, and five of those had neither Escape nor
   * click-outside.
   *
   * Existence is the open state: parents mount it inside `{#if}` and are told
   * to unmount through `onClose`. Melt's own `open` store therefore starts
   * open and every route to "closed" (Escape, the scrim, a `close` element)
   * funnels into `onClose`. Dismissal policy is set at mount.
   */
  import { createDialog, melt } from '@melt-ui/svelte'
  import { X } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { firstTabbable } from './focus.js'

  interface Props {
    /** Accessible name. Rendered as the heading unless `hideTitle`. */
    title: string
    /** Optional supporting sentence, wired as `aria-describedby`. */
    description?: string
    role?: 'dialog' | 'alertdialog'
    /**
     * Escape closes. Off only where closing has consequences the user must
     * choose explicitly (the divergence review).
     */
    closeOnEscape?: boolean
    /**
     * A click on the scrim closes. Off for confirms and holds: a stray click
     * must not read as "cancel" on a decision that lists its consequences.
     */
    closeOnOutsideClick?: boolean
    /** Overlay stacking: panels under dialogs under the palette under reviews. */
    layer?: 'panel' | 'dialog' | 'palette' | 'review'
    /** Vertical placement: dialogs centre, the palette hangs from the top. */
    align?: 'center' | 'top'
    width?: 'sm' | 'md' | 'lg' | 'xl'
    /**
     * Selector for the element to focus on open. Default: the first control
     * inside, else the dialog itself (Melt's own default is always the
     * container, which leaves a rename dialog's input one Tab away).
     */
    openFocus?: string
    /** The body renders its own heading; keep the title for assistive tech only. */
    hideTitle?: boolean
    /** No body padding (the palette's edge-to-edge input, the review's header). */
    flush?: boolean
    /** Render a visible ✕ in the corner (dialogs with no Cancel button of their own). */
    showClose?: boolean
    closeTestid?: string
    testid?: string
    /**
     * Veto a close (Escape, scrim, ✕): return false to stay open — the dirty
     * settings form uses it to show its unsaved-changes prompt. `onClose`
     * itself is never vetoed; the parent calls it when it really is done.
     */
    beforeClose?: () => boolean
    onClose: () => void
    children: Snippet
  }

  let {
    title,
    description,
    role = 'dialog',
    closeOnEscape = true,
    closeOnOutsideClick = true,
    layer = 'dialog',
    align = 'center',
    width = 'md',
    openFocus,
    hideTitle = false,
    flush = false,
    showClose = false,
    closeTestid,
    testid,
    beforeClose,
    onClose,
    children,
  }: Props = $props()

  const Z = { panel: 'z-20', dialog: 'z-30', palette: 'z-40', review: 'z-50' } as const
  const MAX = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-3xl' } as const

  // Focus goes back to whatever had it — a tree row, a header button, or
  // CodeMirror, which is why restore matters more here than usual: a dialog
  // that does not give focus back leaves the keyboard pointing at nothing.
  const opener =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  const {
    elements: { overlay, content, title: titleEl, description: descriptionEl, close, portalled },
    states: { open },
  } = createDialog({
    // svelte-ignore state_referenced_locally -- dismissal policy is fixed at mount (see above)
    role,
    defaultOpen: true,
    forceVisible: true,
    // svelte-ignore state_referenced_locally -- fixed at mount
    closeOnOutsideClick,
    // svelte-ignore state_referenced_locally -- fixed at mount
    escapeBehavior: closeOnEscape ? 'close' : 'ignore',
    preventScroll: false,
    // svelte-ignore state_referenced_locally -- fixed at mount
    openFocus: openFocus ?? ((el) => firstTabbable(el) ?? el ?? null),
    closeFocus: () => opener,
    onOpenChange: ({ curr, next }) => {
      if (!next && beforeClose && !beforeClose()) return curr
      if (!next) onClose()
      return next
    },
  })
</script>

{#if $open}
  <div use:melt={$portalled}>
    <!-- A scrim token, not `neutral`: that is the ink colour in dark themes. -->
    <div use:melt={$overlay} class="fixed inset-0 {Z[layer]} bg-ed-scrim backdrop-blur-[1px]"></div>
    <div
      use:melt={$content}
      data-testid={testid}
      class="fixed left-1/2 {Z[layer]} flex max-h-[85vh] w-[calc(100%-2rem)] {MAX[width]} -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-base-300 bg-base-100 text-base-content shadow-xl focus:outline-none
        {align === 'top' ? 'top-[12vh]' : 'top-1/2 -translate-y-1/2'}"
    >
      <h2
        use:melt={$titleEl}
        class={hideTitle ? 'sr-only' : `px-4 pt-4 text-sm font-semibold ${flush ? 'pb-2' : ''}`}
      >
        {title}
      </h2>
      {#if description}
        <p
          use:melt={$descriptionEl}
          class={hideTitle ? 'sr-only' : 'px-4 pt-1 text-xs text-base-content/70'}
        >
          {description}
        </p>
      {/if}
      {#if showClose}
        <button
          use:melt={$close}
          aria-label="Close"
          data-testid={closeTestid}
          class="absolute top-3 right-3 rounded p-1 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
        >
          <X size={16} aria-hidden="true" />
        </button>
      {/if}
      <div class="min-h-0 flex-1 overflow-y-auto {flush ? '' : 'px-4 pt-3 pb-4'}">
        {@render children()}
      </div>
    </div>
  </div>
{/if}
