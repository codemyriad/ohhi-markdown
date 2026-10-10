<script lang="ts" module>
  import { Columns2, Maximize2, Rows2, SquareSplitHorizontal, X, type LucideIcon } from '@lucide/svelte'

  /**
   * The icon each command a tab strip's end may show (`bars.tabs`). A command
   * id with none here is not a strip button: said once, then skipped.
   */
  export const STRIP_ICONS: Readonly<Record<string, LucideIcon>> = {
    'workspace.split-right': Columns2,
    'workspace.split-down': Rows2,
    'workspace.split-auto': SquareSplitHorizontal,
    'workspace.zoom': Maximize2,
    'workspace.close-pane': X,
  }

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
  import { LL } from '@ohhi/i18n/i18n-svelte'
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

  const t = $derived($LL.web.toolbar)

  const items = $derived.by(() => {
    void $LL
    const out: { id: string; label: string; icon: LucideIcon }[] = []
    for (const id of ids) {
      if (id === '|') continue
      const command = registry.get(id)
      const icon = STRIP_ICONS[id]
      if (!command || !icon) {
        warnOnce(id)
        continue
      }
      const binding = registry.binding(id)
      out.push({ id, icon, label: binding ? t.with_binding({ title: command.title, binding }) : command.title })
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
    icon={item.icon}
    testid="tab-cmd:{paneId}:{item.id}"
    class="opacity-45 hover:opacity-100 focus-visible:opacity-100"
    onclick={() => run(item.id)}
  />
{/each}
