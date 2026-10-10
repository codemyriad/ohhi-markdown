<script lang="ts">
  /**
   * `last-agent-write` (quiet-shell F6, back with the agent layer —
   * writing-harness B7): "Tighten edited Plan 3 min ago", from the event
   * log's newest `doc.changed` by the in-app agent (`lastAgentWrite`), aged
   * on the injected clock. Nothing at all when the agent has not written —
   * so it costs no room in a bar until it has something to say. Clicking it
   * opens the note through the `ViewShell`.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { noteName } from '../../presence.js'
  import { readoutTestid, type ReadoutContext } from '../../readouts.js'
  import { clockTick, relativeTime } from '../../relative-time.js'
  import { lastAgentWrite } from '../../suggestions.svelte.js'
  import { getViewShell, shellClock } from '../../views.js'

  interface Props {
    ctx: Pick<ReadoutContext, 'workspace' | 'merged' | 'pane'>
    /** Injected for the tests; the shell's injected clock otherwise. */
    clock?: Clock
  }

  const shell = getViewShell()
  let { ctx, clock = shellClock() }: Props = $props()

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)
  const last = $derived(lastAgentWrite(ctx.workspace.ui.events))
  const note = $derived(last ? noteName(last.path) : '')
</script>

{#if last}
  <button
    type="button"
    data-testid={readoutTestid(ctx, 'last-agent-write')}
    class="cursor-pointer truncate whitespace-nowrap rounded px-1 text-base-content/70 hover:bg-base-200 hover:text-base-content"
    title={$LL.web.ai.suggest.last_write_title({ note })}
    onclick={() => shell?.openPath(last.path)}
  >
    {$LL.web.ai.suggest.last_write({ name: last.name, note, ago: relativeTime(last.at, $tick, $LL) })}
  </button>
{/if}
