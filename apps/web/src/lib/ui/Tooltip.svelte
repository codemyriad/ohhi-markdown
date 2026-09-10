<script lang="ts">
  /**
   * Hover AND keyboard-focus label (R1.2). The child receives Melt's trigger
   * attrs and spreads them onto the element itself: `focus` does not bubble,
   * so a wrapper cannot see the keyboard user arrive.
   */
  import { createTooltip, melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'
  import type { Placement } from './placement.js'

  interface Props {
    text: string
    placement?: Placement
    children: Snippet<[TooltipTrigger]>
  }

  export type TooltipTrigger = ReturnType<typeof createTooltip>['elements']['trigger'] extends {
    subscribe: (run: (value: infer V) => void) => unknown
  }
    ? V
    : never

  let { text, placement = 'bottom', children }: Props = $props()

  const {
    elements: { trigger, content },
    states: { open },
  } = createTooltip({
    // In place (see DropdownMenu): a portalled tooltip lands outside every landmark.
    // svelte-ignore state_referenced_locally -- placement is fixed at mount
    positioning: { placement, gutter: 6, strategy: 'fixed' },
    portal: null,
    openDelay: 350,
    closeDelay: 0,
    closeOnPointerDown: true,
    forceVisible: true,
    group: true,
  })
</script>

{@render children($trigger)}

{#if $open}
  <div
    use:melt={$content}
    class="z-[60] rounded bg-neutral px-2 py-1 text-xs text-neutral-content shadow-lg"
  >
    {text}
  </div>
{/if}
