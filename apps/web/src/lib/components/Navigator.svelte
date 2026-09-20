<script lang="ts">
  /**
   * The navigator column (chrome U2, U3, shell-polish P3): the actions
   * cluster, the file tree, and the vault row — switcher, the vault's own
   * sync rollup, settings — with a resize handle on its edge. Layout state
   * is `shell-layout`'s; every action is a callback, so this stays a view.
   */
  import { Settings } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { VaultEntry } from '../config.js'
  import { TREE_WIDTH } from '../layout.js'
  import type { Navigation } from '../navigation.svelte.js'
  import { vaultLabel, vaultTitle } from '../pill-status.js'
  import { scopedRollup } from '../share-status.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import type { TreeOp } from '../tree-model.js'
  import IconButton from '../ui/IconButton.svelte'
  import ResizeHandle from '../ui/ResizeHandle.svelte'
  import type { Workspace } from '../workspace.svelte.js'
  import ActionsCluster from './ActionsCluster.svelte'
  import FileTree from './FileTree.svelte'
  import SyncPill from './SyncPill.svelte'
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
  }

  let { workspace, nav, layout, vaults, vaultName, onOpen, onOp, onSwitch, onManage, onSettings }: Props =
    $props()

  const selectedPath = $derived(workspace.ui.selectedPath ?? null)
  /**
   * The vault rollup, fed only by docs that have a relay to be in sync WITH
   * (chrome U4). Null = nothing is shared, and the row says so in words:
   * a pill for an absence would read as a problem.
   */
  const globalStatus = $derived(
    scopedRollup(workspace.ui.files, workspace.ui.records, workspace.ui.mounts, workspace.ui.linked)
  )
</script>

<aside
  data-testid="navigator"
  aria-label={$LL.web.shell.navigator_label()}
  style="width: {layout.treeWidth}px"
  class="relative flex shrink-0 flex-col border-r border-base-300 bg-base-100"
>
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
      reveal={layout.revealDir}
      onSelect={onOpen}
      {onOp}
      onNotice={(level, text, path) => workspace.notify({ level, text, path })}
    />
  </div>
  <div class="flex min-w-0 items-center gap-1 border-t border-base-300 px-2 py-1">
    <VaultSwitcher current={{ room: workspace.room, name: vaultName }} {vaults} {onSwitch} {onManage} />
    <!-- The vault's own rollup, beside the vault's name: a dot and a
         word, and a title that says whose state it is (P3). -->
    {#if globalStatus}
      <SyncPill
        status={globalStatus}
        testid="sync-pill-global"
        label={vaultLabel(globalStatus)}
        title={vaultTitle(globalStatus)}
      />
    {:else}
      <span data-testid="sync-summary" class="min-w-0 truncate text-xs text-base-content/70">
        {$LL.web.shell.nothing_shared()}
      </span>
    {/if}
    <div class="ml-auto">
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
