<script lang="ts">
  /**
   * One row of a `DropdownMenu`. Disabled items stay rendered and focusable
   * with their reason underneath — the rule that hides an action must be
   * readable, never inferred from an absence (the tree menu's convention).
   */
  import { melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'
  import type { MenuItemAttrs } from './DropdownMenu.svelte'

  interface Props {
    item: MenuItemAttrs
    onSelect: () => void
    disabled?: boolean
    reason?: string
    danger?: boolean
    testid?: string
    children: Snippet
  }

  let { item, onSelect, disabled = false, reason, danger = false, testid, children }: Props =
    $props()
</script>

<button
  use:melt={item}
  type="button"
  data-testid={testid}
  data-disabled={disabled ? '' : undefined}
  aria-disabled={disabled ? 'true' : undefined}
  onclick={() => {
    if (!disabled) onSelect()
  }}
  class="block w-full px-3 py-1.5 text-left text-sm focus:outline-none
    {disabled
    ? /* contrast-exempt: inactive control */ 'cursor-default text-base-content/35'
    : danger
      ? 'text-error data-[highlighted]:bg-error/10'
      : 'text-base-content/85 data-[highlighted]:bg-base-200'}"
>
  {@render children()}
  {#if disabled && reason}
    <span class="mt-0.5 block text-[10px] leading-snug text-wrap text-base-content/70">{reason}</span>
  {/if}
</button>
