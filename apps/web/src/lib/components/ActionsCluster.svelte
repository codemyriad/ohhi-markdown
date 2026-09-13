<script lang="ts">
  /**
   * The navigator's top cluster (chrome-shaping U2): the three ways in —
   * open a note, search the vault, run a command — as full rows with their
   * bindings, where the Cursor mock puts them. Everything here is also a
   * hotkey; the rows exist so the keys are discoverable.
   */
  import { Command, FileSearch, Search } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'

  interface Props {
    bindings: { quickOpen: string; search: string; commands: string }
    onQuickOpen: () => void
    onSearch: () => void
    onCommands: () => void
  }

  let { bindings, onQuickOpen, onSearch, onCommands }: Props = $props()

  const t = $derived($LL.web.actions)
  const rows = $derived([
    { id: 'open-quick-open', icon: FileSearch, label: t.open_note(), binding: bindings.quickOpen, run: onQuickOpen },
    { id: 'open-search', icon: Search, label: t.search(), binding: bindings.search, run: onSearch },
    { id: 'open-commands', icon: Command, label: t.commands(), binding: bindings.commands, run: onCommands },
  ])
</script>

<nav aria-label={t.label()} data-testid="actions" class="flex flex-col gap-0.5 border-b border-base-300 p-2">
  {#each rows as r (r.id)}
    <button
      type="button"
      data-testid={r.id}
      onclick={r.run}
      class="flex items-center gap-2 rounded px-2 py-1 text-left text-sm text-base-content/85 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
    >
      <r.icon size={16} aria-hidden="true" class="text-base-content/70" />
      <span class="flex-1">{r.label}</span>
      <kbd class="font-ed-mono text-[10px] text-base-content/70">{r.binding}</kbd>
    </button>
  {/each}
</nav>
