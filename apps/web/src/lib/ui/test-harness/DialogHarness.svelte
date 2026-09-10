<script lang="ts">
  import Dialog from '../Dialog.svelte'

  let {
    closeOnOutsideClick = true,
    closeOnEscape = true,
  }: { closeOnOutsideClick?: boolean; closeOnEscape?: boolean } = $props()

  let open = $state(false)
  let closes = $state(0)
</script>

<button data-testid="opener" onclick={() => (open = true)}>Open</button>
{#if open}
  <Dialog
    title="Rename note"
    description="Pick a new name."
    {closeOnOutsideClick}
    {closeOnEscape}
    testid="dlg"
    onClose={() => {
      open = false
      closes++
    }}
  >
    <input aria-label="Name" />
    <button>Cancel</button>
    <button>Rename</button>
  </Dialog>
{/if}
<span data-testid="closes">{closes}</span>
