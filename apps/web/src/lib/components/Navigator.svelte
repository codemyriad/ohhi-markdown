<script lang="ts">
  /**
   * The navigator column (chrome U2, U3, shell-polish P3): a 32 px header
   * row carrying pin / unpin (the tab strip's height, Chris 2026-10-06), the
   * actions cluster, the file tree, and the vault row — switcher, settings —
   * with a resize handle on its edge. The vault's sync rollup
   * left the row (Round 2, P7): the toolbar's `sync` readout is the one
   * door to Shared now. Pin and unpin are icons (P7): in the drawer, *Pin
   * as a column*; in a column this device pinned, *Unpin* back to the
   * layout's own setting. Layout state is `shell-layout`'s; every action is
   * a callback, so this stays a view.
   */
  import { Pin, PinOff, Settings } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { VaultEntry } from '../config.js'
  import { TREE_WIDTH } from '../layout.js'
  import type { Navigation } from '../navigation.svelte.js'
  import { changeTicks } from '../changes.js'
  import { realClock } from '../real-clock.js'
  import { clockTick } from '../relative-time.js'
  import { getViewShell } from '../views.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import type { TreeOp } from '../tree-model.js'
  import IconButton from '../ui/IconButton.svelte'
  import ResizeHandle from '../ui/ResizeHandle.svelte'
  import type { Workspace } from '../workspace.svelte.js'
  import ActionsCluster from './ActionsCluster.svelte'
  import FileTree from './FileTree.svelte'
  import PinWideOnly from './PinWideOnly.svelte'
  import VaultSwitcher from './VaultSwitcher.svelte'

  interface Props {
    workspace: Workspace
    nav: Navigation
    layout: ShellLayout
    vaults: VaultEntry[]
    vaultName: string
    onOpen: (path: string, opts?: { background?: boolean }) => void
    onOp: (op: TreeOp) => void
    onSwitch: (entry: VaultEntry) => void
    onManage: () => void
    onSettings: () => void
    /** Set by the drawer: *Pin as a column* is offered (an icon in the header row). */
    onPin?: () => void
  }

  let {
    workspace,
    nav,
    layout,
    vaults,
    vaultName,
    onOpen,
    onOp,
    onSwitch,
    onManage,
    onSettings,
    onPin,
  }: Props = $props()

  const selectedPath = $derived(workspace.ui.selectedPath ?? null)
  /** A column this device pinned over a layout that does not have one: it can be unpinned. */
  const unpinnable = $derived(
    !onPin && layout.pinned('navigator') && layout.ownSpec.regions.navigator !== 'column'
  )
  const viewShell = getViewShell()
  // svelte-ignore state_referenced_locally -- the clock is fixed at mount
  const now = clockTick(viewShell?.clock ?? realClock)
  /** Change ticks (sharing E3): notes others changed in the last hour, ageing out on the clock. */
  const ticks = $derived(
    changeTicks(
      workspace.ui.events,
      $now,
      workspace.ui.mounts.map((m) => m.path)
    )
  )
</script>

<aside
  data-testid="navigator"
  aria-label={$LL.web.shell.navigator_label()}
  style="width: {layout.treeWidth}px"
  class="relative flex shrink-0 flex-col border-r border-base-300 bg-base-100"
>
  <!-- The header row (Chris, 2026-10-06): the tab strip's height (32 px, as
       the dock panel's tab row), so the two sidebars' tops line up with the
       panes'; pin (the drawer) or unpin (a column this device pinned) at its
       right end, at the strip's control size. -->
  <div data-testid="navigator-header" class="flex h-8 shrink-0 items-center justify-end border-b border-base-300 px-1">
    {#if onPin && !layout.pinsHonoured}
      <!-- A small screen (QA round 1): pins apply on wider screens only. -->
      <PinWideOnly
        pinned={layout.pinned('navigator')}
        testid="navigator-pin"
        onExplain={(text) => workspace.flash({ level: 'info', text })}
      />
    {:else if onPin}
      <IconButton label={$LL.web.shell.pin_navigator()} icon={Pin} placement="bottom" testid="navigator-pin" onclick={onPin} />
    {:else if unpinnable}
      <IconButton
        label={$LL.web.shell.unpin_navigator()}
        icon={PinOff}
        placement="bottom"
        testid="navigator-unpin"
        onclick={() => layout.unpin('navigator')}
      />
    {/if}
  </div>
  <ActionsCluster
    bindings={{
      quickOpen: nav.registry.binding('nav.quick-open'),
      search: nav.registry.binding('nav.search'),
      commands: nav.registry.binding('nav.command-palette'),
    }}
    onQuickOpen={() => nav.open('quick-open')}
    onSearch={() => nav.open('search')}
    onCommands={() => nav.open('command')}
  />
  <div class="min-h-0 flex-1">
    <FileTree
      files={workspace.ui.files}
      records={workspace.ui.records}
      selected={selectedPath}
      mounts={workspace.ui.mounts}
      rootShared={workspace.ui.linked}
      presenceByRoom={workspace.ui.presenceByRoom}
      self={workspace.user.name}
      presence={workspace.ui.presenceByPath}
      changed={ticks}
      reveal={layout.revealDir}
      onSelect={onOpen}
      {onOp}
      onNotice={(level, text, path) => workspace.flash({ level, text, path })}
    />
  </div>
  <div class="flex min-w-0 items-center gap-1 border-t border-base-300 px-2 py-1">
    <VaultSwitcher current={{ room: workspace.room, name: vaultName }} {vaults} {onSwitch} {onManage} />
    <div class="ml-auto flex items-center gap-0.5">
      <IconButton
        label={$LL.web.shell.settings_with_binding({ binding: nav.registry.binding('app.settings') })}
        icon={Settings}
        placement="top"
        testid="open-settings"
        onclick={onSettings}
      />
    </div>
  </div>
  <ResizeHandle
    value={layout.treeWidth}
    min={TREE_WIDTH.min}
    max={TREE_WIDTH.max}
    step={TREE_WIDTH.step}
    label={$LL.web.shell.resize_navigator()}
    testid="tree-resize"
    collapseBelow={TREE_WIDTH.collapseBelow}
    onCollapse={() => (layout.treeOpen = false)}
    onChange={(px) => (layout.treeWidth = px)}
    onCommit={() => layout.commitTreeWidth()}
  />
</aside>
