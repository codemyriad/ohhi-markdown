<script lang="ts">
  import { ChevronDown } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import type { VaultEntry } from '../config.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'

  interface Props {
    current: { room: string; name: string }
    vaults: VaultEntry[]
    onSwitch: (entry: VaultEntry) => void
    onManage: () => void
  }

  let { current, vaults, onSwitch, onManage }: Props = $props()

  const others = $derived(vaults.filter((v) => v.room !== current.room))
</script>

<DropdownMenu testid="vault-menu">
  {#snippet trigger(t)}
    <button
      use:melt={t}
      data-testid="vault-switcher"
      class="flex items-center gap-1 rounded px-2 py-1 text-sm font-semibold hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span class="max-w-48 truncate">{current.name}</span>
      <ChevronDown size={14} aria-hidden="true" class="text-base-content/70" />
    </button>
  {/snippet}
  {#snippet children({ item, separator })}
    {#each others as entry (entry.room)}
      <MenuItem {item} testid="switch-vault:{entry.room}" onSelect={() => onSwitch(entry)}>
        <span class="block truncate">{entry.name}</span>
      </MenuItem>
    {/each}
    {#if others.length > 0}
      <MenuSeparator {separator} />
    {/if}
    <MenuItem {item} testid="manage-vaults" onSelect={onManage}>Manage vaults…</MenuItem>
  {/snippet}
</DropdownMenu>
