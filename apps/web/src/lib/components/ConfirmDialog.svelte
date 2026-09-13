<script lang="ts">
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import Dialog from '../ui/Dialog.svelte'

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
    /**
     * The action FAILED and this dialog is still up (Minor 18). Shown as an
     * alert beside the buttons, and it re-arms the confirm — an action that
     * did not happen must neither look like it did nor be unretryable.
     */
    error?: string | null
  }

  let {
    title,
    body,
    confirmLabel,
    checkboxLabel,
    danger,
    testid,
    onConfirm,
    onCancel,
    error = null,
  }: Props = $props()

  let checked = $state(false)
  let busy = $state(false)

  // An error ends this attempt: the button says its label again, not "Working…".
  $effect(() => {
    if (error) busy = false
  })

  function confirm(): void {
    busy = true
    onConfirm(checked)
  }
</script>

<!-- A confirm lists its consequences, so a stray click on the scrim must not
     read as an answer: Escape cancels, the scrim does nothing. -->
<Dialog
  role="alertdialog"
  {title}
  description={body}
  closeOnOutsideClick={false}
  width="sm"
  {testid}
  onClose={onCancel}
>
  {#if checkboxLabel}
    <label class="flex items-center gap-2 text-xs text-base-content/80">
      <input type="checkbox" bind:checked data-testid="{testid}-checkbox" />
      {checkboxLabel}
    </label>
  {/if}
  {#if error}
    <p class="mt-2 text-xs text-error" role="alert" data-testid="{testid}-error">{error}</p>
  {/if}
  <div class="mt-3 flex justify-end gap-2">
    <button
      type="button"
      data-testid="{testid}-cancel"
      onclick={onCancel}
      class="rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
    >
      {$LL.common.cancel()}
    </button>
    <button
      type="button"
      data-testid="{testid}-confirm"
      disabled={busy}
      onclick={confirm}
      class="rounded px-3 py-1.5 text-xs font-medium disabled:opacity-50
        {danger
        ? 'bg-error text-error-content hover:bg-error/90'
        : 'bg-primary text-primary-content hover:bg-primary/90'}"
    >
      {busy ? $LL.common.working() : confirmLabel}
    </button>
  </div>
</Dialog>
