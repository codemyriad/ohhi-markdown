<script lang="ts">
  /**
   * `words` (quiet-shell F6): the focused note's word count — of the
   * SELECTION while there is one, as Obsidian's status item does. The
   * per-pane status bar renders this same readout for its own pane
   * (`ctx.pane`), so the toolbar, the corner and the status bar cannot
   * disagree. The counting is `note-count.svelte.ts`, shared with `chars`.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { noteCount } from '../../note-count.svelte.js'
  import { readoutTestid, type ReadoutContext } from '../../readouts.js'
  import { countWords } from '../../words.js'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const words = noteCount(() => ctx, countWords)
</script>

{#if words.path}
  <span data-testid={readoutTestid(ctx, 'word-count')} class="whitespace-nowrap tabular-nums">
    {#if ctx.compact}
      <!-- The small screen's corner chip (QA round 1): the number for the eye, the words for a screen reader. -->
      <span aria-hidden="true">{$LL.web.status_bar.count({ count: words.value })}</span><span class="sr-only"
        >{$LL.web.status_bar.words({ count: words.value })}</span
      >
    {:else}
      {$LL.web.status_bar.words({ count: words.value })}
    {/if}
  </span>
{/if}
