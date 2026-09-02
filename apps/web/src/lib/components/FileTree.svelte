<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { pillStatus, type SyncRecord } from '../sync-record.svelte.js'
  import type { FileRow } from '../workspace.svelte.js'
  import { buildTree, containingDir, type TreeNode, type TreeOp } from '../tree-model.js'
  import SyncPill from './SyncPill.svelte'

  interface Props {
    files: FileRow[]
    records: Record<string, SyncRecord>
    selected: string | null
    onSelect: (path: string) => void
    onOp: (op: TreeOp) => void
  }

  let { files, records, selected, onSelect, onOp }: Props = $props()

  const tree = $derived(buildTree(files))
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
</script>

<nav data-testid="file-tree" aria-label="Files" class="flex h-full flex-col overflow-y-auto">
  <div class="flex items-center gap-1 border-b border-gray-200 px-2 py-2">
    <h2 class="mr-auto pl-1 text-xs font-semibold tracking-wide text-gray-500 uppercase">Files</h2>
    <button
      data-testid="new-file"
      onclick={() => onOp({ type: 'new-file', dir: targetDir })}
      title="New file{targetDir ? ` in ${targetDir}` : ''}"
      class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
    >
      + file
    </button>
    <button
      data-testid="new-folder"
      onclick={() => onOp({ type: 'new-folder', dir: targetDir })}
      title="New folder{targetDir ? ` in ${targetDir}` : ''}"
      class="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200"
    >
      + folder
    </button>
  </div>
  {#if contextNode}
    <div
      class="flex items-center gap-1 border-b border-gray-100 px-2 py-1 text-[11px] text-gray-500"
    >
      <span class="min-w-0 flex-1 truncate" title={contextNode.path}>{contextNode.path}</span>
      <button
        data-testid="tree-rename"
        onclick={() => onOp({ type: 'rename', ...contextNode })}
        class="rounded px-1.5 py-0.5 hover:bg-gray-100"
      >
        rename
      </button>
      <button
        data-testid="tree-move"
        onclick={() => onOp({ type: 'move', ...contextNode })}
        class="rounded px-1.5 py-0.5 hover:bg-gray-100"
      >
        move
      </button>
      <button
        data-testid="tree-delete"
        onclick={() => onOp({ type: 'delete', ...contextNode })}
        class="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50"
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
            {contextDir === node.path ? 'bg-gray-100 text-gray-900' : 'text-gray-700 hover:bg-gray-50'}"
        >
          <span class="inline-block w-3 text-[10px] text-gray-400"
            >{collapsed.has(node.path) ? '▸' : '▾'}</span
          >
          <span class="truncate font-medium">{node.name}</span>
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
            {selected === node.path ? 'bg-blue-50 font-medium text-blue-900' : 'text-gray-800 hover:bg-gray-50'}"
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
          class="flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-sm text-gray-400"
        >
          <span class="truncate">{node.name}</span>
          <span
            data-testid="binary-badge:{node.path}"
            class="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] tracking-wide text-gray-500 uppercase"
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
