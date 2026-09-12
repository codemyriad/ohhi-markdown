<script lang="ts">
  /**
   * The editor's status bar (chrome-shaping U2, tab-groups B3): note-level
   * readouts sit with the note, not in the header. Word count (the one
   * Obsidian status item Chris keeps) and the open note's own sync pill —
   * pure `f(record)`, same as everywhere else.
   *
   * One per PANE now (R4.2): two panes on one note read the same record, so
   * they show the same pill and no lie is possible. `lead` is the pane's own
   * readout ("Pane 2 · 5 tabs"); the focused pane keeps the testids the
   * chrome and collab specs drive.
   */
  import { ChevronDown } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { pillLabel, type PillStatus } from '../pill-status.js'
  import { VIEW_MODES, type ViewMode } from '../panes.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import SyncPill from './SyncPill.svelte'

  interface Props {
    hasNote: boolean
    wordCount: number
    noteStatus: PillStatus | null
    /** Read B3: the open tab's view mode, and the menu that changes it. */
    mode?: ViewMode
    onMode?: (mode: ViewMode) => void
    modeTestid?: string
    /** Left-hand readout: which pane this is, and what it holds. */
    lead?: string
    /** B12: the zoomed pane says so, because the others are not on screen. */
    zoomed?: boolean
    testid?: string
    pillTestid?: string
  }

  let {
    hasNote,
    wordCount,
    noteStatus,
    mode = 'live',
    onMode,
    modeTestid = 'mode-menu',
    lead,
    zoomed = false,
    testid = 'status-bar',
    pillTestid = 'sync-pill-note',
  }: Props = $props()

  const r = $derived($LL.web.read)
</script>

<footer
  data-testid={testid}
  class="flex h-7 shrink-0 items-center gap-4 border-t border-base-300 bg-base-100 px-3 text-xs text-base-content/70"
>
  {#if zoomed}
    <span data-testid="pane-zoomed" class="font-medium text-accent">{$LL.web.panes.zoomed()}</span>
  {/if}
  {#if lead}
    <span class="truncate">{lead}</span>
  {/if}
  <span class="ml-auto flex items-center gap-4">
    {#if hasNote}
      <span data-testid="word-count" class="tabular-nums">
        {$LL.web.status_bar.words({ count: wordCount })}
      </span>
      {#if onMode}
        <!-- The one-of-three choice, as a real menu: `menuitemradio` rows, so
             what is in force is announced rather than only coloured. -->
        <DropdownMenu placement="top-end" testid="{modeTestid}-list">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              data-testid={modeTestid}
              aria-label={r.mode_menu()}
              class="flex items-center gap-1 rounded px-1.5 py-0.5 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
            >
              {r.modes[mode]()}
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          {/snippet}
          {#snippet children(attrs)}
            {#each VIEW_MODES as value (value)}
              <MenuItem
                item={attrs.item}
                checked={mode === value}
                testid="{modeTestid}:{value}"
                onSelect={() => onMode?.(value)}
              >
                {r.modes[value]()}
              </MenuItem>
            {/each}
          {/snippet}
        </DropdownMenu>
      {/if}
      {#if noteStatus}
        <SyncPill status={noteStatus} testid={pillTestid} label={pillLabel(noteStatus)} />
      {/if}
    {/if}
  </span>
</footer>
