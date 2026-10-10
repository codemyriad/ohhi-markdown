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
   * peer's edits reach the table without a second channel.
   */
  import { Plus, Columns3, Group, ArrowUp, ArrowDown, TriangleAlert } from '@lucide/svelte'
  import {
    addView,
    collectionName,
    compileView,
    folderOf,
    parseCollection,
    patchView,
    type Column,
    type ViewPatch,
  } from '@ohhi/collections'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { keyValue, type PropValue, type Row } from '@ohhi/index'
  import { untrack } from 'svelte'
  import {
    applyFrontmatterOp,
    columnKind,
    groupRows,
    newRowText,
    opFor,
    replaceDocText,
    toggleSort,
  } from '../collection-cells.js'
  import type { Tab } from '../panes.js'
  import IconButton from '../ui/IconButton.svelte'
  import Popover from '../ui/Popover.svelte'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import { getViewShell, shellClock } from '../views.js'
  import type { Workspace } from '../workspace.svelte.js'
  import CollectionCell from './CollectionCell.svelte'

  interface Props {
    workspace: Workspace
    /** The `.base` file. */
    path: string
    tab: Tab
  }

  let { workspace, path }: Props = $props()

  const shell = getViewShell()
  const clock = shellClock()
  const t = $derived($LL.web.collections)
  const uid = $props.id()

  const name = $derived(collectionName(path))
  const revision = $derived(shell?.indexRevision() ?? 0)
  /** The file's live text — re-read on every index change (the file is a doc the sink feeds). */
  const text = $derived.by(() => {
    void revision
    return workspace.docForPath(path)?.getText() ?? ''
  })
  const spec = $derived(parseCollection(text))

  /** Which saved view this tab shows; back to the first when the file changes. */
  let active = $state(0)
  $effect(() => {
    void path
    untrack(() => (active = 0))
  })
  const view = $derived(spec.views.length ? spec.views[Math.min(active, spec.views.length - 1)] : null)
  const compiled = $derived(view ? compileView(spec, view, { thisPath: path }) : null)

  // ---- the rows ----
  let rows = $state.raw<Row[]>([])
  let total = $state(0)
  $effect(() => {
    const q = compiled
    void revision
    if (!q || !shell) {
      rows = []
      total = 0
      return
    }
    let live = true
    void shell
      .index()
      .rows({ ...q.query, now: clock.now() }, { limit: q.limit ?? 1000 })
      .then((page) => {
        if (!live) return
        rows = page.items
        total = page.total ?? page.items.length
      })
    return () => {
      live = false
    }
  })

  const columns = $derived<Column[]>(compiled?.columns ?? [])
  /** The name is the row's own column, drawn first and never edited here. */
  const nameColumn = $derived(columns.find((c) => c.id === 'file.name' || c.id === 'file.basename') ?? null)
  const dataColumns = $derived(columns.filter((c) => c !== nameColumn))
  const groups = $derived(groupRows(rows, compiled?.groupBy ?? null))
  const sortOf = (id: string): 'asc' | 'desc' | null => view?.sort.find((s) => s.property === id)?.direction ?? null

  /** The values a property holds across the rows shown: a text cell's suggestions. */
  const optionsFor = $derived.by(() => {
    const out = new Map<string, string[]>()
    for (const col of dataColumns) {
      if (!col.key || !('prop' in col.key)) continue
      const seen = new Set<string>()
      for (const row of rows) {
        const v = row.props[col.key.prop]
        if (!v) continue
        for (const item of v.kind === 'list' ? v.items : [v]) {
          if (item.kind === 'string' && item.value) seen.add(item.value)
        }
      }
      out.set(col.id, [...seen].sort())
    }
    return out
  })

  // ---- writes ----
  function writeView(patch: ViewPatch): void {
    const doc = workspace.docForPath(path)
    if (!doc || !view) return
    const result = patchView(doc.getText(), view.index, patch)
    if (result.ok) replaceDocText(doc, result.text)
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

  function onCell(row: Row, col: Column, raw: string | boolean): void {
    if (!col.key || !('prop' in col.key)) return
    const doc = workspace.docForPath(row.path)
    if (!doc) {
      workspace.flash({ level: 'warn', text: t.not_a_note({ path: row.path }), path: row.path })
      return
    }
    const kind = columnKind(row.props[col.key.prop], rows.map((r) => r.props[(col.key as { prop: string }).prop]))
    const result = applyFrontmatterOp(doc, opFor(col.key.prop, kind, raw))
    if (!result.ok) {
      const reasons = t.reason as unknown as Record<string, () => string>
      const reason = (reasons[result.reason] ?? reasons.unsupported)()
      workspace.flash({ level: 'warn', text: t.not_patched({ name: row.name, reason }), path: row.path })
    }
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

  function addTable(): void {
    const doc = workspace.docForPath(path)
    if (!doc) return
    const result = addView(doc.getText(), { type: 'table', name: 'All', order: ['file.name'] })
    if (result.ok) replaceDocText(doc, result.text)
  }

  // ---- the columns popover ----
  let columnsAnchor = $state<HTMLElement | null>(null)
  let columnsOpen = $state(false)
  let knownKeys = $state.raw<string[]>([])
  $effect(() => {
    if (!columnsOpen || !shell) return
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

  const headerButton = 'flex w-full items-center gap-1 truncate rounded px-1.5 py-1 text-left text-[11px] font-semibold tracking-wide text-base-content/70 uppercase hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'
  const cellClass = 'border-b border-base-200 px-1 py-0.5 align-top'
</script>

<section
  aria-label={t.label({ name })}
  data-testid="collection-view"
  class="flex h-full min-h-0 flex-col bg-ed-surface text-base-content"
>
  {#if spec.error}
    <div class="m-4 rounded border border-warning/40 bg-base-100 p-3 text-sm" role="alert">
      <p>{t.unreadable({ error: spec.error })}</p>
      <p class="mt-1 text-xs text-base-content/70">{t.unreadable_hint()}</p>
    </div>
  {:else if !view}
    <div class="m-4 text-sm">
      <p>{t.no_views()}</p>
      <button type="button" class="{OUTLINE_BUTTON} mt-2 px-2 py-1 text-xs" data-testid="collection-add-table" onclick={addTable}>
        {t.add_table()}
      </button>
    </div>
  {:else}
    <!-- The view strip: saved views as tabs, the verbs at the end. -->
    <div class="flex shrink-0 items-center gap-1 border-b border-base-300 bg-base-100 px-2 py-1">
      <div role="tablist" aria-label={t.views({ name })} class="flex min-w-0 items-center gap-0.5 overflow-x-auto">
        {#each spec.views as v (v.index)}
          <button
            type="button"
            role="tab"
            id="{uid}-view-{v.index}"
            aria-selected={v.index === view.index}
            aria-controls="{uid}-panel"
            tabindex={v.index === view.index ? 0 : -1}
            data-testid="collection-tab:{v.name}"
            class="rounded px-2 py-0.5 text-xs whitespace-nowrap {v.index === view.index
              ? 'bg-base-200 font-semibold text-base-content'
              : 'text-base-content/70 hover:bg-base-200'}"
            onclick={() => (active = v.index)}
          >
            {v.name}
          </button>
        {/each}
      </div>
      <span class="ml-auto text-xs text-base-content/70 whitespace-nowrap" data-testid="collection-count">
        {compiled && compiled.limit !== null && total > rows.length ? t.count_of({ shown: rows.length, total }) : t.count({ count: rows.length })}
      </span>
      {#if compiled && !compiled.supported}
        <span
          class="flex items-center gap-1 rounded bg-warning/20 px-1.5 py-0.5 text-[11px] text-base-content"
          title={t.partly_detail({ reasons: compiled.reasons.join('; ') })}
          data-testid="collection-partly"
        >
          <TriangleAlert aria-hidden="true" class="size-3" />
          {t.partly()}
        </span>
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
      <span bind:this={columnsAnchor}>
        <IconButton label={t.columns()} icon={Columns3} testid="collection-columns" onclick={() => (columnsOpen = !columnsOpen)} />
      </span>
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
    </div>

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

    <div id="{uid}-panel" role="tabpanel" aria-labelledby="{uid}-view-{view.index}" class="min-h-0 flex-1 overflow-auto">
      {#if rows.length === 0}
        <p class="m-4 text-sm text-base-content/70" data-testid="collection-empty">{t.no_rows()}</p>
      {:else}
        <table class="w-full border-collapse text-xs" data-testid="collection-table">
          <caption class="sr-only">{t.table_caption({ view: view.name, count: rows.length })}</caption>
          <thead class="sticky top-0 z-[1] bg-base-100">
            <tr>
              <th scope="col" class="border-b border-base-300 px-1 py-0.5 text-left" aria-sort={sortOf('file.name') === 'asc' ? 'ascending' : sortOf('file.name') === 'desc' ? 'descending' : 'none'}>
                <button type="button" class={headerButton} data-testid="collection-header:file.name" onclick={() => onSort(nameColumn ?? { id: 'file.name', label: 'Name', key: { file: 'name' } })}>
                  <span class="truncate">{nameColumn?.label ?? 'Name'}</span>
                  {#if sortOf('file.name') === 'asc'}<ArrowUp aria-hidden="true" class="size-3" />{:else if sortOf('file.name') === 'desc'}<ArrowDown aria-hidden="true" class="size-3" />{/if}
                </button>
              </th>
              {#each dataColumns as col (col.id)}
                <th
                  scope="col"
                  class="border-b border-base-300 px-1 py-0.5 text-left"
                  style={view.columnSize[col.id] ? `width:${view.columnSize[col.id]}px` : undefined}
                  aria-sort={sortOf(col.id) === 'asc' ? 'ascending' : sortOf(col.id) === 'desc' ? 'descending' : 'none'}
                >
                  <button type="button" class={headerButton} data-testid="collection-header:{col.id}" disabled={!col.key} title={col.key ? t.sort_by({ name: col.label }) : t.partly_detail({ reasons: col.id })} onclick={() => onSort(col)}>
                    <span class="truncate">{col.label}</span>
                    {#if sortOf(col.id) === 'asc'}<ArrowUp aria-hidden="true" class="size-3" />{:else if sortOf(col.id) === 'desc'}<ArrowDown aria-hidden="true" class="size-3" />{/if}
                  </button>
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
                          kind={columnKind(value, rows.map((r) => r.props[(col.key as { prop: string }).prop]))}
                          column={col.label}
                          row={row.name}
                          options={optionsFor.get(col.id) ?? []}
                          testid="collection-cell:{row.name}:{col.id}"
                          onCommit={(raw) => onCell(row, col, raw)}
                        />
                      {:else}
                        <span class="block truncate px-1.5 py-0.5 text-base-content/70" data-testid="collection-cell:{row.name}:{col.id}">
                          {col.key ? (value && value.kind === 'date' && col.id === 'file.mtime' ? new Date(value.ms).toLocaleDateString() : value ? (value.kind === 'list' ? value.items.map((i) => ('value' in i ? String(i.value) : '')).join(', ') : 'value' in value ? String(value.value) : '') : t.mtime_unknown()) : '—'}
                        </span>
                      {/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          {/each}
        </table>
      {/if}
    </div>
  {/if}
</section>
