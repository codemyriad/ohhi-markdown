<script lang="ts">
  /**
   * What a drag looks like (tab-groups B10): the ghost pill riding the
   * pointer, the tinted zone the payload would land in, and the 2 px
   * insertion indicator between two tabs — coloured with the group's own
   * token when the drop would join a group.
   *
   * Purely a readout of `panes.drag`: the hit testing and the drop live in
   * the shell, so nothing here decides anything. It is `aria-hidden` and
   * `pointer-events-none` throughout — a pointer drag has no keyboard
   * equivalent to announce, and every gesture it paints has a menu item that
   * does the same thing (R8).
   */
  import { File } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { LAYER } from '../ui/Dialog.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import GroupDot from './GroupDot.svelte'

  interface Props {
    panes: PaneShell
  }

  let { panes }: Props = $props()

  const drag = $derived(panes.drag)
  const target = $derived(drag?.target ?? null)

  /**
   * What letting go would DO, not just what is being held: an edge zone splits
   * the pane, a strip or a centre drop joins it. The tint alone does not say
   * which, and the pill is the only thing the eye is already following.
   */
  const promise = $derived.by(() => {
    if (!drag || !target || target.kind === 'none') return ''
    const name = drag.payload.label
    return target.kind === 'zone' && target.zone !== 'center'
      ? $LL.web.panes.split_here({ name })
      : $LL.web.panes.drop_here({ name })
  })
</script>

{#if drag}
  <div
    aria-hidden="true"
    class="pointer-events-none fixed inset-0 {LAYER.drag}"
    data-testid="drop-zones"
  >
    {#if target?.kind === 'zone'}
      <div
        data-testid="drop-zone"
        data-zone={target.zone}
        class="absolute rounded border border-accent/60 bg-accent/25"
        style="left: {target.box.left}px; top: {target.box.top}px; width: {target.box
          .width}px; height: {target.box.height}px"
      ></div>
    {:else if target?.kind === 'strip'}
      <div
        data-testid="drop-indicator"
        class="absolute w-0.5 rounded-full"
        style="left: {target.x - 1}px; top: {target.top}px; height: {target.height}px;
          background: {target.color ? `var(--ed-group-${target.color})` : 'var(--color-primary)'}"
      ></div>
    {/if}

    <!-- A native drag already has a ghost: the browser's own drag image of
         the tree row. Drawing a second one beside it would be two answers to
         "what am I holding" (P1.2). -->
    {#if !drag.payload.external}
      <div
        data-testid="drag-ghost"
        class="absolute flex translate-x-3.5 translate-y-3.5 items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-3 py-1.5 text-xs font-medium text-base-content shadow-xl"
        style="left: {drag.x}px; top: {drag.y}px"
      >
        {#if drag.payload.color}
          <GroupDot color={drag.payload.color} />
        {:else}
          <File size={13} />
        {/if}
        {drag.payload.label}
        {#if drag.payload.tabIds.length > 1}
          <span class="text-base-content/70">{drag.payload.tabIds.length}</span>
        {/if}
        {#if promise}
          <span
            data-testid="drag-promise"
            class="border-l border-base-300 pl-1.5 text-base-content/70"
          >
            {promise}
          </span>
        {/if}
      </div>
    {/if}
  </div>
{/if}
