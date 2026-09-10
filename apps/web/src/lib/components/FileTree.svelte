<script lang="ts">
  import { SvelteSet } from 'svelte/reactivity'
  import { ChevronsDownUp, FilePlus, FolderPlus, ListFilter, Users } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { pillStatus, type PillStatus, type SyncRecord } from '../sync-record.svelte.js'
  import type { FileRow, MountInfo } from '../workspace.svelte.js'
  import {
    buildTree,
    containingDir,
    dirPaths,
    filterRows,
    planDrop,
    treeMenuItems,
    type TreeFilter,
    type TreeMenuItem,
    type TreeMenuTarget,
    type TreeNode,
    type TreeOp,
  } from '../tree-model.js'
  import { inRelayMount, mountRollup, rowStatus } from '../tree-status.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import SyncPill from './SyncPill.svelte'
  import TreeContextMenu from './TreeContextMenu.svelte'

  interface Props {
    files: FileRow[]
    records: Record<string, SyncRecord>
    selected: string | null
    /** Shared subtrees (mount roots) — badges, rollups and the provenance filter (R3.2). */
    mounts: MountInfo[]
    /** The whole vault is shared (badge/filter treat everything as shared). */
    rootShared: boolean
    /** Names online per room — the count on a shared folder's badge (chrome U4). */
    presenceByRoom?: Record<string, string[]>
    /** A folder to expand, focus as the context and scroll to (a NEW object each time). */
    reveal?: { path: string } | null
    onSelect: (path: string) => void
    onOp: (op: TreeOp) => void
    /** A refusal worth keeping (drop rejected): the host toasts it and logs it. */
    onNotice: (level: 'warn' | 'error', text: string, path?: string) => void
  }

  let {
    files,
    records,
    selected,
    mounts,
    rootShared,
    presenceByRoom = {},
    reveal = null,
    onSelect,
    onOp,
    onNotice,
  }: Props = $props()

  let host = $state<HTMLElement>()

  const FILTERS: { value: TreeFilter; label: string }[] = [
    { value: 'all', label: 'All notes' },
    { value: 'local', label: 'Local only' },
    { value: 'shared', label: 'Shared only' },
  ]
  let filter = $state<TreeFilter>('all')

  const mountByPath = $derived(new Map(mounts.map((m) => [m.path, m])))
  const mountPaths = $derived(mounts.map((m) => m.path))
  const tree = $derived(buildTree(filterRows(files, filter, mountPaths, rootShared) as FileRow[]))
  /** Per mount root: the worst of its docs + its folder doc (Fork 3 B1). */
  const rollups = $derived(
    new Map(mounts.map((m) => [m.path, mountRollup(files, records, m.path, m.room)]))
  )
  const collapsed = new SvelteSet<string>()
  /** Last-clicked directory — where the toolbar's New note / New folder create. */
  let contextDir = $state<string | null>(null)

  /** Where New note / New folder create. */
  const targetDir = $derived(contextDir !== null ? contextDir : containingDir(selected, 'text'))
  const inLabel = $derived(targetDir ? ` in ${targetDir}` : '')

  /** The pill a file row shows, if any: quiet when good, loud when not (Fork 3 B2/B4). */
  function statusFor(node: TreeNode): PillStatus | null {
    const rec = records[node.guid]
    if (!rec) return null
    return rowStatus(pillStatus(rec), inRelayMount(node.path, mountPaths, rootShared))
  }

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

  function collapseAll(): void {
    for (const d of dirPaths(files)) collapsed.add(d)
  }

  $effect(() => {
    if (!reveal) return
    const path = reveal.path
    const segments = path.split('/')
    for (let i = 1; i <= segments.length; i++) collapsed.delete(segments.slice(0, i).join('/'))
    contextDir = path
    host
      ?.querySelector<HTMLElement>(`[data-testid="dir-item:${CSS.escape(path)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })

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

  /**
   * Row keys: Shift+F10 / Menu open the same menu; F2 renames and Delete
   * deletes (through the same dialogs the menu uses) — chrome U3.
   */
  function rowKey(e: KeyboardEvent, target: TreeMenuTarget): void {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      openMenu(e, target)
      return
    }
    if (target.kind === 'root') return
    if (e.key === 'F2') {
      e.preventDefault()
      onOp({ type: 'rename', path: target.path, kind: target.kind })
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onOp({ type: 'delete', path: target.path, kind: target.kind })
    }
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
      case 'add-share':
        onOp({ type: 'add-share', dir: path })
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
  /**
   * The refusal under the pointer, shown on the row itself while dragging
   * (browsers show no `title` mid-drag) and as a notice if the drag ends
   * there — the reason exists in `planDrop`; it used to be thrown away.
   */
  let refusal = $state<{ dir: string; reason: string } | null>(null)
  let dropped = false
  const allPaths = $derived(new Set(files.map((f) => f.path)))

  function dragStart(e: DragEvent, path: string): void {
    dragging = path
    dropped = false
    e.dataTransfer?.setData('text/plain', path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function dragEnd(): void {
    if (!dropped && refusal) onNotice('warn', `Not moved: ${refusal.reason}`, dragging ?? undefined)
    dragging = null
    dropDir = null
    refusal = null
    dropped = false
  }

  /**
   * A drop target lights up only when the move is actually legal — the pointer
   * carries the refusal (no drop cursor), and the row says why.
   */
  function dragOver(e: DragEvent, dir: string): void {
    e.stopPropagation()
    if (dragging === null) return
    const plan = planDrop(dragging, dir, allPaths)
    if (!plan.ok) {
      dropDir = null
      if (refusal?.dir !== dir || refusal.reason !== plan.reason) {
        refusal = { dir, reason: plan.reason }
      }
      return
    }
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dropDir = dir
    refusal = null
  }

  function drop(e: DragEvent, dir: string): void {
    e.preventDefault()
    e.stopPropagation()
    const from = dragging ?? e.dataTransfer?.getData('text/plain') ?? ''
    dropped = true
    dragging = null
    dropDir = null
    refusal = null
    const plan = planDrop(from, dir, allPaths)
    if (plan.ok) onOp({ type: 'move-to', from, to: plan.to })
  }

  /** Leaving the tree entirely clears the highlight; row-to-row does not. */
  function treeLeave(e: DragEvent): void {
    const to = e.relatedTarget
    if (to instanceof Node && e.currentTarget instanceof Node && e.currentTarget.contains(to)) return
    dropDir = null
    refusal = null
  }

  const indent = (depth: number): number => 8 + depth * 14
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<nav
  bind:this={host}
  data-testid="file-tree"
  aria-label="Files"
  class="flex h-full flex-col overflow-y-auto"
  ondragleave={treeLeave}
>
  <div class="flex items-center gap-0.5 border-b border-base-300 px-2 py-1">
    <h2 class="mr-auto pl-1 text-xs font-semibold tracking-wide text-base-content/70 uppercase">Files</h2>
    <IconButton
      label="New note{inLabel}"
      icon={FilePlus}
      testid="new-file"
      onclick={() => onOp({ type: 'new-file', dir: targetDir })}
    />
    <IconButton
      label="New folder{inLabel}"
      icon={FolderPlus}
      testid="new-folder"
      onclick={() => onOp({ type: 'new-folder', dir: targetDir })}
    />
    <IconButton
      label="Collapse all folders"
      icon={ChevronsDownUp}
      testid="collapse-all"
      onclick={collapseAll}
    />
    <DropdownMenu placement="bottom-end" testid="tree-filter-menu">
      {#snippet trigger(t)}
        <button
          use:melt={t}
          data-testid="tree-filter"
          class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary
            {filter !== 'all' ? 'bg-base-200 text-base-content' : ''}"
        >
          <ListFilter size={14} aria-hidden="true" />
          <span class="sr-only">Filter:</span>
          <span>{filter === 'all' ? 'All' : filter === 'local' ? 'Local' : 'Shared'}</span>
        </button>
      {/snippet}
      {#snippet children({ item })}
        {#each FILTERS as f (f.value)}
          <MenuItem
            {item}
            checked={filter === f.value}
            testid="tree-filter:{f.value}"
            onSelect={() => (filter = f.value)}
          >
            {f.label}
          </MenuItem>
        {/each}
      {/snippet}
    </DropdownMenu>
  </div>

  {#snippet nodeView(node: TreeNode, depth: number)}
    {@const target = { kind: node.kind, path: node.path } as TreeMenuTarget}
    {@const mount = node.kind === 'dir' ? mountByPath.get(node.path) : undefined}
    <li role="none" class={mount ? 'relative' : ''}>
      {#if node.kind === 'dir'}
        {#if mount}
          <!-- The shared subtree's extent, without a dot on every row (Fork 3 B3). -->
          <span
            aria-hidden="true"
            class="pointer-events-none absolute top-7 bottom-0 w-0.5 {mount.provenance === 'carved'
              ? 'bg-primary/40'
              : 'bg-secondary/40'}"
            style="left: {indent(depth) + 5}px"
          ></span>
        {/if}
        <button
          role="treeitem"
          aria-expanded={!collapsed.has(node.path)}
          aria-selected={contextDir === node.path}
          data-testid="dir-item:{node.path}"
          draggable="true"
          onclick={() => clickDir(node)}
          oncontextmenu={(e) => openMenu(e, target)}
          onkeydown={(e) => rowKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path)}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, node.path)}
          ondrop={(e) => drop(e, node.path)}
          style="padding-left: {indent(depth) - 2}px"
          class="flex w-full items-center gap-1 border-l-2 py-1 pr-3 text-left text-sm
            {dropDir === node.path
            ? 'inset-ring-2 inset-ring-primary border-transparent bg-primary/10 text-base-content'
            : contextDir === node.path
              ? 'border-primary text-base-content'
              : 'border-transparent text-base-content/80 hover:bg-base-200'}"
        >
          <span class="inline-block w-3 text-[10px] text-base-content/70" aria-hidden="true"
            >{collapsed.has(node.path) ? '▸' : '▾'}</span
          >
          <span class="truncate font-medium">{node.name}</span>
          {#if refusal?.dir === node.path}
            <span
              data-testid="drop-refusal"
              class="ml-auto truncate text-[10px] text-base-content/70 italic"
            >
              {refusal.reason}
            </span>
          {:else if mount}
            {@const online = (presenceByRoom[mount.room] ?? []).length}
            {@const whose = mount.provenance === 'carved' ? 'Shared by you' : 'Shared with you'}
            <span class="ml-auto flex shrink-0 items-center gap-1.5">
              <SyncPill status={rollups.get(node.path) ?? 'offline'} testid="sync-pill:{node.path}" />
              <span
                data-testid="mount-badge:{node.path}"
                title="{whose}{online ? ` · ${online} online` : ''}"
                class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium
                  {mount.provenance === 'carved'
                  ? 'bg-primary text-primary-content'
                  : 'bg-secondary text-secondary-content'}"
              >
                <Users size={12} aria-hidden="true" />
                {#if online}<span aria-hidden="true">{online}</span>{/if}
                <span class="sr-only">{whose}{online ? `, ${online} online` : ''}</span>
              </span>
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
        {@const status = statusFor(node)}
        <button
          role="treeitem"
          aria-selected={selected === node.path}
          data-testid="file-item:{node.path}"
          draggable="true"
          onclick={() => clickFile(node.path)}
          oncontextmenu={(e) => openMenu(e, target)}
          onkeydown={(e) => rowKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path)}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, containingDir(node.path, 'text'))}
          ondrop={(e) => drop(e, containingDir(node.path, 'text'))}
          aria-current={selected === node.path ? 'true' : undefined}
          style="padding-left: {indent(depth) + 12}px"
          class="flex w-full items-center justify-between gap-2 py-1.5 pr-3 text-left text-sm
            {selected === node.path
            ? 'bg-primary/10 font-medium text-base-content'
            : 'text-base-content hover:bg-base-200'}"
        >
          <span class="truncate">{node.name}</span>
          {#if status}
            <SyncPill {status} testid="sync-pill:{node.path}" />
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
          onkeydown={(e) => rowKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path)}
          ondragend={dragEnd}
          ondragover={(e) => dragOver(e, containingDir(node.path, 'binary'))}
          ondrop={(e) => drop(e, containingDir(node.path, 'binary'))}
          style="padding-left: {indent(depth) + 12}px"
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
