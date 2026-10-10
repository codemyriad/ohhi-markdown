<script lang="ts">
  /**
   * `help` (first-run-shaping E1): the Help menu's door, a question-mark icon
   * at the toolbar's right end. The menu itself is `HelpMenu.svelte`; this
   * readout only places it, opening away from the bar's edge.
   *
   * The `help` entry of the readout catalogue (`readouts.ts`).
   */
  import { readoutPlacement, type ReadoutContext } from '../../readouts.js'
  import HelpMenu from '../HelpMenu.svelte'

  let { ctx }: { ctx: Pick<ReadoutContext, 'side'> } = $props()
  const placement = $derived(readoutPlacement(ctx))
</script>

{#key placement}
  <HelpMenu {placement} />
{/key}
