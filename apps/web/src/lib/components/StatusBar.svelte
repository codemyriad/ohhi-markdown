<script lang="ts">
  /**
   * The editor's status bar (chrome-shaping U2, tab-groups B3): note-level
   * readouts sit with the note, not in the header. One per PANE (R4.2): two
   * panes on one note read the same record, so they show the same pill and
   * no lie is possible.
   *
   * It draws the layout's `bars.statusbar` through the SAME readout renderer
   * the toolbar uses (`BarItems`, duplication review #11), so `words`,
   * `mode`, `note.pill` — or any catalogue id a layout names — are one
   * component whichever bar shows them. Its readouts follow THIS pane
   * (`ctx.pane`), open their menus upward (`side: 'top'`), and carry the
   * status bar's testids: the bare ones (`word-count`, `mode-menu`,
   * `sync-pill-note`, `pane-zoomed`, `status-bar-with`) in the focused pane,
   * `<id>:<pane>` (`sync-pill-pane:<pane>`) in the others. On the left, the
   * pane's lead and who is here (`pane.lead`, the lead itself only when the
   * layout's `panes.lead` asks), and the zoom badge — not configurable away
   * while it is true.
   *
   * The readout context comes from the shell (`setReadoutContext`, App);
   * mounted without one, the bar renders nothing.
   */
  import { getReadoutContext, inBar, statusBarTestid } from '../readouts.js'
  import BarItems from './BarItems.svelte'
  import PaneLead from './readouts/PaneLead.svelte'
  import Zoomed from './readouts/Zoomed.svelte'

  interface Props {
    paneId: string
    /** The focused pane's bar keeps the testids the chrome and collab specs drive. */
    focused: boolean
    /** Left-hand readout: which pane this is, and what it holds. */
    lead: boolean
  }

  let { paneId, focused, lead }: Props = $props()

  const shell = getReadoutContext()
  const ctx = $derived(shell ? inBar(shell, { side: 'top', pane: { id: paneId, focused, lead } }) : null)
</script>

{#if ctx}
  <footer
    data-testid={statusBarTestid({ id: paneId, focused })}
    class="flex h-7 shrink-0 items-center gap-4 border-t border-base-300 bg-base-100 px-3 text-xs text-base-content/70"
  >
    <Zoomed {ctx} />
    <!-- A layout that names `pane.lead` (dense) places it itself. -->
    {#if !ctx.layout.spec.bars.statusbar.includes('pane.lead')}<PaneLead {ctx} />{/if}
    <span class="ml-auto flex min-w-0 items-center gap-4">
      <BarItems ids={ctx.layout.spec.bars.statusbar} {ctx} />
    </span>
  </footer>
{/if}
