<script lang="ts">
  import Listbox, { optionId } from '../Listbox.svelte'

  interface Props {
    items?: string[]
  }
  let { items = ['alpha', 'beta', 'gamma'] }: Props = $props()
  let active = $state(0)
  let picked = $state('')

  function onkeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') active = (active + 1) % items.length
    else if (e.key === 'ArrowUp') active = (active - 1 + items.length) % items.length
    else if (e.key === 'Enter') picked = items[active]
    else return
    e.preventDefault()
  }
</script>

<input
  aria-label="Field"
  role="combobox"
  aria-expanded="true"
  aria-controls="lb"
  aria-activedescendant={items.length ? optionId('lb', active) : undefined}
  {onkeydown}
/>
<Listbox
  id="lb"
  options={items}
  {active}
  label="Suggestions"
  key={(x) => x}
  empty="No matches"
  optionAttrs={(x) => ({ 'data-testid': `opt:${x}` })}
  onPick={(x) => (picked = x)}
>
  {#snippet option(x)}<span>{x}</span>{/snippet}
</Listbox>
<span data-testid="picked">{picked}</span>
