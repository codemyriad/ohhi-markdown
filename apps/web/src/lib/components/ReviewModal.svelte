<script lang="ts">
  import {
    computeMergeHunks,
    tryCleanMerge,
    type DivergenceReview,
  } from '@editor/vault'

  interface Props {
    review: DivergenceReview
    onResolve: (guid: string, mergedText: string) => void
    /** 'vanished' reviews resolve two-way instead of by merged text (M5). */
    onVanished: (guid: string, action: 'restore' | 'remove') => void
  }

  // Parent remounts this component per review ({#key review.guid}), so pick
  // state never leaks across reviews.
  let { review, onResolve, onVanished }: Props = $props()

  const vanished = $derived(review.reason === 'vanished')

  const hunks = $derived(computeMergeHunks(review))
  /** Non-null when diff3 found no real conflicts — "accept merge" is then free. */
  const clean = $derived(tryCleanMerge(review))

  let picks = $state<Record<number, 'mine' | 'theirs'>>({})

  const allPicked = $derived(hunks.every((h, i) => h.kind === 'ok' || picks[i] !== undefined))
  const canAccept = $derived(clean !== null || allPicked)

  const assembled = $derived(
    hunks
      .flatMap((h, i) => (h.kind === 'ok' ? h.lines : picks[i] === 'theirs' ? h.theirs : h.mine))
      .join('\n')
  )

  function accept(): void {
    onResolve(review.guid, clean ?? assembled)
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
  <div
    data-testid="review-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Divergence review: {review.path}"
    class="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl"
  >
    <header class="border-b border-gray-200 px-4 py-3">
      <h2 class="text-sm font-semibold text-gray-900">Divergence review — {review.path}</h2>
      <p class="mt-0.5 text-xs text-gray-500">
        reason: {review.reason}. Nothing is written to disk until you resolve.
      </p>
    </header>

    {#if vanished}
      <div class="flex-1 overflow-y-auto px-4 py-3">
        <p class="text-xs text-gray-600">
          This file was deleted on disk outside Editor, but its synced content still exists.
          Restore it, or confirm the deletion — confirming removes it for everyone sharing this
          folder (a recovery copy is journaled).
        </p>
        <pre
          data-testid="vanished-content"
          class="mt-2 max-h-64 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2 font-mono text-xs whitespace-pre-wrap text-gray-700">{review.mine}</pre>
      </div>
      <footer class="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
        <button
          data-testid="vanished-remove"
          onclick={() => onVanished(review.guid, 'remove')}
          class="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          Confirm removal
        </button>
        <button
          data-testid="vanished-restore"
          onclick={() => onVanished(review.guid, 'restore')}
          class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          Restore file
        </button>
      </footer>
    {:else}
    <div class="flex-1 overflow-y-auto px-4 py-3 font-mono text-xs">
      {#each hunks as hunk, i (i)}
        {#if hunk.kind === 'ok'}
          <pre class="whitespace-pre-wrap text-gray-600">{hunk.lines.join('\n')}</pre>
        {:else}
          <div data-testid="conflict-hunk:{i}" class="my-2 overflow-hidden rounded border border-red-200">
            <div class="border-b border-red-100 bg-red-50/60 p-2">
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[10px] font-semibold tracking-wide text-red-700 uppercase">mine (editor)</span>
                <button
                  data-testid="pick-mine:{i}"
                  onclick={() => (picks = { ...picks, [i]: 'mine' })}
                  aria-pressed={picks[i] === 'mine'}
                  class="rounded border px-2 py-0.5 text-[10px] font-sans
                    {picks[i] === 'mine'
                      ? 'border-red-600 bg-red-600 text-white'
                      : 'border-red-300 bg-white text-red-700 hover:bg-red-100'}"
                >
                  pick mine
                </button>
              </div>
              <pre class="whitespace-pre-wrap">{hunk.mine.join('\n')}</pre>
            </div>
            <div class="bg-amber-50/60 p-2">
              <div class="mb-1 flex items-center justify-between">
                <span class="text-[10px] font-semibold tracking-wide text-amber-700 uppercase">theirs (disk)</span>
                <button
                  data-testid="pick-theirs:{i}"
                  onclick={() => (picks = { ...picks, [i]: 'theirs' })}
                  aria-pressed={picks[i] === 'theirs'}
                  class="rounded border px-2 py-0.5 text-[10px] font-sans
                    {picks[i] === 'theirs'
                      ? 'border-amber-600 bg-amber-600 text-white'
                      : 'border-amber-300 bg-white text-amber-700 hover:bg-amber-100'}"
                >
                  pick theirs
                </button>
              </div>
              <pre class="whitespace-pre-wrap">{hunk.theirs.join('\n')}</pre>
            </div>
          </div>
        {/if}
      {/each}
    </div>

    <footer class="flex items-center justify-end gap-2 border-t border-gray-200 px-4 py-3">
      <button
        data-testid="keep-mine"
        onclick={() => onResolve(review.guid, review.mine)}
        class="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        keep mine
      </button>
      <button
        data-testid="keep-theirs"
        onclick={() => onResolve(review.guid, review.theirs)}
        class="rounded border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      >
        keep theirs
      </button>
      <button
        data-testid="accept-merge"
        disabled={!canAccept}
        onclick={accept}
        class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700
          disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        accept merge
      </button>
    </footer>
    {/if}
  </div>
</div>
