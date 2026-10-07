<script lang="ts">
  /**
   * The Log view (quiet-shell F12, spike S22 Stage 4a): a view tab over the
   * session's event log (`ui.events`), newest first — the rail's Activity
   * section grown up. Filters: level (multi-select chips), scope (all, this
   * vault, one shared folder, the note last in focus) and time; the rules are
   * `log-view.ts`'s. *Copy as text* puts a plain-text report of the rows on
   * screen onto the clipboard (and, when the clipboard is blocked, shows it
   * to select by hand); *Clear* forgets the session's events after a confirm.
   * In memory, like the log itself; persistence is Stage 4c.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { CHANGE_KINDS, type EventKind, type EventLevel } from '@ohhi/workspace'
  import { filterLog, LOG_LEVELS, logReport, type LogScope, type LogTime } from '../log-view.js'
  import { clockTick } from '../relative-time.js'
  import { getViewShell, shellClock, type ViewProps } from '../views.js'
  import { HEADING } from '../ui/styles.js'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import EventRow from './EventRow.svelte'

  interface Props extends ViewProps {
    /** Injected for the tests; the shell's injected clock otherwise. */
    clock?: Clock
    /** Write the report to the clipboard; injected for the tests. */
    writeClipboard?: (text: string) => Promise<void>
    /**
     * The filter it opens with. Absent → the tab's argument decides: `changes`
     * (the Shared view's *Show all*) opens on the change kinds only, and
     * `problems` (the drawer's) on errors and warnings.
     */
    initial?: { kinds?: readonly EventKind[] }
  }

  /** A path chip opens its note through the shell (App's `openPath`); no shell → shown, not linked. */
  const shell = getViewShell()
  const onOpenPath = shell ? (path: string): void => shell.openPath(path) : undefined

  let {
    workspace,
    tab,
    initial,
    clock = shellClock(),
    writeClipboard = (text) => navigator.clipboard.writeText(text),
  }: Props = $props()

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)

  // `problems` (the drawer's *See all*, foundations-plan P6): errors and warnings.
  // svelte-ignore state_referenced_locally -- seed only
  let levels = $state<EventLevel[]>(tab?.viewArg === 'problems' ? ['error', 'warn'] : [...LOG_LEVELS])
  /** Kinds narrowed to (null = every kind). Seeded once; the chip clears it. */
  // svelte-ignore state_referenced_locally -- seed only
  let kinds = $state<readonly EventKind[] | null>(
    initial?.kinds ?? (tab?.viewArg === 'changes' ? [...CHANGE_KINDS] : null)
  )
  /** The scope picker's value: 'all' | 'vault' | 'note' | 'mount:<room>'. */
  let scopeKey = $state('all')
  let time = $state<LogTime>('all')
  /**
   * The note last in focus. With this tab active the focused pane has no
   * note, so "this note" means the one the person was just looking at.
   */
  let lastNote = $state<string | null>(null)
  $effect(() => {
    const p = workspace.ui.selectedPath
    if (p) lastNote = p
  })

  const mounts = $derived(workspace.ui.mounts.map((m) => ({ path: m.path, room: m.room })))
  const scope = $derived.by<LogScope>(() => {
    if (scopeKey === 'vault') return { kind: 'vault' }
    if (scopeKey === 'note' && lastNote) return { kind: 'note', path: lastNote }
    if (scopeKey.startsWith('mount:')) {
      const m = mounts.find((x) => `mount:${x.room}` === scopeKey)
      if (m) return { kind: 'mount', ...m }
    }
    return { kind: 'all' }
  })
  const rows = $derived(filterLog(workspace.ui.events, { levels, scope, time, kinds }, mounts, $tick))

  function toggleLevel(level: EventLevel): void {
    levels = levels.includes(level) ? levels.filter((l) => l !== level) : LOG_LEVELS.filter((l) => l === level || levels.includes(l))
  }

  /** The report, when the clipboard refused it: shown to copy by hand. */
  let fallback = $state<string | null>(null)
  async function copy(): Promise<void> {
    const text = logReport(rows, clock.now(), $LL)
    try {
      await writeClipboard(text)
      fallback = null
      workspace.flash({ level: 'info', text: $LL.web.log.copied() })
    } catch {
      fallback = text
    }
  }

  let confirmClear = $state(false)

  const t = $derived($LL.web.log)
  const chip =
    'rounded-full border border-base-300 px-2 py-0.5 text-[11px] text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary aria-pressed:border-primary aria-pressed:bg-base-200 aria-pressed:text-base-content'
  const action =
    'rounded border border-base-300 px-2 py-0.5 text-[11px] text-base-content/80 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-40'
  const TIMES: LogTime[] = ['today', 'week', 'all']
</script>

<section data-testid="log-view" aria-labelledby="log-view-title" class="flex h-full min-h-0 flex-col text-xs">
  <header class="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-base-200 px-3 py-2">
    <h2 id="log-view-title" class="m-0 {HEADING}">{kinds ? t.title_changes() : t.title()}</h2>
    <div role="group" aria-label={t.level_label()} class="flex items-center gap-1">
      {#each LOG_LEVELS as level (level)}
        <button
          type="button"
          data-testid="log-level:{level}"
          aria-pressed={levels.includes(level)}
          onclick={() => toggleLevel(level)}
          class={chip}>{t.levels[level]()}</button
        >
      {/each}
    </div>
    <label class="flex items-center gap-1 text-base-content/80">
      {t.scope_label()}
      <select
        data-testid="log-scope"
        bind:value={scopeKey}
        class="rounded border border-base-300 bg-base-100 px-1 py-0.5 text-[11px] text-base-content"
      >
        <option value="all">{t.scope.all()}</option>
        <option value="vault">{t.scope.vault()}</option>
        {#each mounts as m (m.room)}
          <option value="mount:{m.room}">{t.scope.mount({ path: m.path })}</option>
        {/each}
        <option value="note" disabled={!lastNote}>{t.scope.note()}</option>
      </select>
    </label>
    {#if kinds}
      <button type="button" data-testid="log-kinds" aria-pressed="true" title={t.show_everything()} onclick={() => (kinds = null)} class={chip}
        >{t.changes_only()} ✕</button
      >
    {/if}
    <div role="group" aria-label={t.time_label()} class="flex items-center gap-1">
      {#each TIMES as span (span)}
        <button
          type="button"
          data-testid="log-time:{span}"
          aria-pressed={time === span}
          onclick={() => (time = span)}
          class={chip}>{t.time[span]()}</button
        >
      {/each}
    </div>
    <div class="ml-auto flex items-center gap-1">
      <button type="button" data-testid="log-copy" disabled={rows.length === 0} onclick={() => void copy()} class={action}
        >{t.copy()}</button
      >
      <button
        type="button"
        data-testid="log-clear"
        disabled={workspace.ui.events.length === 0}
        onclick={() => (confirmClear = true)}
        class={action}>{t.clear()}</button
      >
    </div>
  </header>

  {#if fallback !== null}
    <div class="border-b border-base-200 px-3 py-2">
      <p role="status" class="mb-1 text-base-content/80">{t.copy_failed()}</p>
      <textarea
        data-testid="log-copy-fallback"
        readonly
        aria-label={t.copy_fallback_label()}
        rows="6"
        class="w-full rounded border border-base-300 bg-base-100 p-1 font-ed-mono text-[11px] text-base-content"
        >{fallback}</textarea
      >
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto">
    {#if rows.length === 0}
      <p data-testid="log-empty" class="px-3 py-2 text-base-content/70">
        {workspace.ui.events.length === 0 ? t.empty() : t.empty_filtered()}
      </p>
    {:else}
      <ol data-testid="log-rows" aria-label={t.list_label()} class="divide-y divide-base-200 text-base-content/80">
        {#each rows as event (event.id)}
          <EventRow {event} now={$tick} {onOpenPath} />
        {/each}
      </ol>
    {/if}
  </div>
</section>

{#if confirmClear}
  <ConfirmDialog
    title={t.clear_confirm.title()}
    body={t.clear_confirm.body()}
    confirmLabel={t.clear_confirm.confirm()}
    danger
    testid="log-clear-confirm"
    onConfirm={() => {
      workspace.clearEvents()
      fallback = null
      confirmClear = false
    }}
    onCancel={() => (confirmClear = false)}
  />
{/if}
