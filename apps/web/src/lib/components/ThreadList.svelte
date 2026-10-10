<script lang="ts">
  /**
   * The dock's *Comments* tab (writing-harness-shaping B8): the open note's
   * threads, filtered open / resolved / all, each opening its bubble in the
   * editor; and *Export as CriticMarkup*, which writes a review COPY beside
   * the note (`<note> (review).md`) for an Obsidian reader — never the note.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ThreadRecord } from '@ohhi/workspace'
  import type { FlashInput } from '../notices.js'
  import { liveThreads } from '../threads.svelte.js'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import type { Workspace } from '../workspace.svelte.js'

  type Filter = 'open' | 'resolved' | 'all'

  interface Props {
    /** The open note, or null. */
    path: string | null
    workspace: Pick<Workspace, 'threadsFor' | 'resolveThread' | 'exportCriticMarkup'>
    /** Open the thread's bubble in an editor on the note. */
    onOpen: (threadId: string) => void
    /** The review copy was written: open it. */
    onExported?: (path: string) => void
    flash?: (input: FlashInput) => void
  }

  let { path, workspace, onOpen, onExported, flash }: Props = $props()

  const t = $derived($LL.web.ai.comments)
  const live = liveThreads(() => (path ? workspace.threadsFor(path) : null))
  let filter = $state<Filter>('open')
  let exporting = $state(false)

  const shown = $derived(
    live.list.filter((x) => (filter === 'all' ? true : filter === 'resolved' ? x.resolved : !x.resolved))
  )
  const openCount = $derived(live.list.filter((x) => !x.resolved).length)
  const FILTERS: Filter[] = ['open', 'resolved', 'all']
  const filterLabel = (f: Filter): string =>
    f === 'open' ? t.filter_open() : f === 'resolved' ? t.filter_resolved() : t.filter_all()
  const empty = $derived(filter === 'open' ? t.empty_open() : filter === 'resolved' ? t.empty_resolved() : t.empty_all())

  /** One line of the passage: what the thread is about. */
  function excerpt(thread: ThreadRecord): string {
    const q = thread.anchor.quote.exact.replace(/\s+/g, ' ').trim()
    return q.length > 80 ? `${q.slice(0, 80)}…` : q
  }

  async function exportReview(): Promise<void> {
    if (!path || exporting) return
    exporting = true
    try {
      const out = await workspace.exportCriticMarkup(path)
      if (!out.path) {
        const none = out.written === 0 && out.skipped === 0
        flash?.(none ? { level: 'info', text: t.export_none() } : { level: 'error', text: t.export_failed() })
        return
      }
      flash?.({ level: 'info', text: t.exported({ path: out.path }) })
      if (out.skipped > 0) flash?.({ level: 'warn', text: t.export_skipped({ count: out.skipped }) })
      onExported?.(out.path)
    } catch {
      flash?.({ level: 'error', text: t.export_failed() })
    } finally {
      exporting = false
    }
  }

  const chip = `${OUTLINE_BUTTON} px-2 py-0.5 text-[11px]`
</script>

<div data-testid="thread-list" class="flex flex-col gap-2">
  {#if !path}
    <p class="px-3 py-2 text-xs text-base-content/70">{t.no_note()}</p>
  {:else}
    <div class="flex items-center gap-1 px-2" role="group" aria-label={t.filter()}>
      {#each FILTERS as f (f)}
        <button
          type="button"
          class="{chip} {filter === f ? 'border-primary bg-primary text-primary-content hover:bg-primary/90' : ''}"
          aria-pressed={filter === f}
          data-testid="thread-filter:{f}"
          onclick={() => (filter = f)}>{filterLabel(f)}</button
        >
      {/each}
    </div>

    {#if shown.length === 0}
      <p class="px-3 py-1 text-xs text-base-content/70">{empty}</p>
    {:else}
      <h3 class="sr-only">{t.list()}</h3>
      <ul class="flex flex-col">
        {#each shown as thread (thread.id)}
          <li data-testid="thread:{thread.id}" class="group flex items-start gap-1 rounded px-2 py-1 hover:bg-base-200">
            <button type="button" class="flex min-w-0 flex-1 flex-col text-left" onclick={() => onOpen(thread.id)}>
              {#if excerpt(thread)}
                <span class="truncate border-l-2 border-base-300 pl-1.5 text-base-content/70">{excerpt(thread)}</span>
              {/if}
              <span class="truncate"><span class="font-semibold">{thread.comments[0]?.author ?? thread.author}</span>
                {thread.comments[0]?.body ?? ''}</span
              >
              {#if thread.comments.length > 1}
                <span class="text-base-content/70">{t.replies({ count: thread.comments.length - 1 })}</span>
              {/if}
            </button>
            <button
              type="button"
              class="{chip} shrink-0"
              data-testid="thread-resolve:{thread.id}"
              onclick={() => path && workspace.resolveThread(path, thread.id, !thread.resolved)}
              >{thread.resolved ? t.reopen() : t.resolve()}</button
            >
          </li>
        {/each}
      </ul>
    {/if}

    <div class="px-2 pt-1">
      <button
        type="button"
        class="{OUTLINE_BUTTON} w-full px-2 py-1 text-xs"
        data-testid="thread-export"
        disabled={openCount === 0 || exporting}
        onclick={exportReview}>{t.export()}</button
      >
    </div>
  {/if}
</div>
