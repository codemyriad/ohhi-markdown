<script lang="ts">
  import Popover from '../Popover.svelte'

  let {
    anchored = true,
    /** Omit it (`null`) to exercise the primitive's OWN default focus rule. */
    openFocus = "[data-testid='name']",
  }: { anchored?: boolean; openFocus?: string | null } = $props()

  let open = $state(false)
  let closes = $state(0)
  let chip = $state<HTMLElement>()
</script>

<button bind:this={chip} data-testid="opener" onclick={() => (open = true)}>Edible</button>
{#if open}
  <Popover
    anchor={anchored ? (chip ?? null) : null}
    title="Manage group"
    testid="pop"
    openFocus={openFocus ?? undefined}
    onClose={() => {
      open = false
      closes++
    }}
  >
    <div class="p-2">
      <input data-testid="name" aria-label="Group name" />
      <button>Fold</button>
    </div>
  </Popover>
{/if}
<span data-testid="closes">{closes}</span>
