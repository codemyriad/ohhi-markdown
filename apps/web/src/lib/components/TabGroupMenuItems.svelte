<script lang="ts">
  /**
   * The group rows of a tab's context menu (tab-groups B9): *Add to group ▸*
   * — this pane's groups, then *New group…* — and, when the tab is already in
   * one, fold, leave and close.
   *
   * *Add to group* is a labelled `role="group"` section rather than a
   * submenu, the same shape `TabContextMenu` already uses for *Move to pane*:
   * `DropdownMenu` is a flat Melt menu, and a section keeps every row one
   * arrow-key away instead of two.
   *
   * This is the keyboard (and pointer) equivalent of dropping a tab between
   * two of a group's tabs, which is what R8 asks of every drag gesture.
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import type { GroupShell } from '../group-ui.svelte.js'
  import { groupOf, paneOfTab, type Tab } from '../panes.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'

  interface Props {
    attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }
    tab: Tab
    panes: PaneShell
    groups: GroupShell
  }

  let { attrs, tab, panes, groups }: Props = $props()

  const t = $derived($LL.web.groups)
  const pane = $derived(paneOfTab(panes.layout, tab.id))
  const group = $derived(pane ? groupOf(pane, tab.id) : null)
  const nameOf = (name: string): string => name || t.untitled()
</script>

<MenuSeparator separator={attrs.separator} />
<div role="group" aria-label={t.tab_menu.add_to()}>
  <p
    aria-hidden="true"
    class="px-3 pt-1 pb-0.5 text-[10px] tracking-wider text-base-content/70 uppercase"
  >
    {t.tab_menu.add_to()}
  </p>
  {#each pane?.groups ?? [] as other (other.id)}
    <MenuItem
      item={attrs.item}
      checked={other.id === group?.id}
      testid="tab-menu:group:{other.id}"
      onSelect={() => panes.addToGroup(tab.id, other.id)}
    >
      <span class="flex items-center gap-2">
        <span
          aria-hidden="true"
          class="size-2 shrink-0 rounded-full"
          style="background: var(--ed-group-{other.color})"
        ></span>
        <span class="min-w-0 truncate">{nameOf(other.name)}</span>
      </span>
    </MenuItem>
  {/each}
  <MenuItem
    item={attrs.item}
    testid="tab-menu:new-group"
    onSelect={() => {
      if (!pane) return
      const id = panes.newGroup(tab.id, pane.id)
      if (id) groups.openManage(id, true)
    }}
  >
    {t.tab_menu.new_group()}
  </MenuItem>
</div>

{#if group}
  <MenuSeparator separator={attrs.separator} />
  <MenuItem
    item={attrs.item}
    testid="tab-menu:group-fold"
    onSelect={() => panes.toggleGroup(group.id)}
  >
    {group.collapsed ? t.tab_menu.unfold() : t.tab_menu.fold()}
  </MenuItem>
  <MenuItem
    item={attrs.item}
    testid="tab-menu:group-remove"
    onSelect={() => panes.removeFromGroup(tab.id)}
  >
    {t.tab_menu.remove()}
  </MenuItem>
  <MenuItem
    item={attrs.item}
    testid="tab-menu:group-close"
    onSelect={() => panes.closeGroup(group.id)}
  >
    {t.tab_menu.close()}
  </MenuItem>
{/if}
