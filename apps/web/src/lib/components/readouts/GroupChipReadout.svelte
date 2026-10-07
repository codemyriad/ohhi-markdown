<script lang="ts">
  /**
   * `group.chip` (quiet-shell F6): the focused tab's group, if it is in one —
   * its dot and name. A readout, not the strip's chip: folding a group from
   * here would hide the tab you are reading. Managing it is the strip's chip
   * and the `group.*` commands.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { groupLabel } from '../../group-ui.svelte.js'
  import { targetOf, type ReadoutContext } from '../../readouts.js'
  import GroupDot from '../GroupDot.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const group = $derived(targetOf(ctx).group)
</script>

{#if group}
  {@const name = groupLabel(group.name)}
  <span
    data-testid="toolbar-group-chip"
    title={$LL.web.toolbar.group({ name })}
    class="flex max-w-40 items-center gap-1.5 rounded-full border border-base-300 px-2 py-0.5"
  >
    <GroupDot color={group.color} />
    <span class="truncate text-base-content">{name}</span>
  </span>
{/if}
