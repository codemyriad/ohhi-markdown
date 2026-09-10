<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { pillStatus, type SyncRecord } from '../sync-record.svelte.js'
  import type { FileRow, MountInfo } from '../workspace.svelte.js'
  import {
    buildTree,
    containingDir,
    filterRows,
    planDrop,
    treeMenuItems,
    type TreeFilter,
    type TreeMenuItem,
    type TreeMenuTarget,
    type TreeNode,
    type TreeOp,
  } from '../tree-model.js'
  import SyncPill from './SyncPill.svelte'
  import TreeContextMenu from './TreeContextMenu.svelte'

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
  /** Last-clicked directory — where the header's "+ file"/"+ folder" create. */
  let contextDir = $state<string | null>(null)

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

  // ---- context menu ----

  interface MenuState {
    x: number
    y: number
    label: string
    target: TreeMenuTarget
    items: TreeMenuItem[]
  }
  let menu = $state<MenuState | null>(null)
  /** The row that opened the menu — focus goes back to it on close. */
  let menuOrigin: HTMLElement | null = null

  function labelFor(target: TreeMenuTarget): string {
    return target.kind === 'root' ? 'Vault root actions' : `Actions for ${target.path}`
  }

  function openMenu(e: Event, target: TreeMenuTarget, at?: { x: number; y: number }): void {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget instanceof HTMLElement ? e.currentTarget : null
    let point = at
    if (!point && e instanceof MouseEvent && (e.clientX || e.clientY)) {
      point = { x: e.clientX, y: e.clientY }
    }
    if (!point) {
      // Keyboard invocation: hang the menu off the row's bottom-left corner.
      const r = el?.getBoundingClientRect()
      point = { x: r ? r.left + 8 : 24, y: r ? r.bottom : 24 }
    }
    menuOrigin = el
    // Right-click focuses nothing on its own in Chromium, so take focus here:
    // the menu restores focus to this element when it closes.
    el?.focus?.()
    menu = {
      ...point,
      label: labelFor(target),
      target,
      items: treeMenuItems(target, { mounts, rootShared }),
    }
  }

  /** Shift+F10 / the Menu key — the keyboard route to the same menu. */
  function menuKey(e: KeyboardEvent, target: TreeMenuTarget): void {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) openMenu(e, target)
  }

  function closeMenu(): void {
    menu = null
    menuOrigin?.focus()
    menuOrigin = null
  }

  function runMenu(item: TreeMenuItem): void {
    const target = menu?.target
    closeMenu()
    if (!target) return
    const path = target.kind === 'root' ? '' : target.path
    switch (item.action) {
      case 'new-file':
        onOp({ type: 'new-file', dir: path })
        break
      case 'new-folder':
        onOp({ type: 'new-folder', dir: path })
        break
      case 'rename':
      case 'move':
      case 'delete':
        if (target.kind !== 'root') onOp({ type: item.action, path, kind: target.kind })
        break
      // Sharing and managing an existing share are one dialog, keyed on
      // whether the folder already is a mount root.
      case 'share':
      case 'manage':
        onOp({ type: 'share-folder', path })
        break
      case 'unshare':
        onOp({ type: 'unshare', path })
        break
      case 'unmount':
        onOp({ type: 'unmount', path })
        break
    }
  }

  // ---- drag-and-drop arrange ----

  let dragging = $state<string | null>(null)
  /** Highlighted drop directory; '' is the tree's root area, null is none. */
  let dropDir = $state<string | null>(null)
  const allPaths = $derived(new Set(files.map((f) => f.path)))

  function dragStart(e: DragEvent, path: string): void {
    dragging = path
    e.dataTransfer?.setData('text/plain', path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function dragEnd(): void {
    dragging = null
    dropDir = null
  }

  /**
   * A drop target lights up only when the move is actually legal — the pointer
   * carries the refusal (no drop cursor) rather than a dialog after the fact.
   */
  function dragOver(e: DragEvent, dir: string): void {
    e.stopPropagation()
    if (dragging === null) return
    if (!planDrop(dragging, dir, allPaths).ok) {
      dropDir = null
      return
    }
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dropDir = dir
  }

  function drop(e: DragEvent, dir: string): void {
    e.preventDefault()
    e.stopPropagation()
    const from = dragging ?? e.dataTransfer?.getData('text/plain') ?? ''
    dragging = null
    dropDir = null
    const plan = planDrop(from, dir, allPaths)
    if (plan.ok) onOp({ type: 'move-to', from, to: plan.to })
  }

  /** Leaving the tree entirely clears the highlight; row-to-row does not. */
  function treeLeave(e: DragEvent): void {
    const to = e.relatedTarget
    if (to instanceof Node && e.currentTarget instanceof Node && e.currentTarget.contains(to)) return
    dropDir = null
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  data-testid="file-tree"
  aria-label="Files"
  class="flex h-full flex-col overflow-y-auto"
  ondragleave={treeLeave}
>
  <div class="flex items-center gap-1 border-b border-base-300 px-2 py-2">
    <h2 class="mr-auto pl-1 text-xs font-semibold tracking-wide text-base-content/70 uppercase">Files</h2>
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
          {filter === value ? 'bg-primary text-primary-content' : 'text-base-content/70 hover:bg-base-200'}"
      >
        {label}
      </button>
    {/each}
  </div>

  {#snippet nodeView(node: TreeNode, depth: number)}
    {@const target = { kind: node.kind, path: node.path } as TreeMenuTarget}
    <li role="none">
      {#if node.kind === 'dir'}
        <button
          role="treeitem"
          aria-expanded={!collapsed.has(node.path)}
          aria-selected={contextDir === node.path}
          data-testid="dir-item:{node.path}"
          draggable="true"
          onclick={() => clickDir(node)}
          oncontextmenu={(e) => openMenu(e, target)}
          onkeydown={(e) => menuKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path)}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, node.path)}
          ondrop={(e) => drop(e, node.path)}
          style="padding-left: {8 + depth * 14}px"
          class="flex w-full items-center gap-1 py-1 pr-3 text-left text-sm
            {dropDir === node.path
            ? 'inset-ring-2 inset-ring-primary bg-primary/10 text-base-content'
            : contextDir === node.path
              ? 'bg-base-200 text-base-content'
              : 'text-base-content/80 hover:bg-base-200'}"
        >
          <span class="inline-block w-3 text-[10px] text-base-content/70"
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
                ? 'bg-primary text-primary-content'
                : 'bg-secondary text-secondary-content'}"
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
          draggable="true"
          onclick={() => clickFile(node.path)}
          oncontextmenu={(e) => openMenu(e, target)}
          onkeydown={(e) => menuKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path)}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, containingDir(node.path, 'text'))}
          ondrop={(e) => drop(e, containingDir(node.path, 'text'))}
          aria-current={selected === node.path ? 'true' : undefined}
          style="padding-left: {8 + depth * 14 + 12}px"
          class="flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-left text-sm
            {selected === node.path ? 'bg-primary/10 font-medium text-base-content' : 'text-base-content hover:bg-base-200'}"
        >
          <span class="truncate">{node.name}</span>
          {#if records[node.guid]}
            <SyncPill status={pillStatus(records[node.guid])} testid="sync-pill:{node.path}" />
          {/if}
        </button>
      {:else}
        <!-- Binaries are excluded from sync; the pill never claims them (D2f).
             They are still files, so they rename, move and delete like one. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div
          role="treeitem"
          aria-selected="false"
          tabindex="0"
          data-testid="file-item:{node.path}"
          draggable="true"
          oncontextmenu={(e) => openMenu(e, target)}
          onkeydown={(e) => menuKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path)}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, containingDir(node.path, 'binary'))}
          ondrop={(e) => drop(e, containingDir(node.path, 'binary'))}
          style="padding-left: {8 + depth * 14 + 12}px"
          class="flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-sm text-base-content/70"
        >
          <span class="truncate">{node.name}</span>
          <span
            data-testid="binary-badge:{node.path}"
            class="shrink-0 rounded border border-base-300 px-1.5 py-0.5 text-[10px] tracking-wide text-base-content/70 uppercase"
          >
            not synced
          </span>
        </div>
      {/if}
    </li>
  {/snippet}

  <!-- The tree's own body is the vault root: right-click it to create at the
       top level, drop onto it to move something back out of a folder. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul
    role="tree"
    aria-label="Vault files"
    data-testid="tree-root"
    oncontextmenu={(e) => openMenu(e, { kind: 'root' })}
    ondragover={(e) => dragOver(e, '')}
    ondrop={(e) => drop(e, '')}
    class="flex-1 py-1 {dropDir === '' ? 'inset-ring-2 inset-ring-primary' : ''}"
  >
    {#each tree as node (node.path)}
      {@render nodeView(node, 0)}
    {/each}
  </ul>
</nav>

{#if menu}
  <TreeContextMenu
    x={menu.x}
    y={menu.y}
    label={menu.label}
    items={menu.items}
    onPick={runMenu}
    onClose={closeMenu}
  />
{/if}
