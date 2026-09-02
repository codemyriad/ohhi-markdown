<script lang="ts">
  interface Props {
    paths: string[]
    onConfirm: () => void
    onDismiss: () => void
  }

  let { paths, onConfirm, onDismiss }: Props = $props()

  const SHOWN = 10
  const shown = $derived(paths.slice(0, SHOWN))
</script>

<!-- Mass-change breaker (golden rule / D2): a git-branch-switch-shaped batch
     is HELD until confirmed — nothing is ingested or enrolled meanwhile. -->
<div class="fixed inset-0 z-30 flex items-start justify-center bg-black/30 pt-24">
  <div
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="breaker-title"
    data-testid="breaker-dialog"
    class="w-full max-w-md rounded-lg border border-amber-300 bg-white p-4 shadow-xl"
  >
    <h2 id="breaker-title" class="text-sm font-semibold text-gray-900">
      {paths.length} files changed at once
    </h2>
    <p class="mt-1 text-xs text-gray-600">
      This looks like a bulk change (a git branch switch, a folder drop). Nothing has been
      synced yet — apply it, or dismiss to leave those files untouched for now.
    </p>
    <ul class="mt-2 max-h-40 overflow-y-auto rounded bg-gray-50 p-2 font-mono text-[11px] text-gray-700">
      {#each shown as p (p)}
        <li class="truncate">{p}</li>
      {/each}
      {#if paths.length > SHOWN}
        <li class="text-gray-400">… and {paths.length - SHOWN} more</li>
      {/if}
    </ul>
    <div class="mt-4 flex justify-end gap-2">
      <button
        data-testid="breaker-dismiss"
        onclick={onDismiss}
        class="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
      >
        Not now
      </button>
      <button
        data-testid="breaker-confirm"
        onclick={onConfirm}
        class="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        Apply changes
      </button>
    </div>
  </div>
</div>
