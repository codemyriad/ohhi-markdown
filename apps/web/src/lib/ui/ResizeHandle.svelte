<script lang="ts">
  /**
   * A drag handle on a panel's trailing edge that is also a keyboard control:
   * a focusable `separator` with a value, so arrows resize and Home/End snap
   * to the limits. The parent owns the width; `onCommit` fires when a gesture
   * ends so persistence is not per pointer-move.
   */
  interface Props {
    value: number
    min: number
    max: number
    step?: number
    label: string
    onChange: (px: number) => void
    onCommit?: () => void
    testid?: string
  }

  let { value, min, max, step = 16, label, onChange, onCommit, testid }: Props = $props()

  let dragging = $state(false)
  let startX = 0
  let startWidth = 0

  const clamp = (px: number): number => Math.min(max, Math.max(min, Math.round(px)))

  function down(e: PointerEvent): void {
    dragging = true
    startX = e.clientX
    startWidth = value
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function move(e: PointerEvent): void {
    if (!dragging) return
    onChange(clamp(startWidth + (e.clientX - startX)))
  }

  function up(e: PointerEvent): void {
    if (!dragging) return
    dragging = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    onCommit?.()
  }

  function key(e: KeyboardEvent): void {
    let next: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = value - step
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = value + step
    else if (e.key === 'Home') next = min
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    onChange(clamp(next))
    onCommit?.()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -- a focusable separator with a value IS the resize widget (the ARIA "window splitter" pattern) -->
<div
  role="separator"
  aria-orientation="vertical"
  aria-label={label}
  aria-valuenow={value}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="0"
  data-testid={testid}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
  class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none select-none
    hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none
    {dragging ? 'bg-primary/40' : ''}"
></div>
