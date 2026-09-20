<script lang="ts">
  /**
   * The group overlays (tab-groups W2, shell-polish P1): the manage popover,
   * the delete confirm and the "show all" dialog. They live at the shell,
   * not in the strip, because the popover is opened from four places (a
   * chip, a tab's menu, the `▾` list and `group.new`) and a pane is only one
   * of them. `group-ui` decides what is open; this only renders it.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { groupLabel, type GroupShell } from '../group-ui.svelte.js'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import ManageGroupPopover from './ManageGroupPopover.svelte'
  import ShowAllGroupsDialog from './ShowAllGroupsDialog.svelte'

  interface Props {
    panes: PaneShell
    groups: GroupShell
    now: () => number
  }

  let { panes, groups, now }: Props = $props()

  /** The group the manage popover is on, or null — it may have been closed. */
  const managed = $derived(groups.manage ? panes.findGroup(groups.manage.groupId) : null)
  /**
   * What that popover hangs off (P1.3): its own chip, or — for a group whose
   * pane is zoomed away — the focused pane's `▾` button, where its list lives.
   * Null parks the popover near the top rather than dropping the surface.
   */
  const manageAnchor = $derived.by(() => {
    // The REQUEST, not the group: `openManage` mints a new object every time,
    // so this re-reads the DOM on every open. Keyed on the group it would not,
    // and re-opening over a chip since rebuilt (a move to another pane) would
    // hang off a detached node, which measures 0×0 at the viewport corner.
    const request = groups.manage
    if (!request) return null
    // Ids are minted by `nextId`, so they are safe inside the selector string.
    const at = (testid: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
    return at(`group-chip:${request.groupId}`) ?? at(`tab-more:${panes.layout.focus}`)
  })
  const confirmingGroup = $derived(groups.confirming ? panes.findGroup(groups.confirming) : null)
</script>

{#if groups.manage && managed}
  {#key managed.id}
    <ManageGroupPopover
      group={managed}
      {panes}
      {groups}
      anchor={manageAnchor}
      fresh={groups.manage.fresh}
      onDelete={() => groups.askDelete(managed.id)}
      onClose={() => groups.closeManage()}
    />
  {/key}
{/if}

{#if groups.confirming && confirmingGroup}
  <ConfirmDialog
    title={$LL.web.groups.delete_confirm.title()}
    body={$LL.web.groups.delete_confirm.body({
      name: groupLabel(confirmingGroup.name),
      count: confirmingGroup.tabIds.length,
    })}
    confirmLabel={$LL.web.groups.delete_confirm.confirm()}
    danger
    testid="group-delete-confirm"
    onConfirm={() => groups.confirmDelete()}
    onCancel={() => groups.cancelDelete()}
  />
{/if}

{#if groups.showAll}
  <ShowAllGroupsDialog paneId={panes.layout.focus} {groups} {now} onClose={() => groups.closeShowAll()} />
{/if}
