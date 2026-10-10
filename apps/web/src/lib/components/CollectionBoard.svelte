<script lang="ts">
  /**
   * A collection's board view (bases-shaping DB3, Fork 5): one column per
   * value of the grouping property, a card per note. Dragging a card to
   * another column is ONE frontmatter edit — the grouping property set to
   * that column's value — and so is the keyboard's way: a "Move to…" select
   * on every card, because a drag with no keyboard equivalent is a view
   * some people cannot use. A board grouped by a file field (its folder,
   * its tags) has nothing a property write could move: the select says so
   * and the cards do not drag.
   *
   * The drag carries the note's path under this app's own MIME type (and
   * `text/plain` for the OS), the way the file navigator's rows do. A move
   * the note refuses (`onMove` false) puts the select back where it was.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Column } from '@ohhi/collections'
  import { keyValue, type PropValue, type Row } from '@ohhi/index'
  import { displayCell, type RowGroup } from '../collection-cells.js'

  interface Props {
    /** The groups in column order; `key: ''` is the column for notes with no value. */
    groups: RowGroup[]
    /** The view's columns, the grouping one included (it is not drawn on a card). */
    columns: Column[]
    groupId: string
    /** False when the grouping is a file field: no property to write, so no move. */
    movable: boolean
    viewName: string
    onOpen: (path: string, opts?: { background?: boolean }) => void
    /** Move a note to a group. True when the note took it. */
    onMove: (row: Row, group: RowGroup) => boolean
  }

  let { groups, columns, groupId, movable, viewName, onOpen, onMove }: Props = $props()

  const t = $derived($LL.web.collections)
  const MIME = 'application/x-ohhi-row'
  const shown = $derived(columns.filter((c) => c.id !== groupId && c.id !== 'file.name' && c.id !== 'file.basename'))
  const allRows = $derived(groups.flatMap((g) => g.rows))
  /** The card being dragged, for browsers whose drop event hides the payload until drop. */
  let dragging = $state<string | null>(null)
  let over = $state<string | null>(null)

  function onDragStart(e: DragEvent, row: Row): void {
    if (!movable) {
      e.preventDefault()
      return
    }
    dragging = row.path
    e.dataTransfer?.setData(MIME, row.path)
    e.dataTransfer?.setData('text/plain', row.path)
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(e: DragEvent, group: string): void {
    if (!movable) return
    if (!dragging && !e.dataTransfer?.types.includes(MIME)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    over = group
  }

  /** Leaving the column, not moving between its own children. */
  function onDragLeave(e: DragEvent): void {
    const to = e.relatedTarget
    if (to instanceof Node && (e.currentTarget as HTMLElement).contains(to)) return
    over = null
  }

  function onDrop(e: DragEvent, group: RowGroup): void {
    e.preventDefault()
    const path = e.dataTransfer?.getData(MIME) || dragging
    over = null
    dragging = null
    if (!path || !movable) return
    const row = allRows.find((r) => r.path === path)
    if (row) onMove(row, group)
  }

  function onSelect(e: Event, row: Row, from: RowGroup): void {
    const select = e.currentTarget as HTMLSelectElement
    const target = groups.find((g) => g.key === select.value)
    if (!target || target === from) return
    // A refused move: the note did not change, so neither does the select.
    if (!onMove(row, target)) select.value = from.key
  }

  const valueOf = (row: Row, col: Column): string => (col.key ? displayCell(col.id, keyValue(row, col.key) as PropValue | undefined, t.mtime_unknown()) : '')
</script>

<div class="flex h-full min-h-0 gap-2 overflow-x-auto p-2" role="group" aria-label={t.board_label({ view: viewName })} data-testid="collection-board">
  {#each groups as group (group.key)}
    <div
      role="group"
      aria-label={t.board_column({ group: group.key || t.group_empty(), count: group.rows.length })}
      data-testid="board-column:{group.key || '(none)'}"
      class="flex w-56 shrink-0 flex-col rounded border bg-base-100 {over === group.key ? 'border-primary' : 'border-base-300'}"
      ondragover={(e) => onDragOver(e, group.key)}
      ondragleave={onDragLeave}
      ondrop={(e) => onDrop(e, group)}
    >
      <h3 class="flex items-baseline gap-1 border-b border-base-300 px-2 py-1 text-[11px] font-semibold tracking-wide text-base-content/70 uppercase">
        <span class="truncate">{group.key || t.group_empty()}</span>
        <span class="font-normal">{group.rows.length}</span>
      </h3>
      <ul class="flex min-h-8 flex-1 flex-col gap-1 overflow-y-auto p-1">
        {#each group.rows as row (row.guid)}
          <li
            draggable={movable}
            data-testid="board-card:{row.path}"
            class="rounded border border-base-300 bg-base-100 p-1.5 text-xs shadow-xs {dragging === row.path ? 'opacity-50' : ''}"
            ondragstart={(e) => onDragStart(e, row)}
            ondragend={() => {
              dragging = null
              over = null
            }}
          >
            <button
              type="button"
              class="block w-full truncate rounded text-left font-medium text-base-content hover:underline focus-visible:outline-2 focus-visible:outline-primary"
              aria-label={t.open_note({ name: row.name })}
              onclick={(e) => onOpen(row.path, { background: e.metaKey || e.ctrlKey })}
            >
              {row.name}
            </button>
            {#each shown as col (col.id)}
              {@const value = valueOf(row, col)}
              {#if value}
                <p class="truncate text-base-content/70"><span class="text-base-content/70">{col.label}:</span> {value}</p>
              {/if}
            {/each}
            <label class="mt-1 block">
              <span class="sr-only">{movable ? t.move_card({ name: row.name }) : t.not_movable({ group: groupId })}</span>
              <select
                class="dui-select dui-select-xs w-full"
                data-testid="board-move:{row.path}"
                value={group.key}
                disabled={!movable}
                title={movable ? undefined : t.not_movable({ group: groupId })}
                onchange={(e) => onSelect(e, row, group)}
              >
                {#each groups as target (target.key)}
                  <option value={target.key}>{target.key || t.group_empty()}</option>
                {/each}
              </select>
            </label>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</div>
