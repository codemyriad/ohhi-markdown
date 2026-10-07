<script lang="ts">
  /**
   * The notification drawer (quiet-shell F13, spike S22 Q6; foundations-plan
   * P6): a bell readout carrying the count of errors, warnings and changes by
   * others logged since it was last opened, opening a popover that says what
   * is in it in one line ("2 warnings · 5 changes by others"), then the
   * errors and warnings (the Log view's own rows), then the changes others
   * made, ONE row per note with who made them — "Cynthia and Sam · Raft · 3
   * changes · 2 min ago" (`groupForDrawer`, `changes.ts`). Its one footer
   * link is *Open the Log* (no count: the badge counts), filtered to what
   * the drawer shows.
   * Opening it marks them seen (`layout.drawerOpen`).
   *
   * The `drawer` entry of the readout catalogue (`readouts.ts`); the dense
   * header renders it too, beside the rail toggle, with the same context.
   */
  import { Bell } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { groupForDrawer } from '../../changes.js'
  import { actorsText } from '../../event-text.js'
  import { noteName } from '../../presence.js'
  import { readoutPlacement, type ReadoutContext } from '../../readouts.js'
  import { clockTick, relativeTime } from '../../relative-time.js'
  import { getViewShell, shellClock } from '../../views.js'
  import IconButton from '../../ui/IconButton.svelte'
  import Popover from '../../ui/Popover.svelte'
  import EventRow from '../EventRow.svelte'

  interface Props {
    /**
     * The log (`workspace.ui.events`), the drawer's state (`layout`) and which
     * way its bar opens (`side`). The Log and a row's note go through the
     * `ViewShell` — App's `openPath`, so `panes.open: 'replace'`, recents and
     * the navigator drawer's close apply here as everywhere.
     */
    ctx: Pick<ReadoutContext, 'workspace' | 'layout' | 'side'>
    /** Injected for the tests; the shell's injected clock otherwise. */
    clock?: Clock
  }

  const shell = getViewShell()
  let { ctx, clock = shellClock() }: Props = $props()

  const layout = $derived(ctx.layout)

  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const tick = clockTick(clock)

  let anchor = $state<HTMLElement>()
  /**
   * Whether the drawer was open when the press on the bell began. The
   * popover's click-outside closes it on that same press, so the click that
   * follows must not read "closed" and open it again.
   */
  let openAtPress: boolean | null = null
  function toggle(): void {
    const was = openAtPress ?? layout.drawerOpen
    openAtPress = null
    layout.drawerOpen = !was
  }

  const model = $derived(groupForDrawer(ctx.workspace.ui.events, $tick))
  const t = $derived($LL.web.drawer)
  const label = $derived(layout.unread > 0 ? t.label_unread({ count: layout.unread }) : t.label())
  const summary = $derived(
    [
      model.errors ? t.summary.errors({ count: model.errors }) : '',
      model.warnings ? t.summary.warnings({ count: model.warnings }) : '',
      model.changes ? t.summary.changes({ count: model.changes }) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  )

  function openPath(path: string): void {
    layout.drawerOpen = false
    shell?.openPath(path)
  }

  function openLog(): void {
    layout.drawerOpen = false
    if (model.logArg) shell?.openView('log', model.logArg)
    else shell?.openView('log')
  }
</script>

<span
  bind:this={anchor}
  class="relative inline-flex"
  onpointerdowncapture={() => (openAtPress = layout.drawerOpen)}
>
  <IconButton
    {label}
    icon={Bell}
    pressed={layout.drawerOpen}
    testid="drawer-bell"
    aria-haspopup="dialog"
    aria-expanded={layout.drawerOpen}
    onclick={toggle}
  />
  {#if layout.unread > 0}
    <span
      data-testid="drawer-badge"
      aria-hidden="true"
      class="pointer-events-none absolute -top-0.5 -right-0.5 rounded-full bg-primary px-1 text-[9px] font-medium text-primary-content"
    >
      {layout.unread}
    </span>
  {/if}
</span>

{#if layout.drawerOpen}
  <Popover {anchor} placement={readoutPlacement(ctx)} title={t.title()} testid="drawer" onClose={() => (layout.drawerOpen = false)}>
    <div class="flex w-80 max-w-[calc(100vw-2rem)] flex-col text-xs">
      {#if model.rows === 0}
        <p data-testid="drawer-empty" class="px-3 py-3 text-base-content/70">{t.empty()}</p>
      {:else}
        <p data-testid="drawer-summary" class="border-b border-base-200 px-3 py-1.5 text-[11px] text-base-content/70">
          {summary}
        </p>
        <div class="max-h-96 overflow-y-auto">
          {#if model.problems.length > 0}
            <ol aria-label={t.problems()} class="divide-y divide-base-200 text-base-content/80">
              {#each model.problems as event (event.id)}
                <EventRow {event} now={$tick} onOpenPath={shell ? openPath : undefined} />
              {/each}
            </ol>
          {/if}
          {#if model.groups.length > 0}
            <ol
              aria-label={t.changes()}
              class="divide-y divide-base-200 {model.problems.length ? 'border-t border-base-200' : ''}"
            >
              {#each model.groups as group (group.path)}
                {@const who = actorsText(group.actors, $LL)}
                <li data-testid="drawer-change:{group.path}" class="flex items-baseline gap-1 px-3 py-2 text-base-content/80">
                  <p class="min-w-0 flex-1 leading-5 text-wrap break-words">
                    <span data-testid="drawer-change-who" class="font-medium text-base-content">{who}</span>
                    <span aria-hidden="true"> · </span>
                    {#if shell}
                      <button
                        type="button"
                        data-testid="drawer-change-note"
                        onclick={() => openPath(group.path)}
                        aria-label={t.group.open({ note: noteName(group.path) })}
                        class="rounded text-base-content underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                        >{noteName(group.path)}</button
                      >
                    {:else}
                      <span>{noteName(group.path)}</span>
                    {/if}
                    <span aria-hidden="true"> · </span>
                    <span>{t.group.count({ count: group.count })}</span>
                    <span aria-hidden="true"> · </span>
                    <time
                      class="text-base-content/70"
                      datetime={new Date(group.at).toISOString()}
                      title={new Date(group.at).toLocaleString()}>{relativeTime(group.at, $tick, $LL)}</time
                    >
                  </p>
                </li>
              {/each}
            </ol>
          {/if}
        </div>
      {/if}
      <div class="flex justify-end border-t border-base-200 px-2 py-1.5">
        <button
          type="button"
          data-testid="drawer-open-log"
          onclick={openLog}
          class="rounded px-1 py-0.5 text-[11px] text-base-content underline decoration-base-content/40 underline-offset-2 hover:decoration-base-content focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t.open_log()}
        </button>
      </div>
    </div>
  </Popover>
{/if}
