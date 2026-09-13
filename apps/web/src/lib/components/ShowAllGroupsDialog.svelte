<script lang="ts">
  /**
   * *Show all* (tab-groups B9, the third screenshot): every group there is —
   * the ones open in a pane, ticked, and the ones waiting in the list — with
   * how many tabs each holds and when it was last used. Clicking a row goes
   * to it: an open group unfolds and comes to the front, a saved one reopens
   * in this pane at the cursors it was closed at.
   *
   * Same rows and same order as the `▾` menu (`groups.rows()`), untrimmed.
   */
  import { Check } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { groupLabel, type GroupShell } from '../group-ui.svelte.js'
  import { formatStamp } from '../history.js'
  import Dialog from '../ui/Dialog.svelte'
  import GroupDot from './GroupDot.svelte'

  interface Props {
    paneId: string
    groups: GroupShell
    /** Injected clock (golden rule 5). */
    now: () => number
    onClose: () => void
  }

  let { paneId, groups, now, onClose }: Props = $props()

  const t = $derived($LL.web.groups.all)
  const rows = $derived(groups.rows(paneId))
</script>

<Dialog title={t.title()} description={t.description()} width="md" testid="groups-all" {onClose}>
  {#if rows.length === 0}
    <p data-testid="groups-all-empty" class="py-6 text-center text-xs text-base-content/70">
      {t.empty()}
    </p>
  {:else}
    <ul class="flex flex-col gap-0.5">
      {#each rows as row (row.id)}
        <li>
          <button
            type="button"
            data-testid="groups-all:{row.id}"
            onclick={() => {
              groups.openRow(row, paneId)
              onClose()
            }}
            class="flex w-full items-center gap-2.5 rounded px-2 py-2 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span aria-hidden="true" class="w-4 shrink-0 text-primary">
              {#if row.open}<Check size={14} />{/if}
            </span>
            {#if row.open}<span class="sr-only">{t.open_state()}</span>{/if}
            <GroupDot color={row.color} size="md" />
            <span class="min-w-0 flex-1 truncate text-sm">{groupLabel(row.name)}</span>
            <span class="shrink-0 font-ed-mono text-[11px] text-base-content/70">
              {t.meta({ count: row.count, when: formatStamp(row.lastActive, now()) })}
            </span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Dialog>
