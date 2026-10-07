<script lang="ts">
  /**
   * `pane.lead` (quiet-shell F6): which pane has the focus and what it holds —
   * "Pane 2 · 3 tabs" — and, when the focused note holds peers, who you are
   * with in it (sharing E1): "with Cynthia". Nothing extra when alone (R6).
   *
   * The per-pane status bar renders this too, for its own pane: the lead only
   * when the layout's `panes.lead` asks for it, the "with …" always, under
   * the status bar's testids (`status-bar-with`, `pane-status:<id>-with`).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { withNames } from '../../presence.js'
  import { focusedPeers, leadText } from '../../readout-state.js'
  import { statusBarTestid, targetOf, type ReadoutContext } from '../../readouts.js'
  import PresenceStack from '../PresenceStack.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const focused = $derived(targetOf(ctx))
  const peers = $derived(focusedPeers(ctx.panes.layout, ctx.workspace.ui.presenceByPath, ctx.pane?.id))
  const together = $derived(withNames(peers))
  const withId = $derived(ctx.pane ? `${statusBarTestid(ctx.pane)}-with` : 'pane-with')
  const p = $derived($LL.web.presence)
</script>

{#if ctx.pane?.lead ?? true}
  <span data-testid={ctx.pane ? undefined : 'toolbar-pane-lead'} class="truncate">
    {leadText(ctx.panes.paneIndex(focused.pane.id), focused.pane.tabs.length, $LL)}
  </span>
{/if}
{#if together}
  <span data-testid={withId} class="inline-flex shrink-0 items-center gap-1">
    <PresenceStack {peers} testid="{withId}-stack" />
    <span>
      {together.kind === 'one'
        ? p.with_one({ a: together.a })
        : together.kind === 'two'
          ? p.with_two({ a: together.a, b: together.b })
          : p.with_many({ a: together.a, count: together.count })}
    </span>
  </span>
{/if}
