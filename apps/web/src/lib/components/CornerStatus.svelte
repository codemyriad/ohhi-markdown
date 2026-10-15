<script lang="ts">
  /**
   * The corner status (round 3, Q4): `bars.status` — by default the focused
   * note's words and characters, "412 words · 2,301 characters" — floating
   * at the bottom right of the editor area, where Obsidian keeps its count.
   * Drawn through `BarItems`, like every readout bar; hosted by
   * `EditorArea`'s floating layer, which puts it on the format bar's row
   * (right-aligned) or, when the area is too narrow for both, above it.
   * Nothing here counts backlinks.
   *
   * `compact` (a small screen, QA round 1): the count readouts
   * (`COUNT_READOUTS`) fold into one small chip at the format bar's right
   * end — the first count as its number alone, "1,204" — and a tap on the
   * chip shows them all in full; another folds them back. Any other readout
   * in the bar is drawn as it is, outside the chip: `sync` is never folded
   * away (golden rule 4).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { SEPARATOR } from '../layout-spec.js'
  import { focusedOf } from '../readout-state.js'
  import { COUNT_READOUTS, type ReadoutContext } from '../readouts.js'
  import BarItems from './BarItems.svelte'

  interface Props {
    /** The readout ids: the layout's `bars.status`. */
    ids: readonly string[]
    ctx: ReadoutContext
    /** Fold the counts into one number chip (a small screen). */
    compact?: boolean
  }

  let { ids, ctx, compact = false }: Props = $props()

  /** Nothing to say about an empty tab or a view: no empty pill in the corner. */
  const shown = $derived(ids.length > 0 && focusedOf(ctx.panes.layout).path !== null)

  const counts = $derived(ids.filter((id) => COUNT_READOUTS.has(id)))
  const others = $derived(ids.filter((id) => !COUNT_READOUTS.has(id) && id !== SEPARATOR))
  let expanded = $state(false)
  // The chip's own context: the same shell state, the counts as bare numbers.
  const chipCtx = $derived(Object.assign(Object.create(ctx) as ReadoutContext, { compact: true }))
  const pill =
    'pointer-events-auto flex h-7 items-center gap-0 rounded-full border border-base-300 bg-base-100 text-xs text-base-content/70 shadow-sm'
</script>

{#if shown && compact && counts.length > 0}
  <div
    role="group"
    aria-label={$LL.web.status_bar.corner()}
    data-testid="corner-status"
    data-compact="true"
    class="{pill} shrink-0"
  >
    <button
      type="button"
      data-testid="corner-status-toggle"
      aria-expanded={expanded}
      onclick={() => (expanded = !expanded)}
      class="flex h-full items-center rounded-full px-2.5 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
    >
      {#if expanded}
        <BarItems ids={counts} {ctx} join={$LL.web.status_bar.join()} />
      {:else}
        <BarItems ids={counts.slice(0, 1)} ctx={chipCtx} />
      {/if}
    </button>
    {#if others.length > 0}
      <span class="flex items-center pr-2.5"><BarItems ids={others} {ctx} join={$LL.web.status_bar.join()} /></span>
    {/if}
  </div>
{:else if shown}
  <div role="group" aria-label={$LL.web.status_bar.corner()} data-testid="corner-status" class="{pill} px-3">
    <BarItems {ids} {ctx} join={$LL.web.status_bar.join()} />
  </div>
{/if}
