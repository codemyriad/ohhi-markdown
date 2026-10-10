<script lang="ts">
  /**
   * The pane mode's corner cue (E6; Settings › Layout › Pane keys). While a
   * mode is live and the hints are *Subtle* (the default) or *Off*, the keys
   * sit in the editor area's bottom-right corner — the focused pane's
   * corner, directly above the word count — instead of the full bar along
   * the bottom (`ModeBar.svelte`, which *Full* keeps).
   *
   * Subtle: one quiet line — the mode's badge, its two most-used verbs
   * (`mode-cue.ts`) and `?` keys. Off: the badge alone. `?` (the pane mode
   * itself takes the key) opens every key of the mode in a small card above
   * the line, and closes it again. Nothing here is interactive: the keyboard
   * belongs to the mode, so the card is a status region, not a popover.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { cueHints } from '../mode-cue.js'
  import { paneHints } from '../pane-hints.svelte.js'
  import type { PaneShell } from '../workspace-panes.svelte.js'

  interface Props {
    panes: PaneShell
  }

  let { panes }: Props = $props()

  const t = $derived($LL.web.mode)
  const level = $derived(paneHints.value)
  const shown = $derived(panes.mode !== null && level !== 'full')
  const rows = $derived(panes.mode ? panes.hints() : [])
  const verbs = $derived(panes.mode && level === 'subtle' ? cueHints(panes.mode, rows) : [])

  const kbd = 'rounded border border-base-300 border-b-2 bg-base-200 px-1 font-ed-mono text-[10px] text-base-content'
</script>

{#if shown}
  <div class="pointer-events-none flex flex-col items-end gap-1" data-testid="mode-cue" data-level={level}>
    {#if panes.modeKeysOpen}
      <!-- Every key of the mode: `?` again, or leaving the mode, closes it. -->
      <div
        role="status"
        aria-label={t.cue.all()}
        data-testid="mode-cue-all"
        class="grid max-w-[min(28rem,90vw)] grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-xs text-base-content/70 shadow-sm"
      >
        {#each rows as hint (hint.key)}
          <kbd class="{kbd} justify-self-end">{hint.key}</kbd>
          <span class="whitespace-nowrap {hint.sub ? 'text-base-content' : ''}">{hint.label}</span>
        {/each}
        <kbd class="{kbd} justify-self-end">{t.escape()}</kbd>
        <span class="whitespace-nowrap">{panes.escapeLabel()}</span>
      </div>
    {/if}
    <!-- role=status: entering a mode changes what every key does, which a
         screen-reader user must hear without being moved there. -->
    <div
      role="status"
      aria-label={t.cue.label()}
      data-testid="mode-cue-line"
      data-mode={panes.mode}
      class="flex items-center gap-2 whitespace-nowrap rounded-md bg-base-100/85 px-1.5 py-0.5 text-[11px] text-base-content/70"
    >
      <span
        data-testid="mode-badge"
        class="rounded bg-primary px-1.5 py-px text-[9.5px] font-bold tracking-widest text-primary-content"
      >
        {panes.modeBadge()}
      </span>
      {#each verbs as hint (hint.key)}
        <span class="inline-flex items-center gap-1"><kbd class={kbd}>{hint.key}</kbd>{hint.label}</span>
      {/each}
      {#if level === 'subtle'}
        <span class="inline-flex items-center gap-1">
          <kbd class={kbd}>{t.cue.more_key()}</kbd>{panes.modeKeysOpen ? t.cue.less() : t.cue.more()}
        </span>
      {/if}
    </div>
  </div>
{/if}
