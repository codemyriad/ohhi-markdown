<script lang="ts">
  /**
   * The editor's status bar (chrome-shaping U2): note-level readouts sit with
   * the note, not in the header. Word count (the one Obsidian status item
   * Chris keeps) and the open note's own sync pill — pure `f(record)`, same
   * as everywhere else.
   */
  import { PILL_LABELS, type PillStatus } from '../pill-status.js'
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
      {wordCount}
      {wordCount === 1 ? 'word' : 'words'}
    </span>
    {#if noteStatus}
      <SyncPill status={noteStatus} testid="sync-pill-note" label={PILL_LABELS[noteStatus]} />
    {/if}
  {/if}
</footer>
