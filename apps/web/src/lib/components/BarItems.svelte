<script lang="ts">
  /**
   * The ONE list renderer for a bar of readouts (duplication review #11): the
   * toolbar's three groups, the per-pane status bar's `bars.statusbar` and
   * the corner's `bars.status` all draw their ids through here — `"|"` a
   * separator, every other id its `READOUTS` component over the same
   * context. An id the catalogue lacks renders nothing (the schema already
   * refused it). `join` (the corner's " · ") is drawn between consecutive
   * readouts, as text, so "412 words · 2,301 characters" reads as one line.
   */
  import { SEPARATOR } from '../layout-spec.js'
  import { READOUTS, type ReadoutContext } from '../readouts.js'

  interface Props {
    ids: readonly string[]
    ctx: ReadoutContext
    /** Text between two readouts (decoration: hidden from a screen reader). */
    join?: string
  }

  let { ids, ctx, join }: Props = $props()
</script>

{#each ids as id, i (`${i}:${id}`)}
  {#if id === SEPARATOR}
    <span role="separator" aria-orientation="vertical" class="h-4 w-px shrink-0 bg-base-300"></span>
  {:else if id in READOUTS}
    {@const Readout = READOUTS[id as keyof typeof READOUTS]}
    {#if join && i > 0 && ids[i - 1] !== SEPARATOR}<span aria-hidden="true" class="whitespace-pre">{join}</span>{/if}
    <Readout {ctx} />
  {/if}
{/each}
