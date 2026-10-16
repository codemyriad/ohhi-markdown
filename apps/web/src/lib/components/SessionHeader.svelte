<script lang="ts" module>
  /** A run's elapsed time in words: `12s`, `3m 4s`. */
  export function elapsedWords(ms: number, t: { elapsed_seconds(a: { n: number }): string; elapsed_minutes(a: { m: number; s: number }): string }): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    return total < 60 ? t.elapsed_seconds({ n: total }) : t.elapsed_minutes({ m: Math.floor(total / 60), s: total % 60 })
  }
</script>

<script lang="ts">
  /**
   * The Session view's header (writing-harness-shaping B4): the session's
   * title (edited in place — Enter or blur saves, Escape puts it back), the
   * sessions menu (`ui/DropdownMenu`: *New session*, the recent ones,
   * *Rename…*, *Archive*), and the run's status with its elapsed time on the injected clock, *Stop* while it
   * runs and *Retry* after it failed or stopped. The provider the next run
   * goes to is chosen at the composer's foot (QA round 1, Fork 6).
   */
  import { History, RotateCcw, Square } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { RunRecord } from '@ohhi/harness'
  import type { Clock } from '@ohhi/vault'
  import { clockTick } from '../relative-time.js'
  import type { SessionSummary } from '../session-store.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSection from '../ui/MenuSection.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'

  interface Props {
    sessionId: string
    title?: string
    run: RunRecord | null
    /** The vault's sessions, newest first. */
    sessions: SessionSummary[]
    clock: Clock
    onRename(title: string): void
    onNew(): void
    onPick(id: string): void
    onArchive(): void
    onStop(): void
    onRetry?(): void
  }

  let {
    sessionId,
    title,
    run,
    sessions,
    clock,
    onRename,
    onNew,
    onPick,
    onArchive,
    onStop,
    onRetry,
  }: Props = $props()

  const t = $derived($LL.web.ai.session)
  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock, 1000)

  let draft = $state('')
  let editing = $state(false)
  let titleInput = $state<HTMLInputElement>()
  $effect(() => {
    if (!editing) draft = title ?? ''
  })

  function commit(): void {
    editing = false
    const next = draft.trim()
    if (next !== (title ?? '')) onRename(next)
  }

  const live = $derived(run?.status === 'scheduled' || run?.status === 'running')
  const elapsed = $derived.by(() => {
    if (!run?.startedAt) return ''
    const end = run.endedAt ?? $tick
    return elapsedWords(end - run.startedAt, t)
  })
  const recent = $derived(sessions.slice(0, 8))
</script>

<header data-testid="session-header" class="flex items-center gap-2 border-b border-base-200 px-3 py-1.5">
  <DropdownMenu testid="session-menu">
    {#snippet trigger(attrs)}
      <button
        use:melt={attrs}
        type="button"
        aria-label={t.menu()}
        data-testid="session-menu-trigger"
        class="inline-flex shrink-0 items-center rounded p-1 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      >
        <History size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/snippet}
    {#snippet children({ item, separator })}
      <MenuItem {item} testid="session-new" onSelect={onNew}>{t.new()}</MenuItem>
      <MenuSeparator {separator} />
      <MenuSection label={t.recent()}>
        {#each recent as s (s.id)}
          <MenuItem {item} testid="session-pick:{s.id}" checked={s.id === sessionId} onSelect={() => onPick(s.id)}>
            {s.title ?? t.untitled()}
          </MenuItem>
        {:else}
          <p class="m-0 px-3 py-1.5 text-xs text-base-content/70">{t.none_recent()}</p>
        {/each}
      </MenuSection>
      <MenuSeparator {separator} />
      <MenuItem
        {item}
        testid="session-rename"
        onSelect={() => {
          editing = true
          queueMicrotask(() => titleInput?.select())
        }}>{t.rename()}</MenuItem
      >
      <MenuItem {item} testid="session-archive" onSelect={onArchive}>{t.archive()}</MenuItem>
    {/snippet}
  </DropdownMenu>

  <input
    bind:this={titleInput}
    bind:value={draft}
    data-testid="session-title"
    aria-label={t.rename_label()}
    placeholder={t.untitled()}
    onfocus={() => (editing = true)}
    onblur={commit}
    onkeydown={(e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        titleInput?.blur()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        draft = title ?? ''
        editing = false
        titleInput?.blur()
      }
    }}
    class="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-semibold text-base-content placeholder:text-base-content/70 hover:border-base-300 focus-visible:border-base-300 focus-visible:outline-2 focus-visible:outline-primary"
  />

  {#if run}
    <span
      data-testid="session-run-status"
      data-status={run.status}
      title={run.status === 'failed' && run.error ? t.failed({ message: run.error }) : undefined}
      class="shrink-0 rounded-full border border-base-300 px-2 py-0.5 text-[11px] {run.status === 'failed'
        ? 'text-error'
        : 'text-base-content/80'}"
    >
      {elapsed ? t.run({ status: t.status[run.status](), elapsed }) : t.status[run.status]()}
    </span>
  {/if}
  {#if live}
    <IconButton icon={Square} label={t.stop()} testid="session-stop" onclick={onStop} />
  {:else if onRetry && (run?.status === 'failed' || run?.status === 'cancelled')}
    <IconButton icon={RotateCcw} label={t.retry()} testid="session-retry" onclick={onRetry} />
  {/if}

</header>
