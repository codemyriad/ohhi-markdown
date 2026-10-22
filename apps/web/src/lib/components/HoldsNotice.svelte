<script lang="ts">
  /**
   * Changes the vault's custodian is holding (nextcloud-build decision 7): a
   * mass change in Files (`breaker`) or a note and its file that disagree
   * (`review`). Headless means hold, never confirm — so a person who can
   * write the folder answers here: *Apply changes* / *Not now* for a batch
   * (the desktop breaker's words — *Not now* leaves the files untouched, it
   * deletes nothing), *Keep files* / *Keep note* for a review. Someone who can only read sees the
   * hold and who must answer it, without the buttons.
   *
   * Polled and answered by `nextcloud/holds.svelte.ts`; this only renders.
   * Not modal: the notice sits over the editor's top edge and the vault stays
   * usable around it.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { NcHold, NcHoldAction } from '../nextcloud/api.js'
  import { LAYER } from '../ui/Dialog.svelte'
  import { CARD, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'

  interface Props {
    holds: NcHold[]
    /** The caller may write the folder (the session grant was not read-only). */
    canResolve: boolean
    /** The hold an answer is in flight for. */
    busy?: string | null
    error?: string | null
    onResolve: (holdId: string, action: NcHoldAction) => void
  }

  let { holds, canResolve, busy = null, error = null, onResolve }: Props = $props()

  const t = $derived($LL.web.nextcloud.holds)
  const b = $derived($LL.web.breaker)
  const SHOWN = 3

  const actions = (hold: NcHold): { action: NcHoldAction; label: string }[] =>
    hold.kind === 'breaker'
      ? [
          { action: 'confirm', label: b.apply() },
          { action: 'discard', label: b.dismiss() },
        ]
      : [
          { action: 'disk', label: t.keep_files() },
          { action: 'doc', label: t.keep_note() },
        ]

  const button = `${OUTLINE_BUTTON} px-2.5 py-1 text-xs font-medium text-base-content disabled:opacity-60`
</script>

{#if holds.length > 0}
  <section
    aria-labelledby="holds-notice-heading"
    data-testid="holds-notice"
    class="{CARD} {LAYER.panel} fixed top-14 left-1/2 w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2 space-y-3 p-3 shadow-lg"
  >
    <h2 id="holds-notice-heading" class={HEADING}>{t.title()}</h2>
    <ul class="space-y-3">
      {#each holds as hold (hold.id)}
        <li data-testid="hold:{hold.id}" data-kind={hold.kind} class="space-y-1.5">
          <p class="text-sm font-medium text-base-content">{hold.kind === 'breaker' ? t.breaker() : t.review()}</p>
          <ul class="font-ed-mono text-xs text-base-content/80">
            {#each hold.paths.slice(0, SHOWN) as path (path)}
              <li class="truncate">{path}</li>
            {/each}
            {#if hold.paths.length > SHOWN}
              <li class="font-ed-ui" data-testid="hold-more:{hold.id}">{b.more({ count: hold.paths.length - SHOWN })}</li>
            {/if}
          </ul>
          {#if canResolve}
            <div class="flex gap-2">
              {#each actions(hold) as a (a.action)}
                <button
                  type="button"
                  class={button}
                  disabled={busy !== null}
                  data-testid="hold-action:{hold.id}:{a.action}"
                  onclick={() => onResolve(hold.id, a.action)}
                >
                  {a.label}
                </button>
              {/each}
            </div>
          {:else}
            <p class="text-xs text-base-content/70" data-testid="hold-read-only:{hold.id}">{t.read_only()}</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if error}
      <p role="alert" class="text-xs text-error">{t.failed({ message: error })}</p>
    {/if}
  </section>
{/if}
