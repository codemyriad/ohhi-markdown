<script lang="ts">
  /**
   * The pane mode's hint bar (tab-groups B12, Fork 6-A): docked at the bottom
   * of the editor area **only while a mode is live**, so the per-pane status
   * bars never move.
   *
   * The rows are `mode.ts`'s tables read through the command registry, which
   * is what makes the bar and the palette one table rather than two: a
   * rebound key changes both, and a command W2 has not registered yet simply
   * has no row.
   *
   * Only with Settings › Layout › Pane keys at *Full* (E6): *Subtle* (the
   * default) and *Off* show the keys in the corner instead (`ModeCue`).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { paneHints } from '../pane-hints.svelte.js'
  import { KBD } from '../ui/styles.js'
  import type { PaneShell } from '../workspace-panes.svelte.js'

  interface Props {
    panes: PaneShell
  }

  let { panes }: Props = $props()

  const t = $derived($LL.web.mode)
</script>

{#if panes.mode && paneHints.value === 'full'}
  <!-- role=status: entering a mode changes what every key does, which a
       screen-reader user must hear without being moved there. -->
  <div
    role="status"
    aria-label={t.bar()}
    data-testid="mode-bar"
    data-mode={panes.mode}
    class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-base-300 bg-base-100 px-3 py-1.5 text-xs text-base-content/70"
  >
    <span
      data-testid="mode-badge"
      class="rounded bg-primary px-2 py-0.5 text-[10px] font-bold tracking-widest text-primary-content"
    >
      {panes.modeBadge()}
    </span>
    {#each panes.hints() as hint (hint.key)}
      <span class="inline-flex items-center gap-1.5 whitespace-nowrap {hint.sub ? 'text-base-content' : ''}">
        <kbd class={KBD}>{hint.key}</kbd>
        {hint.label}
      </span>
    {/each}
    <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
      <kbd class={KBD}>{$LL.common.keys.escape()}</kbd>
      {panes.escapeLabel()}
    </span>
  </div>
{/if}
