<script lang="ts">
  /**
   * The dock's *Comments* tab (writing-harness-shaping B8): the open note's
   * threads, filtered open / resolved / all, each opening its bubble in the
   * editor; and *Export as CriticMarkup*, which writes a review COPY beside
   * the note (`<note> (review).md`) for an Obsidian reader — never the note.
   *
   * QA round 1: the panel is its own door — *Comment on selection* runs the
   * registry's `note.comment` (the format bar's button and `Mod+Shift+M` are
   * the same command), and the empty state names the key in force. The
   * filter is the shell's segmented control (`Tabs size="segmented"`) with
   * counts; the export is a small button at the end, shown only when there is
   * something to export. Text on the settings scale (`META`), no boxes.
   */
  import { MessageSquarePlus } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { ThreadRecord } from '@ohhi/workspace'
  import type { CommandRegistry } from '../commands.js'
  import type { FlashInput } from '../notices.js'
  import { liveThreads } from '../threads.svelte.js'
  import Tabs from '../ui/Tabs.svelte'
  import { BUTTON_SM, META, MUTED } from '../ui/styles.js'
  import type { Workspace } from '../workspace.svelte.js'

  interface Props {
    /** The open note, or null. */
    path: string | null
    workspace: Pick<Workspace, 'threadsFor' | 'resolveThread' | 'exportCriticMarkup'>
    /** Open the thread's bubble in an editor on the note. */
    onOpen: (threadId: string) => void
    /** The review copy was written: open it. */
    onExported?: (path: string) => void
    flash?: (input: FlashInput) => void
    /** The shell's registry: the door runs `note.comment` through it, and the hint names its key. */
    registry?: Pick<CommandRegistry, 'get' | 'binding'>
  }

  let { path, workspace, onOpen, onExported, flash, registry }: Props = $props()

  const COMMENT = 'note.comment'

  const t = $derived($LL.web.ai.comments)
  const live = liveThreads(() => (path ? workspace.threadsFor(path) : null))
  let filter = $state<string>('open')
  let exporting = $state(false)

  const openCount = $derived(live.list.filter((x) => !x.resolved).length)
  const resolvedCount = $derived(live.list.length - openCount)
  const filters = $derived([
    { value: 'open', label: t.filter_count({ label: t.filter_open(), count: openCount }), testid: 'thread-filter:open' },
    {
      value: 'resolved',
      label: t.filter_count({ label: t.filter_resolved(), count: resolvedCount }),
      testid: 'thread-filter:resolved',
    },
    { value: 'all', label: t.filter_all(), testid: 'thread-filter:all' },
  ])
  const shownFor = (f: string): ThreadRecord[] =>
    live.list.filter((x) => (f === 'all' ? true : f === 'resolved' ? x.resolved : !x.resolved))
  const emptyFor = (f: string): string =>
    f === 'open' ? t.empty_open() : f === 'resolved' ? t.empty_resolved() : t.empty_all()
  /** Where the door is, with the key in force as this platform prints it (a cleared binding → the bar alone). */
  const how = $derived.by(() => {
    const key = registry?.binding(COMMENT) ?? ''
    return key ? t.how_with_key({ key }) : t.how()
  })

  /** One line of the passage: what the thread is about. */
  function excerpt(thread: ThreadRecord): string {
    const q = thread.anchor.quote.exact.replace(/\s+/g, ' ').trim()
    return q.length > 80 ? `${q.slice(0, 80)}…` : q
  }

  /** The door: the same command as the bar's button and the key — never a second code path. */
  function comment(): void {
    void registry?.get(COMMENT)?.run()
  }
  /** Keep the editor's selection (and focus) when the door is pressed with a pointer. */
  const keepEditorFocus = (e: MouseEvent): void => e.preventDefault()

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

  /** A row's verb: borderless and 11 px, so the list reads as text, not boxes. */
  const rowVerb = `shrink-0 rounded px-1.5 py-0.5 text-[11px] ${MUTED} hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary`
</script>

<div data-testid="thread-list" class="flex flex-col gap-2 p-1">
  {#if !path}
    <p class="m-0 px-1 {META}">{t.no_note()}</p>
  {:else}
    {#if registry}
      <div class="flex px-1">
        <button type="button" class={BUTTON_SM} data-testid="thread-comment" onmousedown={keepEditorFocus} onclick={comment}>
          <MessageSquarePlus size={14} strokeWidth={1.75} aria-hidden="true" />
          {t.door()}
        </button>
      </div>
    {/if}
    <div class="px-1">
      <Tabs tabs={filters} bind:value={filter} label={t.filter()} testid="thread-filters" size="segmented">
        {#snippet panel(f)}
          {@const shown = shownFor(f)}
          {#if shown.length === 0}
            <div class="flex flex-col gap-1">
              <p class="m-0 {META}">{emptyFor(f)}</p>
              {#if f !== 'resolved'}<p class="m-0 {META}" data-testid="thread-how">{how}</p>{/if}
            </div>
          {:else}
            <h3 class="sr-only">{t.list()}</h3>
            <ul class="-mx-1 flex flex-col">
              {#each shown as thread (thread.id)}
                <li data-testid="thread:{thread.id}" class="flex items-start gap-1 rounded px-1 py-1 text-xs hover:bg-base-200">
                  <button type="button" class="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onclick={() => onOpen(thread.id)}>
                    {#if excerpt(thread)}
                      <span class="truncate border-l-2 border-base-300 pl-1.5 {MUTED}">{excerpt(thread)}</span>
                    {/if}
                    <span class="truncate"><span class="font-semibold">{thread.comments[0]?.author ?? thread.author}</span>
                      {thread.comments[0]?.body ?? ''}</span
                    >
                    {#if thread.comments.length > 1}
                      <span class={MUTED}>{t.replies({ count: thread.comments.length - 1 })}</span>
                    {/if}
                  </button>
                  <button
                    type="button"
                    class={rowVerb}
                    data-testid="thread-resolve:{thread.id}"
                    onclick={() => path && workspace.resolveThread(path, thread.id, !thread.resolved)}
                    >{thread.resolved ? t.reopen() : t.resolve()}</button
                  >
                </li>
              {/each}
            </ul>
          {/if}
        {/snippet}
      </Tabs>
    </div>

    {#if openCount > 0}
      <div class="flex justify-end px-1">
        <button type="button" class={BUTTON_SM} data-testid="thread-export" disabled={exporting} onclick={exportReview}
          >{t.export()}</button
        >
      </div>
    {/if}
  {/if}
</div>
