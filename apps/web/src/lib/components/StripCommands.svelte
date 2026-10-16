<script lang="ts" module>
  // A command id with no icon (`COMMAND_ICONS`) is not a strip button: said once, then skipped.
  const warned = new Set<string>()
  function warnOnce(id: string): void {
    if (warned.has(id)) return
    warned.add(id)
    console.warn(`[tab strip] "${id}" in bars.tabs is not a command the strip can show — skipped`)
  }
</script>

<script lang="ts">
  /**
   * The tab strip's command buttons (E6): `bars.tabs` — command ids, drawn
   * as faint icon buttons at the strip's end (by default split right and
   * split down), each named and bound from the registry, so a button, a
   * palette row and a key are one command (golden rule 7). Faint until
   * pointed at or focused: they are there to be found, not to be read.
   *
   * A strip belongs to a pane; a pane command acts on the FOCUSED pane, so a
   * press focuses this strip's pane first (a pointer already does, through
   * the pane's capture handler; the keyboard does not).
   */
  import type { LucideIcon } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { COMMAND_ICONS } from '../command-icons.js'
  import { commandHint } from '../command-hint.js'
  import type { CommandRegistry } from '../commands.js'
  import IconButton from '../ui/IconButton.svelte'

  interface Props {
    ids: readonly string[]
    registry: CommandRegistry
    /** Focus the strip's pane before the command runs. */
    focusPane: () => void
    paneId: string
  }

  let { ids, registry, focusPane, paneId }: Props = $props()


  const items = $derived.by(() => {
    void $LL
    const out: { id: string; label: string; hint: string; icon: LucideIcon }[] = []
    for (const id of ids) {
      if (id === '|') continue
      const command = registry.get(id)
      const icon = COMMAND_ICONS[id]
      if (!command || !icon) {
        warnOnce(id)
        continue
      }
      const binding = registry.binding(id)
      out.push({ id, icon, label: command.title, hint: commandHint(command.title, binding) })
    }
    return out
  })

  function run(id: string): void {
    focusPane()
    const command = registry.get(id)
    if (command && (!command.when || command.when())) void command.run()
  }
</script>

{#each items as item (item.id)}
  <IconButton
    label={item.label}
    hint={item.hint}
    icon={item.icon}
    testid="tab-cmd:{paneId}:{item.id}"
    class="opacity-45 hover:opacity-100 focus-visible:opacity-100"
    onclick={() => run(item.id)}
  />
{/each}
