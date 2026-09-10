<script lang="ts">
  /**
   * A real menu (R1.1): arrow keys, Home/End, typeahead, Escape, click-outside,
   * and focus back on the trigger — Melt's dropdown builder. The trigger is a
   * snippet so it can be any button; items render through `MenuItem`, which
   * takes the `item` attrs this component hands out.
   */
  import { createDropdownMenu, melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'
  import { withAttrs } from './melt-attrs.js'
  import type { MenuPlacement } from './placement.js'

  type Value<S> = S extends { subscribe: (run: (value: infer V) => void) => unknown } ? V : never
  type Builder = ReturnType<typeof createDropdownMenu>
  export type MenuTrigger = Value<Builder['elements']['trigger']>
  export type MenuItemAttrs = Value<Builder['elements']['item']>
  export type MenuSeparatorAttrs = Value<Builder['elements']['separator']>

  interface Props {
    placement?: MenuPlacement
    testid?: string
    /**
     * Bindable, so a host can open the menu from a gesture the trigger cannot
     * see — a right-click on a tab, whose menu anchors to a trigger placed at
     * the pointer (tab-groups B9).
     */
    open?: boolean
    trigger: Snippet<[MenuTrigger]>
    children: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }]>
  }

  let {
    placement = 'bottom-start',
    testid,
    open: wanted = $bindable(false),
    trigger: triggerSnippet,
    children,
  }: Props = $props()

  const {
    elements: { trigger, menu, item, separator },
    states: { open },
  } = createDropdownMenu({
    onOpenChange: ({ next }) => {
      wanted = next
      return next
    },
    // In place, not portalled to <body>: a portalled menu sits outside every
    // landmark (axe's `region` rule, and a real region-navigation gap).
    // Fixed positioning means no scrolling ancestor can clip it.
    // svelte-ignore state_referenced_locally -- placement is fixed at mount
    positioning: { placement, gutter: 4, strategy: 'fixed' },
    portal: null,
    loop: true,
    forceVisible: true,
    preventScroll: false,
  })

  // Host → Melt. Melt → host goes through `onOpenChange` above, so neither
  // direction can loop: both only write when the value actually differs.
  $effect(() => {
    if (wanted !== $open) open.set(wanted)
  })
</script>

<!-- Melt sets aria-controls/expanded; the menu-button pattern also wants haspopup. -->
{@render triggerSnippet(withAttrs($trigger, { 'aria-haspopup': 'menu' }))}

{#if $open}
  <!-- Named by its trigger (Melt's aria-labelledby): the menu-button pattern. -->
  <div
    use:melt={$menu}
    data-testid={testid}
    class="z-40 min-w-52 rounded-lg border border-base-300 bg-base-100 py-1 text-base-content shadow-xl focus:outline-none"
  >
    {@render children({ item: $item, separator: $separator })}
  </div>
{/if}
