<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import { ChevronsDownUp, FilePlus, FolderPlus, KeyRound, ListFilter, Users } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { pillStatus, type PillStatus, type SyncRecord } from '../sync-record.svelte.js'
  import type { FileRow, MountInfo } from '../workspace.svelte.js'
  import {
    buildTree,
    containingDir,
    dirPaths,
    filterRows,
    mountRoots,
    planDrop,
    treeMenuItems,
    type TreeFilter,
    type TreeMenuItem,
    type TreeMenuTarget,
    type TreeNode,
    type TreeOp,
  } from '../tree-model.js'
  import { inRelayMount, mountRollup, rowStatus } from '../tree-status.js'
  import { inQuietMount, mountHasRelay, mountTone } from '../share-status.js'
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
    /**
     * Open a note. `background` = Mod+click, the browser gesture for "a tab,
     * but stay here" (tab-groups B5).
     */
    onSelect: (path: string, opts?: { background?: boolean }) => void
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

  const t = $derived($LL.web.tree)
  const m = $derived($LL.web.mounts)
  const FILTER_VALUES: TreeFilter[] = ['all', 'local', 'shared']
  let filter = $state<TreeFilter>('all')

  const mountByPath = $derived(new Map(mounts.map((mo) => [mo.path, mo])))
  /**
   * Two lists on purpose. The provenance filter counts EVERY mount — a
   * needs-token mount's files are shared, not local (spike S10 Q2) — while
   * only a mount with a relay may carry a pill or feed a rollup.
   */
  const relayPaths = $derived(mounts.filter(mountHasRelay).map((mo) => mo.path))
  const tree = $derived(buildTree(filterRows(files, filter, mounts, rootShared) as FileRow[]))
  /** Per RELAY-attached mount root: the worst of its docs + its folder doc (Fork 3 B1). */
  const rollups = $derived(
    new Map(
      mounts
        .filter(mountHasRelay)
        .map((mo) => [mo.path, mountRollup(files, records, mo.path, mo.room)])
    )
  )
  const collapsed = new SvelteSet<string>()
  /** Last-clicked directory — where the toolbar's New note / New folder create. */
  let contextDir = $state<string | null>(null)

  /** Where New note / New folder create. */
  const targetDir = $derived(contextDir !== null ? contextDir : containingDir(selected, 'text'))

  /** The pill a file row shows, if any: quiet when good, loud when not (Fork 3 B2/B4). */
  function statusFor(node: TreeNode): PillStatus | null {
    const rec = records[node.guid]
    if (!rec) return null
    // Inside a mount with no relay there is nothing to be in sync with: those
    // records never connect, and an offline dot would blame the network for a
    // missing key (spike S10 Q2, golden rule 4).
    if (inQuietMount(node.path, mounts)) return null
    return rowStatus(pillStatus(rec), inRelayMount(node.path, relayPaths, rootShared))
  }

  function clickDir(node: TreeNode): void {
    if (contextDir === node.path) {
      // Second click on the focused dir toggles disclosure.
      if (collapsed.has(node.path)) collapsed.delete(node.path)
      else collapsed.add(node.path)
    }
    contextDir = node.path
  }

  function clickFile(path: string, e: MouseEvent): void {
    contextDir = null
    onSelect(path, { background: e.metaKey || e.ctrlKey })
  }

  function collapseAll(): void {
    for (const d of dirPaths(files)) collapsed.add(d)
  }

  /** Expand every folder on the way to `path` (the path itself included, if it is one). */
  function expandAncestors(path: string): void {
    const segments = path.split('/')
    for (let i = 1; i <= segments.length; i++) collapsed.delete(segments.slice(0, i).join('/'))
  }

  /**
   * Scroll a row into view AFTER Svelte has flushed: the ancestors just
   * expanded — and a row just created — are not in the DOM until it has.
   */
  function scrollToRow(testid: string): void {
    void tick().then(() => {
      host
        ?.querySelector<HTMLElement>(`[data-testid="${CSS.escape(testid)}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  }

  $effect(() => {
    if (!reveal) return
    const path = reveal.path
    expandAncestors(path)
    contextDir = path
    scrollToRow(`dir-item:${path}`)
  })

  /**
   * Reveal the active file — Obsidian's behaviour, and the reason a note
   * opened from anywhere (the palette, a link, a new note made in a folded
   * folder) is visible in the tree rather than hidden somewhere in it.
   */
  $effect(() => {
    const path = selected
    if (!path) return
    untrack(() => expandAncestors(containingDir(path, 'text')))
    scrollToRow(`file-item:${path}`)
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
    return target.kind === 'root' ? t.root_actions() : t.actions_for({ path: target.path })
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
    // F2 / Delete bypass the menu, so they need the menu's refusal: a mount
    // root is owned by another mount session and cannot be renamed or deleted
    // from the tree. The reason is spoken, not swallowed.
    if (mountByPath.has(target.path) && (e.key === 'F2' || e.key === 'Delete')) {
      e.preventDefault()
      onNotice(
        'warn',
        e.key === 'F2'
          ? m.reason.mount_root_rename({ path: target.path })
          : m.reason.mount_root_delete({ path: target.path }),
        target.path
      )
      return
    }
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
      case 'add-link':
        onOp({ type: 'add-link', path })
        break
      case 'history':
        onOp({ type: 'history', path })
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
  /** Mount roots: undraggable, for the same reason Move… is disabled on them. */
  const rootPaths = $derived(mountRoots(mounts))

  function dragStart(e: DragEvent, path: string, openable: boolean): void {
    dragging = path
    dropped = false
    e.dataTransfer?.setData('text/plain', path)
    // The discriminator a pane reads during `dragover`, where only the TYPES
    // are visible (P1.2). Notes only: a folder or a binary has no doc to open,
    // so its tab would sit there under its name showing the empty launcher.
    if (openable) e.dataTransfer?.setData('application/x-editor-path', path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  /**
   * Only a refusing tree row sets `refusal`, and leaving the tree clears it
   * (`treeLeave`) — so a row dropped on a pane (P1.2) ends quietly: "Not
   * moved" would be a lie about a move that did happen, elsewhere.
   */
  function dragEnd(): void {
    if (!dropped && refusal) onNotice('warn', t.not_moved({ reason: refusal.reason }), dragging ?? undefined)
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
    const plan = planDrop(dragging, dir, allPaths, rootPaths)
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
    const plan = planDrop(from, dir, allPaths, rootPaths)
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
  aria-label={t.files()}
  class="flex h-full min-h-0 flex-col"
  ondragleave={treeLeave}
>
  <!-- The toolbar stays put: the TREE scrolls, not the nav (P3). -->
  <div class="flex shrink-0 items-center gap-0.5 border-b border-base-300 bg-base-100 px-2 py-1">
    <h2 class="mr-auto pl-1 text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.files()}</h2>
    <IconButton
      label={targetDir ? t.new_note_in({ dir: targetDir }) : t.new_note()}
      icon={FilePlus}
      testid="new-file"
      onclick={() => onOp({ type: 'new-file', dir: targetDir })}
    />
    <IconButton
      label={targetDir ? t.new_folder_in({ dir: targetDir }) : t.new_folder()}
      icon={FolderPlus}
      testid="new-folder"
      onclick={() => onOp({ type: 'new-folder', dir: targetDir })}
    />
    <IconButton
      label={t.collapse_all()}
      icon={ChevronsDownUp}
      testid="collapse-all"
      onclick={collapseAll}
    />
    <DropdownMenu placement="bottom-end" testid="tree-filter-menu">
      {#snippet trigger(attrs)}
        <button
          use:melt={attrs}
          data-testid="tree-filter"
          class="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary
            {filter !== 'all' ? 'bg-base-200 text-base-content' : ''}"
        >
          <ListFilter size={14} aria-hidden="true" />
          <span class="sr-only">{t.filter_label()}</span>
          <span>{t.filter[filter]()}</span>
        </button>
      {/snippet}
      {#snippet children({ item })}
        {#each FILTER_VALUES as value (value)}
          <MenuItem
            {item}
            checked={filter === value}
            testid="tree-filter:{value}"
            onSelect={() => (filter = value)}
          >
            {t.filter_option[value]()}
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
            class="pointer-events-none absolute top-7 bottom-0 w-0.5 {mountTone(
              mount.provenance,
              mount.foreign
            ) === 'yours'
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
          ondragstart={(e) => dragStart(e, node.path, false)}
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
            {@const tone = mountTone(mount.provenance, mount.foreign)}
            {@const state = mount.status ?? 'active'}
            {@const online = (presenceByRoom[mount.room] ?? []).length}
            {@const whose = tone === 'yours' ? t.shared_by_you() : t.shared_with_you()}
            <span class="ml-auto flex shrink-0 items-center gap-1.5">
              {#if state === 'active'}
                <SyncPill
                  status={rollups.get(node.path) ?? 'offline'}
                  testid="sync-pill:{node.path}"
                />
                <span
                  data-testid="mount-badge:{node.path}"
                  data-state="active"
                  title={online ? t.online_title({ whose, count: online }) : whose}
                  class="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium
                    {tone === 'yours'
                    ? 'bg-primary text-primary-content'
                    : 'bg-secondary text-secondary-content'}"
                >
                  <Users size={12} aria-hidden="true" />
                  {#if online}<span aria-hidden="true">{online}</span>{/if}
                  <span class="sr-only">{online ? t.online_sr({ whose, count: online }) : whose}</span>
                </span>
              {:else if state === 'needs-token'}
                <!-- No pill, by design: this mount has no relay to be in sync
                     with, so it is not offline — this device has no key for it
                     (spike S10 Q2). Provenance-tinted like the badge it
                     replaces, with its own icon so the two never read alike. -->
                <span
                  data-testid="mount-badge:{node.path}"
                  data-state="needs-token"
                  title={m.link_needed_title()}
                  class="inline-flex items-center gap-0.5 rounded border border-dashed px-1 py-0.5 text-[10px] font-medium text-base-content
                    {tone === 'yours' ? 'border-primary bg-primary/10' : 'border-secondary bg-secondary/10'}"
                >
                  <KeyRound size={12} aria-hidden="true" />
                  <span aria-hidden="true">{m.link_needed()}</span>
                  <span class="sr-only">{m.link_needed_sr()}</span>
                </span>
              {:else}
                <!-- Transient, and quiet with it: the adopt/absorb machines
                     finish on their own and there is nothing to act on. -->
                <span
                  data-testid="mount-badge:{node.path}"
                  data-state={state}
                  title={state === 'adopting' ? m.attaching_title() : m.folding_back_title()}
                  class="inline-flex items-center gap-0.5 rounded border border-base-300 px-1 py-0.5 text-[10px] text-base-content/70 italic"
                >
                  {state === 'adopting' ? m.attaching() : m.folding_back()}
                </span>
              {/if}
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
          onclick={(e) => clickFile(node.path, e)}
          oncontextmenu={(e) => openMenu(e, target)}
          onkeydown={(e) => rowKey(e, target)}
          ondragstart={(e) => dragStart(e, node.path, true)}
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
          ondragstart={(e) => dragStart(e, node.path, false)}
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
            {t.not_synced()}
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
    aria-label={t.root_label()}
    data-testid="tree-root"
    oncontextmenu={(e) => openMenu(e, { kind: 'root' })}
    ondragover={(e) => dragOver(e, '')}
    ondrop={(e) => drop(e, '')}
    class="min-h-0 flex-1 overflow-y-auto py-1 {dropDir === ''
      ? 'inset-ring-2 inset-ring-primary'
      : ''}"
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
