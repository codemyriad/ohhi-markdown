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
  class="fixed inset-0 z-30 flex items-center justify-center bg-neutral/40"
>
  <div class="w-96 rounded border border-base-300 bg-base-100 p-4 text-base-content shadow-xl">
    <h2 class="text-sm font-semibold">{title}</h2>
    <p class="mt-2 text-xs text-base-content/70">{body}</p>
    {#if checkboxLabel}
      <label class="mt-2 flex items-center gap-2 text-xs text-base-content/80">
        <input type="checkbox" bind:checked data-testid="{testid}-checkbox" />
        {checkboxLabel}
      </label>
    {/if}
    <div class="mt-3 flex justify-end gap-2">
      <button
        data-testid="{testid}-cancel"
        onclick={onCancel}
        class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
      >
        Cancel
      </button>
      <button
        data-testid="{testid}-confirm"
        disabled={busy}
        onclick={confirm}
        class="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50
          {danger
            ? 'bg-error text-error-content hover:bg-error/90'
            : 'bg-primary text-primary-content hover:bg-primary/90'}"
      >
        {busy ? 'Working…' : confirmLabel}
      </button>
    </div>
  </div>
</div>
