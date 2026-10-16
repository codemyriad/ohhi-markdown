<script lang="ts" module>
  /** A boot faster than this never shows the splash at all: no flash on a fast open. */
  export const SPLASH_DELAY_MS = 300
  /** Only an open this slow offers the way back to the vault list. */
  export const SPLASH_ESCAPE_MS = 5_000
</script>

<script lang="ts">
  /**
   * While a vault opens (QA round 1, 2026-10-15; was the bare "connecting…
   * [Cancel]" page). What it waits for is the vault's OWN stores and files
   * — `setupWorkspace` reopens each mount's CRDT state from disk, reconciles
   * it against the files and builds the tree before the shell has a
   * workspace to draw — never the relay: a reopen connects in the
   * background, and how that goes is the `sync` readout's to say (golden
   * rule 4). So the page says "opening", not "connecting".
   *
   * Quiet and branded: nothing for the first {SPLASH_DELAY_MS} ms, so a fast
   * open goes straight to the shell; then the wordmark (`ui/Wordmark`, the
   * landing site's) and one line. Only an open that is still going after
   * {SPLASH_ESCAPE_MS} ms offers a way out — back to the vault list (`session.cancel()`), the one thing a person
   * can usefully do about a stalled open. The memory URL contract (dev, the
   * e2e) has no vault list to go back to, so `onCancel` is absent there.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import Wordmark from '../ui/Wordmark.svelte'

  interface Props {
    clock: Clock
    onCancel?: () => void
  }

  let { clock, onCancel }: Props = $props()

  let shown = $state(false)
  let slow = $state(false)

  $effect(() => {
    const cancels = [clock.schedule(() => (shown = true), SPLASH_DELAY_MS), clock.schedule(() => (slow = true), SPLASH_ESCAPE_MS)]
    return () => cancels.forEach((cancel) => cancel())
  })

  const t = $derived($LL.web.shell.boot)
</script>

<main
  data-testid="connecting"
  aria-busy="true"
  aria-label={t.label()}
  class="flex h-full flex-col items-center justify-center gap-2 bg-base-100 px-4 font-ed-ui text-base-content"
>
  {#if shown}
    <Wordmark as="p" size="lg" testid="boot-wordmark" />
    <p role="status" class="m-0 text-sm text-base-content/70">{t.opening()}</p>
    {#if slow && onCancel}
      <button
        type="button"
        data-testid="boot-cancel"
        onclick={onCancel}
        class="mt-4 rounded border border-base-300 px-3 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
      >
        {t.back_to_vaults()}
      </button>
    {/if}
  {/if}
</main>
