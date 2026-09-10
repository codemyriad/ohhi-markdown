<script lang="ts">
  /**
   * The editor's status bar (chrome-shaping U2): note-level readouts sit with
   * the note, not in the header. Word count (the one Obsidian status item
   * Chris keeps) and the open note's own sync pill — pure `f(record)`, same
   * as everywhere else.
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import { pillLabel, type PillStatus } from '../pill-status.js'
  import SyncPill from './SyncPill.svelte'

  interface Props {
    hasNote: boolean
    wordCount: number
    noteStatus: PillStatus | null
  }

  let { hasNote, wordCount, noteStatus }: Props = $props()
</script>

<footer
  data-testid="status-bar"
  class="flex h-7 shrink-0 items-center justify-end gap-4 border-t border-base-300 bg-base-100 px-3 text-xs text-base-content/70"
>
  {#if hasNote}
    <span data-testid="word-count" class="tabular-nums">
      {$LL.web.status_bar.words({ count: wordCount })}
    </span>
    {#if noteStatus}
      <SyncPill status={noteStatus} testid="sync-pill-note" label={pillLabel(noteStatus)} />
    {/if}
  {/if}
</footer>
