<script lang="ts">
  /**
   * The shared overlay: one scrim, one z-index, Escape, backdrop click, and a
   * focus trap that restores focus on close.
   *
   * Every dialog in the app used to re-implement `fixed inset-0 … bg-black/30`
   * with its own ad-hoc z (10/20/30) and, mostly, no key handling at all —
   * Escape closed two of seven. Focus was never trapped or restored, which
   * matters more here than usual: CodeMirror owns focus most of the time, so a
   * dialog that does not take it and give it back leaves the keyboard pointing
   * at the wrong surface.
   */
  import type { Snippet } from 'svelte'

  interface Props {
    /** Overlay stacking. Palette sits above dialogs; devtools sits below. */
    layer?: 'panel' | 'dialog' | 'palette'
    labelledBy?: string
    label?: string
    testid?: string
    /** Vertical placement: dialogs centre, the palette hangs from the top. */
    align?: 'center' | 'top'
    /** Search results carry snippet lines and need the room. */
    width?: 'md' | 'lg'
    onClose: () => void
    children: Snippet
  }

  let {
    layer = 'dialog',
    labelledBy,
    label,
    testid,
    align = 'center',
    width = 'md',
    onClose,
    children,
  }: Props = $props()

  const MAX = { md: 'max-w-lg', lg: 'max-w-3xl' } as const

  const Z = { panel: 'z-20', dialog: 'z-30', palette: 'z-40' } as const

  let host = $state<HTMLDivElement>()
  let restore: HTMLElement | null = null

  $effect(() => {
    restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Focus the first control, else the container, so Escape and arrow keys
    // land here rather than in the editor behind the scrim.
    const first = host?.querySelector<HTMLElement>(
      'input, textarea, select, button, [tabindex]:not([tabindex="-1"])'
    )
    ;(first ?? host)?.focus()
    return () => restore?.focus()
  })

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !host) return
    const focusable = [
      ...host.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => el.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === host)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 flex justify-center bg-neutral/40 {Z[layer]} {align === 'top'
    ? 'items-start pt-[12vh]'
    : 'items-center'}"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose()
  }}
>
  <div
    bind:this={host}
    role="dialog"
    aria-modal="true"
    aria-labelledby={labelledBy}
    aria-label={label}
    data-testid={testid}
    tabindex="-1"
    onkeydown={onKeydown}
    class="max-h-[80vh] w-full {MAX[width]} overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xl focus:outline-none"
  >
    {@render children()}
  </div>
</div>
