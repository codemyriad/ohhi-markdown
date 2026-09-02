<script lang="ts">
  import type { VaultEntry } from '../config.js'

  interface Props {
    current: { room: string; name: string }
    vaults: VaultEntry[]
    onSwitch: (entry: VaultEntry) => void
    onManage: () => void
  }

  let { current, vaults, onSwitch, onManage }: Props = $props()

  let open = $state(false)
  const others = $derived(vaults.filter((v) => v.room !== current.room))
</script>

<svelte:window onclick={() => (open = false)} />

<div class="relative">
  <button
    data-testid="vault-switcher"
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={(e) => {
      e.stopPropagation()
      open = !open
    }}
    class="flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold hover:bg-base-200"
  >
    <span class="max-w-48 truncate">{current.name}</span>
    <span aria-hidden="true" class="text-xs text-base-content/40">▾</span>
  </button>

  {#if open}
    <div
      role="menu"
      class="absolute top-8 left-0 z-10 w-64 rounded border border-base-300 bg-base-100 py-1 shadow-lg"
    >
      {#each others as entry (entry.room)}
        <button
          role="menuitem"
          data-testid="switch-vault:{entry.room}"
          onclick={() => onSwitch(entry)}
          class="block w-full truncate px-3 py-1.5 text-left text-sm text-base-content/80 hover:bg-base-200"
        >
          {entry.name}
        </button>
      {/each}
      {#if others.length > 0}
        <div class="my-1 border-t border-base-200"></div>
      {/if}
      <button
        role="menuitem"
        data-testid="manage-vaults"
        onclick={onManage}
        class="block w-full px-3 py-1.5 text-left text-sm text-base-content/80 hover:bg-base-200"
      >
        Manage vaults…
      </button>
    </div>
  {/if}
</div>
