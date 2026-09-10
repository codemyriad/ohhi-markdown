<script lang="ts">
  import { melt } from '@melt-ui/svelte'
  import DropdownMenu from '../DropdownMenu.svelte'
  import MenuItem from '../MenuItem.svelte'
  import MenuSeparator from '../MenuSeparator.svelte'

  let picked = $state('')
</script>

<DropdownMenu testid="menu">
  {#snippet trigger(t)}
    <button use:melt={t} data-testid="trigger">Vault</button>
  {/snippet}
  {#snippet children({ item, separator })}
    <MenuItem {item} onSelect={() => (picked = 'alpha')}>Alpha</MenuItem>
    <MenuItem {item} onSelect={() => (picked = 'beta')}>Beta</MenuItem>
    <MenuSeparator {separator} />
    <MenuItem {item} disabled reason="Not on this vault" onSelect={() => (picked = 'blocked')}>
      Blocked
    </MenuItem>
  {/snippet}
</DropdownMenu>
<span data-testid="picked">{picked}</span>
