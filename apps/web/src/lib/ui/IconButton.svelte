<script lang="ts">
  /**
   * An icon-only control that is never label-less (R1.2): `aria-label` for
   * assistive tech, a tooltip for the eyes — shown on hover and on keyboard
   * focus alike. With `showLabel` the text sits beside the icon and the
   * tooltip is dropped (it would only repeat the label).
   */
  import type { LucideIcon } from '@lucide/svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import { melt } from '@melt-ui/svelte'
  import Tooltip from './Tooltip.svelte'
  import type { Placement } from './placement.js'

  interface Props extends HTMLButtonAttributes {
    label: string
    icon: LucideIcon
    placement?: Placement
    showLabel?: boolean
    size?: 'sm' | 'md'
    /** Toggle buttons: rendered as `aria-pressed`. */
    pressed?: boolean
    testid?: string
  }

  let {
    label,
    icon: Icon,
    placement = 'bottom',
    showLabel = false,
    size = 'sm',
    pressed,
    testid,
    class: klass = '',
    ...rest
  }: Props = $props()

  const base =
    'inline-flex shrink-0 items-center gap-1.5 rounded text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-40'
  const cls = $derived(
    `${base} ${size === 'sm' ? 'p-1' : 'p-1.5'} ${pressed ? 'bg-base-200 text-base-content' : ''} ${klass}`
  )
  const px = $derived(size === 'sm' ? 16 : 18)
</script>

{#if showLabel}
  <button type="button" aria-pressed={pressed} data-testid={testid} class={cls} {...rest}>
    <Icon size={px} strokeWidth={1.75} aria-hidden="true" />
    <span class="text-xs">{label}</span>
  </button>
{:else}
  <Tooltip text={label} {placement}>
    {#snippet children(trigger)}
      <button
        use:melt={trigger}
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        data-testid={testid}
        class={cls}
        {...rest}
      >
        <Icon size={px} strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/snippet}
  </Tooltip>
{/if}
