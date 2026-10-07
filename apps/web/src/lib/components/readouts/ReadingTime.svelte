<script lang="ts">
  /** `reading-time` (quiet-shell F6): the focused note at 200 words a minute, rounded up. */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { targetOf, type ReadoutContext } from '../../readouts.js'
  import { countWords, readingMinutes } from '../../words.js'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const focused = $derived(targetOf(ctx))
  const minutes = $derived.by(() => {
    ctx.nav.revision
    const doc = focused.path ? ctx.workspace.docForPath(focused.path) : null
    return readingMinutes(doc ? countWords(doc.getText()) : 0)
  })
  const t = $derived($LL.web.toolbar)
</script>

{#if focused.path}
  <span data-testid="reading-time" class="whitespace-nowrap tabular-nums">
    {minutes > 0 ? t.reading_time({ minutes }) : t.reading_time_none()}
  </span>
{/if}
