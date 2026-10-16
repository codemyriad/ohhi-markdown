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
    /**
     * The trigger's id, when the trigger needs a known one (a tab, whose panel
     * points back at it). Melt finds the trigger by this id, so the child must
     * not set a different one.
     */
    triggerId?: string
    /** Extra classes for the label (Settings' rail draws it only while narrow). */
    contentClass?: string
    /**
     * Where the label is drawn, as a selector; default: in place. A trigger
     * inside a container whose role allows only certain children (a tablist)
     * draws its label in an ancestor outside that container instead.
     */
    portal?: string
    children: Snippet<[TooltipTrigger]>
  }

  export type TooltipTrigger = ReturnType<typeof createTooltip>['elements']['trigger'] extends {
    subscribe: (run: (value: infer V) => void) => unknown
  }
    ? V
    : never

  let { text, placement = 'bottom', triggerId, contentClass = '', portal, children }: Props = $props()

  const {
    elements: { trigger, content },
    states: { open },
  } = createTooltip({
    // svelte-ignore state_referenced_locally -- placement is fixed at mount
    positioning: { placement, gutter: 6, strategy: 'fixed' },
    // In place (see DropdownMenu): a tooltip portalled to the body lands outside
    // every landmark. `portal` names a nearer ancestor when in place is not allowed.
    // svelte-ignore state_referenced_locally -- fixed at mount
    portal: portal ?? null,
    openDelay: 350,
    closeDelay: 0,
    closeOnPointerDown: true,
    forceVisible: true,
    group: true,
    // svelte-ignore state_referenced_locally -- the id is fixed at mount
    ...(triggerId ? { ids: { trigger: triggerId } } : {}),
  })
</script>

{@render children($trigger)}

{#if $open}
  <div
    use:melt={$content}
    class="z-[60] rounded bg-neutral px-2 py-1 text-xs text-neutral-content shadow-lg {contentClass}"
  >
    {text}
  </div>
{/if}
