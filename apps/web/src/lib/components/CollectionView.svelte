<script lang="ts">
  /**
   * A collection opened as a tab (bases-shaping A3, DB2): a `.base` file's
   * saved views over the notes the index holds, drawn as a table with typed
   * cell editors. The file is the truth for the views (filters, columns,
   * sort, grouping), the notes are the truth for every cell, and the index
   * answers the query; nothing here is a store.
   *
   * Every write goes through the file's own patcher (a view's node and
   * nothing else, `patchView`) or the note's own patcher (one value's bytes,
   * `applyFrontmatterOp`), on the LIVE doc — so a peer's table and a peer's
   * open note change at once, and the sync indicator is the file's own.
   *
   * Reactivity: the index is a plain structure; `indexRevision()` is its
   * whole subscription. The file's text is re-read on that counter too
   * (the `.base` is a text doc the sink feeds), so Source-mode edits and a
   * peer's edits reach the table without a second channel. The counter
   * bumps on every keystroke anywhere in the vault, so the re-query is
   * coalesced on the shell's clock; the first load is immediate.
   */
  import { Plus, Columns3, Group, ArrowUp, ArrowDown, TriangleAlert, LayoutGrid } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import {
    addView,
    collectionName,
    compileView,
    folderOf,
    parseCollection,
    patchView,
    type Column,
    type NewView,
    type ViewPatch,
  } from '@ohhi/collections'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { keyValue, type PropValue, type Row } from '@ohhi/index'
  import {
    applyFrontmatterOp,
    cellText,
    columnKind,
    groupRows,
    kindOf,
    newRowText,
    opFor,
    replaceDocText,
    toggleSort,
    type CellKind,
  } from '../collection-cells.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import Popover from '../ui/Popover.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import Tabs from '../ui/Tabs.svelte'
  import { getViewShell, shellClock } from '../views.js'
  import type { Workspace } from '../workspace.svelte.js'
  import CollectionBoard from './CollectionBoard.svelte'
  import CollectionCell from './CollectionCell.svelte'
  import CollectionList from './CollectionList.svelte'

  interface Props {
    workspace: Workspace
    /** The `.base` file. The pane keys this component on it. */
    path: string
  }

  let { workspace, path }: Props = $props()

  const shell = getViewShell()
  const clock = shellClock()
  const t = $derived($LL.web.collections)
  const uid = $props.id()
  /** The reader's zone, so `today()` is their calendar day. A zone is not a clock. clock-exempt */
  const tzOffsetMinutes = -new Date().getTimezoneOffset() // clock-exempt
  /** How long typing elsewhere may go on before the table re-asks the index. */
  const COALESCE_MS = 120

  const name = $derived(collectionName(path))
  const revision = $derived(shell?.indexRevision() ?? 0)
  /** Bumped after this tab's own writes to the file, so they show at once rather than after the sink's round trip. */
  let selfRevision = $state(0)
  /** The file's live text — re-read on every index change (the file is a doc the sink feeds). */
  const text = $derived.by(() => {
    void revision
    void selfRevision
    return workspace.docForPath(path)?.getText() ?? ''
  })
  const spec = $derived(parseCollection(text))

  /** Which saved view this tab shows, as the Tabs primitive's value. */
  let activeValue = $state('0')
  const view = $derived.by(() => {
    if (!spec.views.length) return null
    const wanted = Number(activeValue)
    return spec.views.find((v) => v.index === wanted) ?? spec.views[0]
  })
  const compiled = $derived(view ? compileView(spec, view, { thisPath: path }) : null)
  const viewTabs = $derived(spec.views.map((v) => ({ value: String(v.index), label: v.name, testid: `collection-tab:${v.name}` })))

  // ---- the rows ----
  let rows = $state.raw<Row[]>([])
  let total = $state(0)
  /** The query the rows on screen answer; a different one is asked at once. */
  let shown: unknown = null
  $effect(() => {
    const q = compiled
    void revision
    if (!q || !shell) {
      rows = []
      total = 0
      shown = null
      return
    }
    let live = true
    const run = (): void => {
      void shell
        .index()
        .rows({ ...q.query, now: clock.now(), tzOffsetMinutes }, { limit: q.limit ?? 1000 })
        .then((page) => {
          if (!live) return
          rows = page.items
          total = page.total ?? page.items.length
        })
    }
    // A new query (first load, another view, a sort written) is answered
    // at once; the same query on a changed vault is coalesced, so typing in
    // a note next door does not re-run it per keystroke.
    if (q !== shown) {
      shown = q
      run()
      return () => {
        live = false
      }
    }
    const cancel = clock.schedule(run, COALESCE_MS)
    return () => {
      live = false
      cancel()
    }
  })

  const columns = $derived<Column[]>(compiled?.columns ?? [])
  /** The name is the row's own column, drawn first and never edited here. */
  const nameColumn = $derived(columns.find((c) => c.id === 'file.name' || c.id === 'file.basename') ?? null)
  const dataColumns = $derived(columns.filter((c) => c !== nameColumn))
  const groups = $derived(groupRows(rows, compiled?.groupBy ?? null))
  const sortOf = (id: string): 'asc' | 'desc' | null => view?.sort.find((s) => s.property === id)?.direction ?? null
  const ariaSort = (id: string): 'ascending' | 'descending' | undefined =>
    sortOf(id) === 'asc' ? 'ascending' : sortOf(id) === 'desc' ? 'descending' : undefined

  /**
   * Per property column, computed ONCE per row set: the editor kind most of
   * the column has (for its empty cells) and the values it holds (a text
   * cell's suggestions).
   */
  const columnInfo = $derived.by(() => {
    const out = new Map<string, { kind: CellKind; options: string[] }>()
    for (const col of dataColumns) {
      if (!col.key || !('prop' in col.key)) continue
      const prop = col.key.prop
      const values = rows.map((r) => r.props[prop])
      const seen = new Set<string>()
      for (const v of values) {
        if (!v) continue
        for (const item of v.kind === 'list' ? v.items : [v]) if (item.kind === 'string' && item.value) seen.add(item.value)
      }
      out.set(col.id, { kind: columnKind(undefined, values), options: [...seen].sort() })
    }
    return out
  })
  const kindFor = (col: Column, value: PropValue | undefined): CellKind => kindOf(value) ?? columnInfo.get(col.id)?.kind ?? 'text'

  // ---- writes ----
  function writeView(patch: ViewPatch): void {
    const doc = workspace.docForPath(path)
    if (!doc || !view) return
    const result = patchView(doc.getText(), view.index, patch)
    if (result.ok) {
      replaceDocText(doc, result.text)
      selfRevision++
    }
  }

  function onSort(col: Column): void {
    if (!view || !col.key) return
    writeView({ sort: toggleSort(view.sort, col.id) })
  }

  function onGroup(id: string): void {
    writeView({ groupBy: id ? { property: id, direction: 'asc' } : null })
  }

  function toggleColumn(id: string, on: boolean): void {
    if (!view) return
    const order = on ? [...view.order, id] : view.order.filter((o) => o !== id)
    writeView({ order })
  }

  /** A cell's edit, through the note's live doc. True when the note took it. */
  function onCell(row: Row, col: Column, raw: string | boolean): boolean {
    if (!col.key || !('prop' in col.key)) return false
    const doc = workspace.docForPath(row.path)
    if (!doc) {
      workspace.flash({ level: 'warn', text: t.not_a_note({ path: row.path }), path: row.path })
      return false
    }
    const result = applyFrontmatterOp(doc, opFor(col.key.prop, kindFor(col, row.props[col.key.prop]), raw))
    if (!result.ok) {
      const reasons = t.reason as unknown as Record<string, () => string>
      const reason = (reasons[result.reason] ?? reasons.unsupported)()
      workspace.flash({ level: 'warn', text: t.not_patched({ name: row.name, reason }), path: row.path })
      return false
    }
    return true
  }

  /** Where "+ New" puts a note: the view's folder, else the collection's own. */
  const targetDir = $derived.by(() => {
    const scope = { thisPath: path }
    const fromView = view ? folderOf(view.filters, scope) : null
    const fromGlobal = folderOf(spec.filters, scope)
    const slash = path.lastIndexOf('/')
    return fromView ?? fromGlobal ?? (slash === -1 ? '' : path.slice(0, slash))
  })

  async function newRow(): Promise<void> {
    const keys = dataColumns.flatMap((c) => (c.key && 'prop' in c.key ? [c.key.prop] : []))
    const created = await workspace.createFile(targetDir, undefined, newRowText(keys))
    if (created) shell?.openPath(created)
  }

  /** The property a new board groups by: the current view's first property column, else the first key the vault has. */
  function firstProperty(): string | null {
    const fromView = dataColumns.find((c) => c.key && 'prop' in c.key)
    if (fromView) return fromView.id
    return knownKeys[0] ?? null
  }

  function addNewView(type: 'table' | 'kanban' | 'list'): void {
    const doc = workspace.docForPath(path)
    if (!doc) return
    const names = { table: t.view_name_table(), kanban: t.view_name_board(), list: t.view_name_list() }
    const taken = new Set(spec.views.map((v) => v.name))
    let name: string = names[type]
    for (let n = 2; taken.has(name); n++) name = `${names[type]} ${n}`
    const order = view ? view.order : ['file.name']
    const groupBy = type === 'kanban' ? firstProperty() : null
    const next: NewView = { type, name, order, ...(groupBy ? { groupBy: { property: groupBy, direction: 'asc' } } : {}) }
    // The new view's index, read before the file changes under the derived chain.
    const index = spec.views.length
    const result = addView(doc.getText(), next)
    if (result.ok) {
      replaceDocText(doc, result.text)
      selfRevision++
      activeValue = String(index)
    }
  }

  /** A board's drag or its "Move to…": the grouping property set to the column's value. */
  function onMove(row: Row, group: string): void {
    const by = compiled?.groupBy
    if (!by || !('prop' in by.key)) return
    // The grouping property need not be one of the view's columns.
    onCell(row, columns.find((c) => c.id === by.id) ?? { id: by.id, label: by.id, key: by.key }, group)
  }

  // ---- the columns popover, and the "partly shown" detail ----
  let columnsAnchor = $state<HTMLElement | null>(null)
  let columnsOpen = $state(false)
  let partlyOpen = $state(false)
  let knownKeys = $state.raw<string[]>([])
  const boardNeedsGroup = $derived(view?.type === 'kanban' && !compiled?.groupBy)
  $effect(() => {
    if ((!columnsOpen && !boardNeedsGroup) || !shell) return
    let live = true
    void shell
      .index()
      .frontmatterKeys({ limit: 200 })
      .then((page) => {
        if (live) knownKeys = page.items.map((k) => k.tag)
      })
    return () => {
      live = false
    }
  })
  const columnChoices = $derived.by(() => {
    const ids = new Set<string>(['file.name', 'file.folder', 'file.mtime', 'file.tags'])
    for (const k of knownKeys) ids.add(k)
    for (const o of view?.order ?? []) ids.add(o)
    return [...ids]
  })

  /** A file field or an uncomputed column, as text. */
  function plainCell(col: Column, value: PropValue | undefined): string {
    if (!col.key) return t.mtime_unknown()
    if (col.id === 'file.mtime') return value && value.kind === 'date' ? new Date(value.ms).toLocaleDateString() : t.mtime_unknown()
    return cellText(value)
  }

  const headerButton =
    'flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px] font-semibold tracking-wide text-base-content/70 uppercase hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'
  const headerText = 'block w-full truncate px-1.5 py-1 text-left text-[11px] font-semibold tracking-wide text-base-content/70 uppercase'
  const cellClass = 'border-b border-base-200 px-1 py-0.5 align-top'
</script>

<section aria-label={t.label({ name })} data-testid="collection-view" class="flex h-full min-h-0 flex-col bg-ed-surface text-base-content">
  {#if spec.error}
    <div class="m-4 rounded border border-warning/40 bg-base-100 p-3 text-sm" role="alert">
      <p>{t.unreadable({ error: spec.error })}</p>
      <p class="mt-1 text-xs text-base-content/70">{t.unreadable_hint()}</p>
    </div>
  {:else if !view}
    <div class="m-4 text-sm">
      <p>{t.no_views()}</p>
      <button type="button" class="{OUTLINE_BUTTON} mt-2 px-2 py-1 text-xs" data-testid="collection-add-table" onclick={() => addNewView('table')}>
        {t.add_table()}
      </button>
    </div>
  {:else}
    <!-- The saved views as a tab list (one tab stop, arrows move), the verbs at the row's end. -->
    <Tabs tabs={viewTabs} bind:value={activeValue} size="sm" label={t.views({ name })} testid="collection-views">
      {#snippet end()}
        <span class="px-1 text-xs text-base-content/70 whitespace-nowrap" data-testid="collection-count">
          {compiled && compiled.limit !== null && total > rows.length ? t.count_of({ shown: rows.length, total }) : t.count({ count: rows.length })}
        </span>
        {#if compiled && !compiled.supported}
          <button
            type="button"
            class="flex items-center gap-1 rounded bg-warning/20 px-1.5 py-0.5 text-[11px] text-base-content focus-visible:outline-2 focus-visible:outline-primary"
            aria-expanded={partlyOpen}
            aria-controls="{uid}-partly"
            data-testid="collection-partly"
            onclick={() => (partlyOpen = !partlyOpen)}
          >
            <TriangleAlert aria-hidden="true" class="size-3" />
            {t.partly()}
          </button>
        {/if}
        <label class="flex items-center gap-1 text-xs text-base-content/70">
          <Group aria-hidden="true" class="size-3.5" />
          <span class="sr-only">{t.group_by()}</span>
          <select
            class="dui-select dui-select-xs max-w-32"
            data-testid="collection-group"
            value={compiled?.groupBy?.id ?? ''}
            onchange={(e) => onGroup((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">{t.group_none()}</option>
            {#each columns as col (col.id)}
              {#if col.key}
                <option value={col.id}>{col.label}</option>
              {/if}
            {/each}
          </select>
        </label>
        <DropdownMenu placement="bottom-end" testid="collection-add-view-menu">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              aria-label={t.add_view()}
              data-testid="collection-add-view"
              class="rounded p-1 text-base-content/70 hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
            >
              <LayoutGrid size={14} aria-hidden="true" />
            </button>
          {/snippet}
          {#snippet children(attrs)}
            <MenuItem item={attrs.item} testid="collection-add-view:table" onSelect={() => addNewView('table')}>{t.add_view_table()}</MenuItem>
            <MenuItem item={attrs.item} testid="collection-add-view:kanban" onSelect={() => addNewView('kanban')}>{t.add_view_board()}</MenuItem>
            <MenuItem item={attrs.item} testid="collection-add-view:list" onSelect={() => addNewView('list')}>{t.add_view_list()}</MenuItem>
          {/snippet}
        </DropdownMenu>
        {#if view.type === 'table'}
          <span bind:this={columnsAnchor}>
            <IconButton label={t.columns()} icon={Columns3} testid="collection-columns" onclick={() => (columnsOpen = !columnsOpen)} />
          </span>
        {/if}
        <button
          type="button"
          class="{OUTLINE_BUTTON} flex items-center gap-1 px-2 py-0.5 text-xs"
          data-testid="collection-new"
          aria-label={targetDir ? t.new_row_in({ dir: targetDir }) : t.new_row()}
          onclick={newRow}
        >
          <Plus aria-hidden="true" class="size-3.5" />
          {t.new_row()}
        </button>
      {/snippet}

      {#snippet panel()}
        {#if compiled && !compiled.supported && partlyOpen}
          <p id="{uid}-partly" class="border-b border-base-300 bg-warning/10 px-3 py-1 text-xs" data-testid="collection-partly-detail">
            {t.partly_detail({ reasons: compiled.reasons.join('; ') })}
          </p>
        {/if}
        {#if boardNeedsGroup}
          <div class="m-4 text-sm" data-testid="board-needs-group">
            <label class="flex items-center gap-2">
              <span>{t.board_needs_group()}</span>
              <select class="dui-select dui-select-xs" data-testid="board-group-pick" value="" onchange={(e) => onGroup((e.currentTarget as HTMLSelectElement).value)}>
                <option value="">—</option>
                {#each [...new Set([...columns.filter((c) => c.key && 'prop' in c.key).map((c) => c.id), ...knownKeys])] as id (id)}
                  <option value={id}>{id}</option>
                {/each}
              </select>
            </label>
          </div>
        {:else if rows.length === 0}
          <p class="m-4 text-sm text-base-content/70" data-testid="collection-empty">{t.no_rows()}</p>
        {:else if view.type === 'kanban'}
          <CollectionBoard {groups} {columns} groupId={compiled?.groupBy?.id ?? ''} viewName={view.name} onOpen={(p, o) => shell?.openPath(p, o)} {onMove} />
        {:else if view.type === 'list' || view.type === 'cards'}
          <CollectionList {groups} {columns} cards={view.type === 'cards'} grouped={!!compiled?.groupBy} viewName={view.name} onOpen={(p, o) => shell?.openPath(p, o)} />
        {:else}
        <div class="h-full min-h-0 overflow-auto">
            <table class="w-full border-collapse text-xs" data-testid="collection-table">
              <caption class="sr-only">{t.table_caption({ view: view.name, count: rows.length })}</caption>
              <thead class="sticky top-0 z-[1] bg-base-100">
                <tr>
                  <th scope="col" class="border-b border-base-300 px-1 py-0.5 text-left" aria-sort={ariaSort('file.name')}>
                    <button
                      type="button"
                      class={headerButton}
                      data-testid="collection-header:file.name"
                      title={t.sort_by({ name: nameColumn?.label ?? t.name_column() })}
                      onclick={() => onSort(nameColumn ?? { id: 'file.name', label: t.name_column(), key: { file: 'name' } })}
                    >
                      <span class="truncate">{nameColumn?.label ?? t.name_column()}</span>
                      {#if sortOf('file.name') === 'asc'}<ArrowUp aria-hidden="true" class="size-3" />{:else if sortOf('file.name') === 'desc'}<ArrowDown aria-hidden="true" class="size-3" />{/if}
                    </button>
                  </th>
                  {#each dataColumns as col (col.id)}
                    <th
                      scope="col"
                      class="border-b border-base-300 px-1 py-0.5 text-left"
                      style={view.columnSize[col.id] ? `width:${view.columnSize[col.id]}px` : undefined}
                      aria-sort={col.key ? ariaSort(col.id) : undefined}
                    >
                      {#if col.key}
                        <button type="button" class={headerButton} data-testid="collection-header:{col.id}" title={t.sort_by({ name: col.label })} onclick={() => onSort(col)}>
                          <span class="truncate">{col.label}</span>
                          {#if sortOf(col.id) === 'asc'}<ArrowUp aria-hidden="true" class="size-3" />{:else if sortOf(col.id) === 'desc'}<ArrowDown aria-hidden="true" class="size-3" />{/if}
                        </button>
                      {:else}
                        <!-- A column the file names that this app cannot compute: labelled, not clickable. -->
                        <span class={headerText} data-testid="collection-header:{col.id}">
                          {col.label}
                          <span class="sr-only">{t.column_not_computed({ name: col.id })}</span>
                        </span>
                      {/if}
                    </th>
                  {/each}
                </tr>
              </thead>
              {#each groups as group (group.key)}
                <tbody data-testid="collection-group:{group.key || '(none)'}">
                  {#if compiled?.groupBy}
                    <tr>
                      <th scope="rowgroup" colspan={dataColumns.length + 1} class="border-b border-base-200 bg-base-200/60 px-2 py-1 text-left text-[11px] font-semibold">
                        {group.key || t.group_empty()}
                        <span class="ml-1 font-normal text-base-content/70">{t.count({ count: group.rows.length })}</span>
                      </th>
                    </tr>
                  {/if}
                  {#each group.rows as row (row.guid)}
                    <tr class="odd:bg-base-100 even:bg-base-200/30">
                      <th scope="row" class="{cellClass} font-normal">
                        <button
                          type="button"
                          class="block w-full truncate rounded px-1.5 py-0.5 text-left text-xs font-medium text-base-content hover:underline focus-visible:outline-2 focus-visible:outline-primary"
                          aria-label={t.open_note({ name: row.name })}
                          data-testid="collection-row:{row.path}"
                          onclick={(e) => shell?.openPath(row.path, { background: e.metaKey || e.ctrlKey })}
                        >
                          {row.name}
                        </button>
                      </th>
                      {#each dataColumns as col (col.id)}
                        {@const value = col.key ? (keyValue(row, col.key) as PropValue | undefined) : undefined}
                        <td class={cellClass}>
                          {#if col.key && 'prop' in col.key}
                            <CollectionCell
                              {value}
                              kind={kindFor(col, value)}
                              column={col.label}
                              row={row.name}
                              options={columnInfo.get(col.id)?.options ?? []}
                              testid="collection-cell:{row.name}:{col.id}"
                              onCommit={(raw) => onCell(row, col, raw)}
                            />
                          {:else}
                            <span class="block truncate px-1.5 py-0.5 text-base-content/70" data-testid="collection-cell:{row.name}:{col.id}">
                              {plainCell(col, value)}
                            </span>
                          {/if}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              {/each}
            </table>
        </div>
        {/if}
      {/snippet}
    </Tabs>

    {#if columnsOpen}
      <Popover anchor={columnsAnchor} title={t.columns_title({ view: view.name })} testid="collection-columns-popover" onClose={() => (columnsOpen = false)}>
        <div class="flex max-h-72 flex-col gap-1 overflow-y-auto p-2 text-xs">
          {#each columnChoices as id (id)}
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                class="dui-checkbox dui-checkbox-xs"
                checked={view.order.includes(id)}
                data-testid="collection-column:{id}"
                onchange={(e) => toggleColumn(id, (e.currentTarget as HTMLInputElement).checked)}
              />
              <span class="sr-only">{t.column_label({ name: id })}</span>
              <span aria-hidden="true">{id}</span>
            </label>
          {/each}
        </div>
      </Popover>
    {/if}
  {/if}
</section>
