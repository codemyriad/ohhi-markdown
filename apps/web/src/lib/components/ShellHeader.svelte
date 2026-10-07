<script lang="ts">
  /**
   * The shell's bars above and below the panes (quiet-shell F5/F7/F13; round
   * 2, P2): the host for whichever header the layout draws — light's one
   * toolbar, or the dense breadcrumb bar with its two column toggles and the
   * drawer — and for the toolbar docked at the bottom. `placement="top"`
   * renders the banner landmark, always there whichever bar the layout
   * draws (or none, in Focus mode): it holds the page's one h1 — the vault —
   * the way out of Focus mode and the header. `placement="bottom"` renders
   * the footer landmark: the docked toolbar, or nothing — the mode bar (the
   * foot of the editor area) stays directly above it. The format bar is not
   * docked here any more: it floats over the editor (round 3, Q2 —
   * `EditorArea.svelte`'s floating layer).
   */
  import { PanelLeft, PanelRight } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandRegistry } from '../commands.js'
  import type { ReadoutContext } from '../readouts.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import IconButton from '../ui/IconButton.svelte'
  import Breadcrumb from './Breadcrumb.svelte'
  import Drawer from './readouts/Drawer.svelte'
  import Inspector from './readouts/Inspector.svelte'
  import Toolbar from './Toolbar.svelte'

  interface Props {
    placement: 'top' | 'bottom'
    workspace: Workspace
    layout: ShellLayout
    /** Unused since the format bar floats (round 3, Q2); kept so the hosts' props did not move. */
    registry?: CommandRegistry
    /** The readouts' context — the toolbar's and the drawer's. */
    ctx: ReadoutContext
    /** The vault's name: the page's one h1. */
    vaultName: string
  }

  let { placement, workspace, layout, ctx, vaultName }: Props = $props()

  /** The focused pane's active path — what the breadcrumb follows. */
  const selectedPath = $derived(workspace.ui.selectedPath ?? null)
  const toolbarHere = $derived(layout.toolbarShown && layout.spec.toolbar.position === placement)
</script>

{#snippet toolbar()}
  <!-- quiet-shell F5: light's one bar. Its readouts follow the focused
       pane; merged, they stand in for the per-pane status bar. -->
  <Toolbar spec={layout.spec} {ctx} />
{/snippet}

{#if placement === 'top'}
  <header class="shrink-0">
    <h1 class="sr-only">{vaultName}</h1>
    {#if layout.focus && !layout.toolbarShown}
      <!-- Focus mode hid the toolbar: the way out stays one Tab away for a
           keyboard and announced for a screen reader (quiet-shell F7). -->
      <button
        type="button"
        data-testid="leave-focus"
        onclick={() => layout.setFocus(false)}
        class="sr-only z-50 rounded border border-base-300 bg-base-100 px-3 py-1 text-sm text-base-content shadow-lg focus:not-sr-only focus:fixed focus:top-2 focus:left-1/2 focus:-translate-x-1/2 focus-visible:outline-2 focus-visible:outline-primary"
      >
        {$LL.web.toolbar.focus.leave()}
      </button>
    {/if}
    {#if layout.spec.regions.header === 'toolbar'}
      {#if toolbarHere}{@render toolbar()}{/if}
    {:else if layout.focusKeeps('header')}
      <div class="flex items-center gap-2 border-b border-base-300 bg-base-100 px-2 py-1">
        <IconButton
          label={layout.treeOpen ? $LL.web.shell.hide_navigator() : $LL.web.shell.show_navigator()}
          icon={PanelLeft}
          pressed={layout.treeOpen}
          testid="toggle-tree"
          onclick={() => (layout.treeOpen = !layout.treeOpen)}
        />
        <Breadcrumb path={selectedPath} {workspace} onReveal={(dir) => layout.revealInTree(dir)} />
        <!-- The vault rollup moved to the navigator, beside the vault it is
             about (P3); the header keeps the breadcrumb and the two toggles. -->
        <div class="ml-auto flex min-w-0 items-center gap-3">
          <!-- quiet-shell F13: in the dense header the drawer sits by the rail toggle. -->
          <Drawer {ctx} />
          <!-- …and the inspector's door to its right, while devtools are on. -->
          <Inspector {ctx} />
          <IconButton
            label={layout.railOpen ? $LL.web.shell.hide_sidebar() : $LL.web.shell.show_sidebar()}
            icon={PanelRight}
            pressed={layout.railOpen}
            testid="toggle-rail"
            onclick={() => (layout.railOpen = !layout.railOpen)}
          />
        </div>
      </div>
    {/if}
  </header>
{:else if toolbarHere}
  <!-- Under the panes (F5): the docked toolbar — the mode bar, which lives
       at the foot of the editor area, sits directly above it (spike S21
       Q5). A landmark of its own, as the top one sits in the banner. -->
  <footer class="shrink-0">
    {@render toolbar()}
  </footer>
{/if}
