<script lang="ts">
  /**
   * A collection's list and cards views (bases-shaping DB3, Fork 5): one
   * entry per note, its name first and the view's columns as "label: value"
   * under it. Cards are the same entries on a grid. Read-mostly: a value is
   * edited in the table or in the note.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Column } from '@ohhi/collections'
  import { keyValue, type PropValue, type Row } from '@ohhi/index'
  import { displayCell, type RowGroup } from '../collection-cells.js'

  interface Props {
    groups: RowGroup[]
    columns: Column[]
    cards: boolean
    grouped: boolean
    viewName: string
    onOpen: (path: string, opts?: { background?: boolean }) => void
  }

  let { groups, columns, cards, grouped, viewName, onOpen }: Props = $props()

  const t = $derived($LL.web.collections)
  const shown = $derived(columns.filter((c) => c.id !== 'file.name' && c.id !== 'file.basename'))
  const valueOf = (row: Row, col: Column): string => (col.key ? displayCell(col.id, keyValue(row, col.key) as PropValue | undefined, t.mtime_unknown()) : '')
</script>

<div class="h-full min-h-0 overflow-auto p-2" data-testid="collection-{cards ? 'cards' : 'list'}">
  {#each groups as group (group.key)}
    {#if grouped}
      <h3 class="mt-2 mb-1 px-1 text-[11px] font-semibold tracking-wide text-base-content/70 uppercase first:mt-0">
        {group.key || t.group_empty()} <span class="font-normal">{t.count({ count: group.rows.length })}</span>
      </h3>
    {/if}
    <ul
      aria-label={cards ? t.cards_label({ view: viewName }) : t.list_label({ view: viewName })}
      class={cards ? 'grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-2' : 'flex flex-col'}
    >
      {#each group.rows as row (row.guid)}
        <li
          data-testid="list-row:{row.path}"
          class={cards ? 'rounded border border-base-300 bg-base-100 p-2 text-xs' : 'border-b border-base-200 px-1 py-1 text-xs'}
        >
          <button
            type="button"
            class="block w-full truncate rounded text-left font-medium text-base-content hover:underline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={t.open_note({ name: row.name })}
            onclick={(e) => onOpen(row.path, { background: e.metaKey || e.ctrlKey })}
          >
            {row.name}
          </button>
          {#if shown.length}
            <dl class={cards ? 'mt-1 flex flex-col gap-0.5' : 'flex flex-wrap gap-x-3'}>
              {#each shown as col (col.id)}
                {@const value = valueOf(row, col)}
                {#if value}
                  <div class="flex min-w-0 gap-1 text-base-content/70">
                    <dt class="shrink-0">{col.label}:</dt>
                    <dd class="truncate">{value}</dd>
                  </div>
                {/if}
              {/each}
            </dl>
          {/if}
        </li>
      {/each}
    </ul>
  {/each}
</div>
