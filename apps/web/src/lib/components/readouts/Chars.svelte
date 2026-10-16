<script lang="ts">
  /**
   * `chars` (round 3, Q4): the focused note's character count — of the
   * selection while there is one — counted beside `words` over the same text
   * (`note-count.svelte.ts`, `countChars` in `words.ts`).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { noteCount } from '../../note-count.svelte.js'
  import { readoutTestid, type ReadoutContext } from '../../readouts.js'
  import { countChars } from '../../words.js'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const chars = noteCount(() => ctx, countChars)
</script>

{#if chars.path}
  <span data-testid={readoutTestid(ctx, 'char-count')} class="whitespace-nowrap tabular-nums">
    {#if ctx.compact}
      <span aria-hidden="true">{$LL.web.status_bar.count({ count: chars.value })}</span><span class="sr-only"
        >{$LL.web.status_bar.chars({ count: chars.value })}</span
      >
    {:else}
      {$LL.web.status_bar.chars({ count: chars.value })}
    {/if}
  </span>
{/if}
