<script lang="ts">
  /**
   * The zoom badge (spike S21 Q6): shown by the toolbar on its own whenever a
   * pane is zoomed, because nothing else on screen hints at the panes kept
   * off it — "Zoomed · 2 more". Not a catalogue id: it cannot be configured
   * away while it is true. Keeps the status bar's `pane-zoomed` testid when
   * the readouts are merged.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { zoomedAway } from '../../readout-state.js'
  import { readoutTestid, type ReadoutContext } from '../../readouts.js'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const more = $derived(zoomedAway(ctx.panes.layout))
</script>

{#if more !== null}
  <span
    data-testid={readoutTestid(ctx, 'pane-zoomed')}
    class="rounded bg-accent px-1.5 py-0.5 font-medium whitespace-nowrap text-accent-content"
  >
    {more > 0 ? $LL.web.toolbar.zoomed_more({ count: more }) : $LL.web.panes.zoomed()}
  </span>
{/if}
