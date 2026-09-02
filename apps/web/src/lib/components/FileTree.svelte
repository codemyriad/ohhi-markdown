<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { pillStatus, type SyncRecord } from '../sync-record.svelte.js'
  import type { FileRow, MountInfo } from '../workspace.svelte.js'
  import {
    buildTree,
    containingDir,
    filterRows,
    type TreeFilter,
    type TreeNode,
    type TreeOp,
  } from '../tree-model.js'
  import SyncPill from './SyncPill.svelte'

  interface Props {
    files: FileRow[]
    records: Record<string, SyncRecord>
    selected: string | null
    /** Shared subtrees (mount roots) — badges + the provenance filter (R3.2). */
    mounts: MountInfo[]
    /** The whole vault is shared (badge/filter treat everything as shared). */
    rootShared: boolean
    onSelect: (path: string) => void
    onOp: (op: TreeOp) => void
  }

  let { files, records, selected, mounts, rootShared, onSelect, onOp }: Props = $props()

  let filter = $state<TreeFilter>('all')
  const mountByPath = $derived(new Map(mounts.map((m) => [m.path, m])))
  const tree = $derived(
    buildTree(
      filterRows(files, filter, mounts.map((m) => m.path), rootShared) as FileRow[]
    )
  )
  const collapsed = new SvelteSet<string>()
  /** Last-clicked directory — the target for new/rename/move/delete on dirs. */
  let contextDir = $state<string | null>(null)

  /** The node ops act on: an explicitly clicked dir, else the selected file. */
  const contextNode = $derived.by((): { path: string; kind: 'dir' | 'text' | 'binary' } | null => {
    if (contextDir !== null) return { path: contextDir, kind: 'dir' }
    if (selected) {
      const row = files.find((f) => f.path === selected)
      if (row) return { path: row.path, kind: row.kind }
    }
    return null
  })
  /** Where "+ file" / "+ folder" create. */
  const targetDir = $derived(
    contextDir !== null ? contextDir : containingDir(selected, 'text')
  )

  function clickDir(node: TreeNode): void {
    if (contextDir === node.path) {
      // Second click on the focused dir toggles disclosure.
      if (collapsed.has(node.path)) collapsed.delete(node.path)
      else collapsed.add(node.path)
    }
    contextDir = node.path
  }

  function clickFile(path: string): void {
    contextDir = null
    onSelect(path)
  }

  /** A dir can be shared when it's a mount root already, or a plain folder of
   * an unshared root vault that doesn't overlap an existing mount. */
  const canShareContext = $derived.by((): boolean => {
    const node = contextNode
    if (!node || node.kind !== 'dir') return false
    if (mountByPath.has(node.path)) return true // manage an existing share
    if (rootShared) return false // V1 guard: no shares inside a shared vault
    return !mounts.some(
      (m) => node.path.startsWith(`${m.path}/`) || m.path.startsWith(`${node.path}/`)
    )
  })
  /** The context node's mount, when it IS a mount root (unshare/unmount). */
  const contextMount = $derived(
    contextNode && contextNode.kind === 'dir' ? (mountByPath.get(contextNode.path) ?? null) : null
  )
</script>

<nav data-testid="file-tree" aria-label="Files" class="flex h-full flex-col overflow-y-auto">
  <div class="flex items-center gap-1 border-b border-base-300 px-2 py-2">
    <h2 class="mr-auto pl-1 text-xs font-semibold tracking-wide text-base-content/60 uppercase">Files</h2>
    <button
      data-testid="new-file"
      onclick={() => onOp({ type: 'new-file', dir: targetDir })}
      title="New file{targetDir ? ` in ${targetDir}` : ''}"
      class="rounded bg-base-200 px-1.5 py-0.5 text-xs font-medium text-base-content/80 hover:bg-base-300"
    >
      + file
    </button>
    <button
      data-testid="new-folder"
      onclick={() => onOp({ type: 'new-folder', dir: targetDir })}
      title="New folder{targetDir ? ` in ${targetDir}` : ''}"
      class="rounded bg-base-200 px-1.5 py-0.5 text-xs font-medium text-base-content/80 hover:bg-base-300"
    >
      + folder
    </button>
  </div>
  <div
    class="flex items-center gap-0.5 border-b border-base-200 px-2 py-1"
    role="radiogroup"
    aria-label="Filter by sharing"
  >
    {#each [['all', 'All'], ['local', 'Local'], ['shared', 'Shared']] as const as [value, label] (value)}
      <button
        role="radio"
        aria-checked={filter === value}
        data-testid="tree-filter:{value}"
        onclick={() => (filter = value)}
        class="rounded px-1.5 py-0.5 text-[10px] font-medium
          {filter === value ? 'bg-primary/15 text-primary' : 'text-base-content/60 hover:bg-base-200'}"
      >
        {label}
      </button>
    {/each}
  </div>
  {#if contextNode}
    <div
      class="flex items-center gap-1 border-b border-base-200 px-2 py-1 text-[11px] text-base-content/60"
    >
      <span class="min-w-0 flex-1 truncate" title={contextNode.path}>{contextNode.path}</span>
      {#if canShareContext}
        <button
          data-testid="tree-share"
          onclick={() => onOp({ type: 'share-folder', path: contextNode.path })}
          class="rounded px-1.5 py-0.5 text-primary hover:bg-primary/10"
        >
          share
        </button>
      {/if}
      {#if contextMount}
        <button
          data-testid="tree-unshare"
          onclick={() => onOp({ type: 'unshare', path: contextNode.path })}
          class="rounded px-1.5 py-0.5 text-warning hover:bg-warning/10"
        >
          unshare
        </button>
        {#if contextMount.provenance === 'joined'}
          <button
            data-testid="tree-unmount"
            onclick={() => onOp({ type: 'unmount', path: contextNode.path })}
            class="rounded px-1.5 py-0.5 text-warning hover:bg-warning/10"
          >
            unmount
          </button>
        {/if}
      {/if}
      <button
        data-testid="tree-rename"
        onclick={() => onOp({ type: 'rename', ...contextNode })}
        class="rounded px-1.5 py-0.5 hover:bg-base-200"
      >
        rename
      </button>
      <button
        data-testid="tree-move"
        onclick={() => onOp({ type: 'move', ...contextNode })}
        class="rounded px-1.5 py-0.5 hover:bg-base-200"
      >
        move
      </button>
      <button
        data-testid="tree-delete"
        onclick={() => onOp({ type: 'delete', ...contextNode })}
        class="rounded px-1.5 py-0.5 text-error hover:bg-error/10"
      >
        delete
      </button>
    </div>
  {/if}

  {#snippet nodeView(node: TreeNode, depth: number)}
    <li role="none">
      {#if node.kind === 'dir'}
        <button
          role="treeitem"
          aria-expanded={!collapsed.has(node.path)}
          aria-selected={contextDir === node.path}
          data-testid="dir-item:{node.path}"
          onclick={() => clickDir(node)}
          style="padding-left: {8 + depth * 14}px"
          class="flex w-full items-center gap-1 py-1 pr-3 text-left text-sm
            {contextDir === node.path ? 'bg-base-200 text-base-content' : 'text-base-content/80 hover:bg-base-200'}"
        >
          <span class="inline-block w-3 text-[10px] text-base-content/40"
            >{collapsed.has(node.path) ? '▸' : '▾'}</span
          >
          <span class="truncate font-medium">{node.name}</span>
          {#if mountByPath.has(node.path)}
            {@const m = mountByPath.get(node.path)!}
            <span
              data-testid="mount-badge:{node.path}"
              title={m.provenance === 'carved' ? 'shared by you' : 'shared with you'}
              class="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide
                {m.provenance === 'carved'
                ? 'bg-primary/15 text-primary'
                : 'bg-secondary/15 text-secondary'}"
            >
              shared
            </span>
          {/if}
        </button>
        {#if !collapsed.has(node.path)}
          <ul role="group">
            {#each node.children as child (child.path)}
              {@render nodeView(child, depth + 1)}
            {/each}
          </ul>
        {/if}
      {:else if node.kind === 'text'}
        <button
          role="treeitem"
          aria-selected={selected === node.path}
          data-testid="file-item:{node.path}"
          onclick={() => clickFile(node.path)}
          aria-current={selected === node.path ? 'true' : undefined}
          style="padding-left: {8 + depth * 14 + 12}px"
          class="flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-left text-sm
            {selected === node.path ? 'bg-primary/10 font-medium text-primary' : 'text-base-content hover:bg-base-200'}"
        >
          <span class="truncate">{node.name}</span>
          {#if records[node.guid]}
            <SyncPill status={pillStatus(records[node.guid])} testid="sync-pill:{node.path}" />
          {/if}
        </button>
      {:else}
        <!-- Binaries are excluded from sync; the pill never claims them (D2f). -->
        <div
          role="treeitem"
          aria-selected="false"
          data-testid="file-item:{node.path}"
          style="padding-left: {8 + depth * 14 + 12}px"
          class="flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-sm text-base-content/40"
        >
          <span class="truncate">{node.name}</span>
          <span
            data-testid="binary-badge:{node.path}"
            class="shrink-0 rounded border border-base-300 px-1.5 py-0.5 text-[10px] tracking-wide text-base-content/60 uppercase"
          >
            not synced
          </span>
        </div>
      {/if}
    </li>
  {/snippet}

  <ul role="tree" aria-label="Vault files" class="flex-1 py-1">
    {#each tree as node (node.path)}
      {@render nodeView(node, 0)}
    {/each}
  </ul>
</nav>
