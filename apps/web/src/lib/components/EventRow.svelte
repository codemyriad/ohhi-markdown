<script lang="ts">
  /**
   * One logged event, as the Log view and the drawer both list it (quiet-shell
   * F12/F13): level glyph, the words for its code (`describeEvent`), where it
   * happened (a path opens the note), how long ago, ×N when an immediate
   * repeat was folded into it, and — for an error or warning the app can help
   * with — what to do next. The glyph takes the semantic level colour; the
   * text stays on base-content so it holds the contrast floor on every theme.
   */
  import { CircleAlert, Info, TriangleAlert, X } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { AppEvent } from '@ohhi/workspace'
  import { describeEvent } from '../event-text.js'
  import { eventHint, eventWhere } from '../log-view.js'
  import { relativeTime } from '../relative-time.js'
  import IconButton from '../ui/IconButton.svelte'

  interface Props {
    event: AppEvent
    /** The clock's now, re-read on a tick by the host. */
    now: number
    onOpenPath?: (path: string) => void
    /** The drawer's per-row dismiss (the row leaves the drawer, never the log); absent in the Log view. */
    onDismiss?: () => void
  }

  let { event, now, onOpenPath, onDismiss }: Props = $props()

  const ICON = { error: CircleAlert, warn: TriangleAlert, info: Info } as const
  const TONE = { error: 'text-error', warn: 'text-warning', info: 'text-info' } as const

  const t = $derived($LL.web.log)
  const Icon = $derived(ICON[event.level])
  const where = $derived(eventWhere(event, $LL))
  const hint = $derived(eventHint(event, $LL))
</script>

<li data-testid="event:{event.id}" data-level={event.level} class="flex items-start gap-2 px-3 py-2">
  <Icon size={14} aria-hidden="true" class="mt-0.5 shrink-0 {TONE[event.level]}" />
  <span class="sr-only">{t.level_name[event.level]()}:</span>
  <div class="min-w-0 flex-1">
    <p class="text-wrap break-words leading-5">
      {describeEvent(event, $LL)}
      {#if event.count > 1}
        <span
          data-testid="event-count"
          class="ml-1 rounded bg-base-200 px-1 text-[11px] text-base-content/80"
          aria-label={t.repeated_label({ count: event.count })}>{t.repeated({ count: event.count })}</span
        >
      {/if}
    </p>
    {#if hint}
      <p data-testid="event-hint" class="mt-0.5 text-[11px] leading-4 text-base-content/80">{hint}</p>
    {/if}
    <p class="mt-1 flex items-center gap-2 text-[11px] text-base-content/70">
      <time datetime={new Date(event.at).toISOString()} title={new Date(event.at).toLocaleString()}
        >{relativeTime(event.at, now, $LL)}</time
      >
      {#if event.scope.path && onOpenPath}
        {@const path = event.scope.path}
        <button
          type="button"
          data-testid="event-path"
          onclick={() => onOpenPath(path)}
          class="truncate rounded px-1 font-ed-mono hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
          aria-label={t.open_path({ path })}
        >
          {path}
        </button>
      {:else if where}
        <span data-testid="event-where" class="truncate font-ed-mono">{where}</span>
      {/if}
    </p>
  </div>
  {#if onDismiss}
    <IconButton label={$LL.web.drawer.dismiss()} icon={X} testid="event-dismiss" data-dismiss class="-my-1 -mr-1 shrink-0" onclick={onDismiss} />
  {/if}
</li>
