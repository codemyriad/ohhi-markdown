<script lang="ts">
  /**
   * The dock's context line (QA feedback round 1): which note the sections
   * under it are about — "untitled-3 · Competitors" — so with several panes
   * open the dock never leaves you guessing. It reads `ui.dockNote`, the one
   * value every dock section reads (`dock-note.ts`), so the line and the
   * bodies cannot disagree. While a session, a collection or Settings has
   * the focus the dock keeps the note focused last and the line says so,
   * quietly. A click goes to the note: the pane already holding it takes the
   * focus, else it opens beside the focused view (`openPath`, `beside`).
   *
   * No note yet → nothing: each section's own empty state says "Open a note…".
   */
  import { FileText } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { noteContext, type DockNote } from '../dock-note.js'
  import { META, MUTED } from '../ui/styles.js'
  import { getViewShell } from '../views.js'

  interface Props {
    note: DockNote | null
  }

  let { note }: Props = $props()

  const shell = getViewShell()
  const t = $derived($LL.web.rail.note)
  const named = $derived(note ? noteContext(note.path) : null)
</script>

{#if note && named}
  <div
    role="group"
    aria-label={t.label()}
    data-testid="dock-note"
    data-path={note.path}
    data-last-focused={note.lastFocused}
    class="flex min-h-7 min-w-0 shrink-0 items-center gap-1 border-b border-base-200 px-2 py-0.5"
  >
    <button
      type="button"
      data-testid="dock-note-go"
      aria-label={t.go({ name: named.name })}
      class="flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-start hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      onclick={() => shell?.openPath(note.path, { beside: true })}
    >
      <FileText size={13} strokeWidth={1.75} aria-hidden="true" class="shrink-0 {MUTED}" />
      <span class="truncate text-[13px] font-medium text-base-content">{named.name}</span>
      {#if named.folder}
        <span aria-hidden="true" class={META}>·</span>
        <span class="truncate {META}">{named.folder}</span>
      {/if}
    </button>
    {#if note.lastFocused}
      <span data-testid="dock-note-last" class="shrink-0 whitespace-nowrap {META}">— {t.last_focused()}</span>
    {/if}
  </div>
{/if}
