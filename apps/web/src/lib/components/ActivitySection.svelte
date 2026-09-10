<script lang="ts">
  /**
   * The rail's Activity section (chrome-shaping Fork 4, shape C): the session
   * notice log, newest first, each with its time and the note it concerns —
   * the place an error can be read after its toast has gone. The developer
   * tools toggle lives at its foot, next to the diagnostics it enables.
   */
  import { CircleAlert, Info, TriangleAlert } from '@lucide/svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { formatTime, type Notice } from '../notices.js'

  interface Props {
    notices: Notice[]
    devtools: boolean
    onOpenPath: (path: string) => void
    onClear: () => void
    onDevtools: (on: boolean) => void
  }

  let { notices, devtools, onOpenPath, onClear, onDevtools }: Props = $props()

  const t = $derived($LL.web.activity)
  const ICON = { error: CircleAlert, warn: TriangleAlert, info: Info } as const
  const TONE = { error: 'text-error', warn: 'text-base-content/80', info: 'text-base-content/70' } as const
</script>

<div data-testid="activity-section" class="flex flex-col text-xs text-base-content/80">
  {#if notices.length === 0}
    <p class="px-3 py-2 text-base-content/70">{t.empty()}</p>
  {:else}
    <ol class="divide-y divide-base-200">
      {#each notices as n (n.id)}
        {@const Icon = ICON[n.level]}
        <li data-testid="notice:{n.id}" data-level={n.level} class="flex items-start gap-2 px-3 py-2">
          <Icon size={14} aria-hidden="true" class="mt-0.5 shrink-0 {TONE[n.level]}" />
          <div class="min-w-0 flex-1">
            <p class="text-wrap break-words">{n.text}</p>
            <p class="mt-0.5 flex items-center gap-2 text-[10px] text-base-content/70">
              <time datetime={new Date(n.at).toISOString()}>{formatTime(n.at)}</time>
              {#if n.path}
                <button
                  type="button"
                  onclick={() => onOpenPath(n.path!)}
                  class="truncate rounded px-1 font-ed-mono hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
                  title={t.open_path({ path: n.path })}
                >
                  {n.path}
                </button>
              {/if}
            </p>
          </div>
        </li>
      {/each}
    </ol>
    <div class="flex justify-end px-3 py-1">
      <button
        type="button"
        data-testid="activity-clear"
        onclick={onClear}
        class="rounded px-2 py-0.5 text-[10px] text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      >
        {t.clear()}
      </button>
    </div>
  {/if}
  <label class="flex items-center gap-2 border-t border-base-200 px-3 py-2 text-base-content/80">
    <input
      type="checkbox"
      data-testid="activity-devtools"
      checked={devtools}
      onchange={(e) => onDevtools(e.currentTarget.checked)}
    />
    {t.devtools()}
    <span class="text-[10px] text-base-content/70">{t.devtools_hint()}</span>
  </label>
</div>
