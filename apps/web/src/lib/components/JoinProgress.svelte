<script lang="ts">
  /**
   * What a device being linked shows while the whole vault arrives
   * (device-link N2; spike S10-Q4 §"What the joiner shows meanwhile").
   *
   * Before this, the join path set `busy = false` and then awaited the boot,
   * so the window sat inert for the whole minute with no editor and no
   * explanation. Two phases, both determinate, both fed from counts the
   * session already has: `pull` (doc providers synced, denominator from the
   * folder map) and `write` (files materialized onto disk — 92% of the wait).
   *
   * No editor surface until the boot promise resolves: until then the tree is
   * empty and the destination folder is half-written, and showing either
   * would be showing a vault that does not exist yet.
   *
   * Decision 6 is stated plainly rather than discovered: images and PDFs do
   * not travel until attachment sync (D2f) lands.
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import type { PullProgress } from '../workspace.svelte.js'

  interface Props {
    vaultName: string
    /** Where the vault is being written — a folder path, or the browser. */
    destination: string
    /** Null before the first signal: the relay has not answered yet. */
    progress: PullProgress | null
    /** A stall, a timeout, or any boot failure — rendered with a retry. */
    error: string | null
    onRetry: () => void
    onCancel: () => void
  }

  let { vaultName, destination, progress, error, onRetry, onCancel }: Props = $props()

  const t = $derived($LL.web.device_link)
  const phaseLine = $derived.by(() => {
    if (!progress) return t.starting()
    return progress.phase === 'pull'
      ? t.phase_pull({ total: progress.total })
      : t.phase_write({ dest: destination })
  })
  /** 0 until the denominator is known — never a bar that jumps to full. */
  const percent = $derived(
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  )
</script>

<main
  data-testid="join-progress"
  class="flex h-screen flex-col items-center justify-center gap-4 bg-base-100 px-6 text-base-content"
>
  <div class="w-full max-w-md space-y-3">
    <h1 class="text-lg font-semibold">{t.panel_title()}</h1>

    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.panel_vault()}</dt>
      <dd class="truncate">{vaultName}</dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.panel_destination()}</dt>
      <dd class="truncate font-ed-mono" data-testid="join-destination">{destination}</dd>
    </dl>

    {#if error}
      <p role="alert" data-testid="join-error" class="rounded bg-error/10 px-3 py-2 text-sm text-error">
        {t.failed()}
        {error}
      </p>
    {:else}
      <div class="space-y-1">
        <p class="text-sm" data-testid="join-phase">{phaseLine}</p>
        <div
          role="progressbar"
          data-testid="join-bar"
          data-phase={progress?.phase ?? 'starting'}
          aria-label={t.progress_label()}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          class="h-1.5 w-full overflow-hidden rounded bg-base-300"
        >
          <div class="h-full bg-primary" style="width: {percent}%"></div>
        </div>
        {#if progress && progress.total > 0}
          <p class="text-xs text-base-content/70" data-testid="join-counts">
            {t.counts({ done: progress.done, total: progress.total })}
          </p>
        {/if}
      </div>
    {/if}

    <p class="text-xs text-base-content/70" data-testid="join-attachments">{t.attachments()}</p>

    <div class="flex gap-2">
      {#if error}
        <button
          type="button"
          data-testid="join-retry"
          onclick={onRetry}
          class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90"
        >
          {t.retry()}
        </button>
      {/if}
      <button
        type="button"
        data-testid="join-cancel"
        onclick={onCancel}
        class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
      >
        {$LL.common.cancel()}
      </button>
    </div>
  </div>
</main>
