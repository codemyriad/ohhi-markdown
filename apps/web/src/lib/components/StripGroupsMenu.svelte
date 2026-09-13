<script lang="ts">
  /**
   * The strip-end `▾` list (tab-groups B9, Fork 2-A — the second screenshot):
   * the groups open in a pane, ticked, this pane's first; the ones waiting in
   * the list, most recently used first (Decision 8 — recency IS the ranking,
   * nothing ever expires); *Show all…*; and the two ways to make a group out
   * of what is already on screen.
   *
   * `groups.rows()` decides the order, so this and the *Show all* dialog can
   * never disagree about it. The list is trimmed here because a menu is a
   * glance — everything is in the dialog.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { groupLabel, type GroupShell } from '../group-ui.svelte.js'
  import { formatStamp } from '../history.js'
  import { activeTab, type Pane } from '../panes.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSection from '../ui/MenuSection.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import GroupDot from './GroupDot.svelte'

  interface Props {
    attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }
    pane: Pane
    panes: PaneShell
    groups: GroupShell
    /** Injected clock (golden rule 5) — "how long ago" is never `Date.now()`. */
    now: () => number
  }

  let { attrs, pane, panes, groups, now }: Props = $props()

  /** How many saved rows a glance is worth; the rest live in *Show all…*. */
  const LIST_PREVIEW = 5

  const t = $derived($LL.web.groups)
  const rows = $derived(groups.rows(pane.id))
  const open = $derived(rows.filter((r) => r.open))
  const saved = $derived(rows.filter((r) => !r.open))
  const hasNote = $derived(activeTab(pane)?.path != null)
</script>

{#if open.length > 0}
  <MenuSection label={t.menu.open()}>
    {#each open as row (row.id)}
      <MenuItem
        item={attrs.item}
        checked
        testid="groups-menu:{row.id}"
        onSelect={() => groups.openRow(row, pane.id)}
      >
        <span class="flex w-full items-center gap-2">
          <GroupDot color={row.color} />
          <span class="min-w-0 flex-1 truncate">{groupLabel(row.name)}</span>
          {#if !row.here && row.paneId}
            <span class="shrink-0 text-[10px] text-base-content/70">
              {$LL.web.panes.label({ n: panes.paneIndex(row.paneId) })}
            </span>
          {/if}
        </span>
      </MenuItem>
    {/each}
  </MenuSection>
{/if}

{#if saved.length > 0}
  <MenuSection label={t.menu.saved()}>
    {#each saved.slice(0, LIST_PREVIEW) as row (row.id)}
      <MenuItem
        item={attrs.item}
        checked={false}
        testid="groups-menu:{row.id}"
        onSelect={() => groups.openRow(row, pane.id)}
      >
        <span class="flex w-full items-center gap-2">
          <GroupDot color={row.color} />
          <span class="min-w-0 flex-1 truncate">{groupLabel(row.name)}</span>
          <span class="shrink-0 font-ed-mono text-[10px] text-base-content/70">
            {formatStamp(row.lastActive, now())}
          </span>
        </span>
      </MenuItem>
    {/each}
  </MenuSection>
{/if}

{#if rows.length > 0}
  <MenuItem
    item={attrs.item}
    testid="groups-menu:show-all"
    onSelect={() => groups.openShowAll()}
  >
    {t.menu.show_all()}
  </MenuItem>
{:else}
  <MenuItem item={attrs.item} disabled testid="groups-menu:empty" onSelect={() => {}}>
    {$LL.web.tabs.no_groups()}
  </MenuItem>
{/if}

<MenuSeparator separator={attrs.separator} />
<MenuItem
  item={attrs.item}
  disabled={!hasNote}
  reason={hasNote ? undefined : t.menu.needs_note()}
  testid="groups-menu:open-links"
  onSelect={() => groups.openLinksAsGroup(pane.id)}
>
  {t.menu.open_links()}
</MenuItem>
<MenuItem
  item={attrs.item}
  testid="groups-menu:new"
  onSelect={() => groups.newFromActive(pane.id)}
>
  {t.menu.new_from_active()}
</MenuItem>
