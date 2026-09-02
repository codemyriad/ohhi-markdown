<script lang="ts">
  interface Props {
    title: string
    /** One or two short sentences of honest consequences. */
    body: string
    confirmLabel: string
    /** Optional labeled checkbox; its state is passed to onConfirm. */
    checkboxLabel?: string
    danger?: boolean
    testid: string
    onConfirm: (checked: boolean) => void
    onCancel: () => void
  }

  let { title, body, confirmLabel, checkboxLabel, danger, testid, onConfirm, onCancel }: Props =
    $props()

  let checked = $state(false)
  let busy = $state(false)

  function confirm(): void {
    busy = true
    onConfirm(checked)
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label={title}
  data-testid={testid}
  class="fixed inset-0 z-30 flex items-center justify-center bg-black/30"
>
  <div class="w-96 rounded border border-gray-200 bg-white p-4 text-gray-800 shadow-xl">
    <h2 class="text-sm font-semibold">{title}</h2>
    <p class="mt-2 text-xs text-gray-600">{body}</p>
    {#if checkboxLabel}
      <label class="mt-2 flex items-center gap-2 text-xs text-gray-700">
        <input type="checkbox" bind:checked data-testid="{testid}-checkbox" />
        {checkboxLabel}
      </label>
    {/if}
    <div class="mt-3 flex justify-end gap-2">
      <button
        data-testid="{testid}-cancel"
        onclick={onCancel}
        class="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
      >
        Cancel
      </button>
      <button
        data-testid="{testid}-confirm"
        disabled={busy}
        onclick={confirm}
        class="rounded px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50
          {danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}"
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </div>
  </div>
</div>
