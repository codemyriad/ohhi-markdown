<script lang="ts">
  /**
   * A drag handle that is also a keyboard control: a focusable `separator`
   * with a value, so arrows resize and Home/End snap to the limits. The parent
   * owns the size; `onCommit` fires when a gesture ends so persistence is not
   * per pointer-move.
   *
   * Two shapes, one widget (chrome U2 + tab-groups B11):
   *
   * - the default **overlay** on a panel's trailing edge (the navigator), a
   *   vertical bar whose value is a width in pixels;
   * - `inline`, sitting **between two flex children** (a split border), where
   *   the value is the leading child's percent share and `perPixel` converts
   *   pointer travel into it.
   */
  interface Props {
    value: number
    min: number
    max: number
    step?: number
    label: string
    /**
     * What the value MEANS, for a screen reader: "37%" reads, `aria-valuenow`
     * of 37 on a bare separator does not. Omit it and the number stands alone.
     */
    valueText?: string
    /**
     * Which way the BAR runs: 'vertical' resizes horizontally (a row split,
     * the navigator), 'horizontal' resizes vertically (a column split).
     */
    orientation?: 'vertical' | 'horizontal'
    /** In-flow between two flex children instead of an overlay on an edge. */
    inline?: boolean
    /** Value units per pixel of pointer travel; 1 for a pixel-valued handle. */
    perPixel?: number
    onChange: (next: number) => void
    onCommit?: () => void
    testid?: string
  }

  let {
    value,
    min,
    max,
    step = 16,
    label,
    valueText,
    orientation = 'vertical',
    inline = false,
    perPixel = 1,
    onChange,
    onCommit,
    testid,
  }: Props = $props()

  const vertical = $derived(orientation === 'vertical')

  let dragging = $state(false)
  let start = 0
  let startValue = 0

  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  const along = (e: PointerEvent): number => (vertical ? e.clientX : e.clientY)

  function down(e: PointerEvent): void {
    dragging = true
    start = along(e)
    startValue = value
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function move(e: PointerEvent): void {
    if (!dragging) return
    const next = startValue + (along(e) - start) * perPixel
    onChange(clamp(perPixel === 1 ? Math.round(next) : next))
  }

  function up(e: PointerEvent): void {
    if (!dragging) return
    dragging = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    onCommit?.()
  }

  function key(e: KeyboardEvent): void {
    // The arrows that lie along the axis this handle actually moves on.
    const down_ = vertical ? 'ArrowLeft' : 'ArrowUp'
    const up_ = vertical ? 'ArrowRight' : 'ArrowDown'
    let next: number | null = null
    if (e.key === down_ || (vertical && e.key === 'ArrowDown')) next = value - step
    else if (e.key === up_ || (vertical && e.key === 'ArrowUp')) next = value + step
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
  aria-orientation={orientation}
  aria-label={label}
  aria-valuenow={Math.round(value)}
  aria-valuemin={Math.round(min)}
  aria-valuemax={Math.round(max)}
  aria-valuetext={valueText}
  tabindex="0"
  data-testid={testid}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
  class="z-10 touch-none select-none hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none
    {inline
    ? `relative shrink-0 bg-base-300 ${vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'}`
    : 'absolute inset-y-0 -right-1 w-2 cursor-col-resize'}
    {dragging ? 'bg-primary/40' : ''}"
>
  {#if inline}
    <!-- A 1 px border is the look; a 7 px band is the target (B11). -->
    <span
      aria-hidden="true"
      class="absolute {vertical ? '-inset-x-1 inset-y-0' : 'inset-x-0 -inset-y-1'}"
    ></span>
  {/if}
</div>
