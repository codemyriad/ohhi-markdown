<script lang="ts">
  /**
   * The corner status (round 3, Q4): `bars.status` — by default the focused
   * note's words and characters, "412 words · 2,301 characters" — floating
   * at the bottom right of the editor area, where Obsidian keeps its count.
   * Drawn through `BarItems`, like every readout bar; hosted by
   * `EditorArea`'s floating layer, which puts it on the format bar's row
   * (right-aligned) or, when the area is too narrow for both, above it.
   * Nothing here counts backlinks.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { focusedOf } from '../readout-state.js'
  import type { ReadoutContext } from '../readouts.js'
  import BarItems from './BarItems.svelte'

  interface Props {
    /** The readout ids: the layout's `bars.status`. */
    ids: readonly string[]
    ctx: ReadoutContext
  }

  let { ids, ctx }: Props = $props()

  /** Nothing to say about an empty tab or a view: no empty pill in the corner. */
  const shown = $derived(ids.length > 0 && focusedOf(ctx.panes.layout).path !== null)
</script>

{#if shown}
  <div
    role="group"
    aria-label={$LL.web.status_bar.corner()}
    data-testid="corner-status"
    class="pointer-events-auto flex h-7 items-center gap-0 rounded-full border border-base-300 bg-base-100 px-3 text-xs text-base-content/70 shadow-sm"
  >
    <BarItems {ids} {ctx} join={$LL.web.status_bar.join()} />
  </div>
{/if}
