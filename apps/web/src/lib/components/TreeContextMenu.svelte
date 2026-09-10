<script lang="ts">
  /**
   * The file tree's right-click menu.
   *
   * Not a `Modal`: a menu is a transient popover anchored to a point, not a
   * scrim'd dialog — it must not steal the page, and it must give focus back
   * to the row that opened it. It is a real ARIA menu (roving focus, arrows,
   * Home/End, Escape, Tab closes) built with no new dependency.
   *
   * Disabled items stay rendered and focusable, with their reason spelled out
   * underneath: the rule that prompted this menu ("why is there no Share on
   * this folder?") must be readable, never inferred from an absence.
   */
  import type { TreeMenuItem } from '../tree-model.js'

  interface Props {
    /** Viewport coordinates of the invocation point. */
    x: number
    y: number
    label: string
    items: TreeMenuItem[]
    onPick: (item: TreeMenuItem) => void
    onClose: () => void
  }

  let { x, y, label, items, onPick, onClose }: Props = $props()

  let host = $state<HTMLDivElement>()
  /**
   * Clamped position: seeded at the invocation point, then corrected once the
   * menu can be measured (and re-corrected whenever x/y change, since the
   * component is reused across openings).
   */
  // svelte-ignore state_referenced_locally -- seed only; the $effect below owns it after
  let left = $state(x)
  // svelte-ignore state_referenced_locally -- seed only; the $effect below owns it after
  let top = $state(y)

  const MARGIN = 6

  $effect(() => {
    const el = host
    if (!el) return
    const r = el.getBoundingClientRect()
    left = Math.max(MARGIN, Math.min(x, window.innerWidth - r.width - MARGIN))
    top = Math.max(MARGIN, Math.min(y, window.innerHeight - r.height - MARGIN))
    // The menu owns the keyboard the moment it opens, so Escape and arrows
    // land here and not in the editor behind it.
    buttons()[0]?.focus()
  })

  function buttons(): HTMLButtonElement[] {
    return [...(host?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  }

  function moveFocus(delta: number): void {
    const els = buttons()
    if (els.length === 0) return
    const at = els.indexOf(document.activeElement as HTMLButtonElement)
    const next = at === -1 ? 0 : (at + delta + els.length) % els.length
    els[next]?.focus()
  }

  function pick(item: TreeMenuItem): void {
    if (item.disabled) return
    onPick(item)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveFocus(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveFocus(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      buttons()[0]?.focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      buttons().at(-1)?.focus()
    }
  }

  /** Any interaction outside dismisses — including a right-click elsewhere. */
  function onOutside(e: Event): void {
    if (host && e.target instanceof Node && host.contains(e.target)) return
    onClose()
  }
</script>

<svelte:window onpointerdown={onOutside} oncontextmenu={onOutside} onresize={onClose} />

<div
  bind:this={host}
  role="menu"
  aria-label={label}
  data-testid="tree-context-menu"
  tabindex="-1"
  onkeydown={onKeydown}
  style="left: {left}px; top: {top}px"
  class="fixed z-30 max-w-72 min-w-52 rounded-lg border border-base-300 bg-base-100 py-1 text-base-content shadow-xl"
>
  {#each items as item (item.action)}
    {#if item.separatorBefore}
      <div class="my-1 border-t border-base-200" role="separator"></div>
    {/if}
    <button
      role="menuitem"
      type="button"
      data-testid="tree-menu:{item.action}"
      aria-disabled={item.disabled ? 'true' : undefined}
      title={item.reason}
      onclick={() => pick(item)}
      class="block w-full px-3 py-1.5 text-left text-sm
        {item.disabled
        ? /* contrast-exempt: inactive control */ 'cursor-default text-base-content/35'
        : item.danger
          ? 'text-error hover:bg-error/10 focus:bg-error/10'
          : 'text-base-content/85 hover:bg-base-200 focus:bg-base-200'} focus:outline-none"
    >
      {item.label}
      {#if item.disabled && item.reason}
        <span
          data-testid="tree-menu-reason:{item.action}"
          class="mt-0.5 block text-[10px] leading-snug text-wrap text-base-content/70"
        >
          {item.reason}
        </span>
      {/if}
    </button>
  {/each}
</div>
