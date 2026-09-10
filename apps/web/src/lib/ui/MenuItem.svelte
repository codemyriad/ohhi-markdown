<script lang="ts">
  /**
   * One row of a `DropdownMenu`. Disabled items stay rendered and focusable
   * with their reason underneath — the rule that hides an action must be
   * readable, never inferred from an absence (the tree menu's convention).
   */
  import { Check } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'
  import type { MenuItemAttrs } from './DropdownMenu.svelte'

  interface Props {
    item: MenuItemAttrs
    onSelect: () => void
    disabled?: boolean
    reason?: string
    danger?: boolean
    /** One-of-a-set choice (a filter): rendered as `menuitemradio` with a check. */
    checked?: boolean
    testid?: string
    children: Snippet
  }

  let {
    item,
    onSelect,
    disabled = false,
    reason,
    danger = false,
    checked,
    testid,
    children,
  }: Props = $props()
</script>

<button
  use:melt={item}
  type="button"
  role={checked === undefined ? 'menuitem' : 'menuitemradio'}
  aria-checked={checked === undefined ? undefined : checked}
  data-testid={testid}
  data-disabled={disabled ? '' : undefined}
  aria-disabled={disabled ? 'true' : undefined}
  onclick={() => {
    if (!disabled) onSelect()
  }}
  class="flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm focus:outline-none
    {disabled
    ? /* contrast-exempt: inactive control */ 'cursor-default text-base-content/35'
    : danger
      ? 'text-error data-[highlighted]:bg-error/10'
      : 'text-base-content/85 data-[highlighted]:bg-base-200'}"
>
  {#if checked !== undefined}
    <span class="mt-0.5 w-3.5 shrink-0" aria-hidden="true">
      {#if checked}<Check size={14} />{/if}
    </span>
  {/if}
  <span class="min-w-0 flex-1">
    {@render children()}
    {#if disabled && reason}
      <span class="mt-0.5 block text-[10px] leading-snug text-wrap text-base-content/70">{reason}</span>
    {/if}
  </span>
</button>
