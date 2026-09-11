<script lang="ts">
  /**
   * A group's chip in the strip (tab-groups B9, Fork 5-B): a dot in the
   * group's own `--ed-group-N`, its name, and — when the group is folded —
   * how many tabs are behind it.
   *
   * It is a real button with `aria-expanded`, because that is what it does:
   * click folds and unfolds the run to its right. Managing the group is the
   * second gesture — right-click, `Shift+F10` or the context-menu key, the
   * same three routes every other menu in the shell answers to (R8).
   *
   * Dragging it moves the WHOLE group (Decision 4): the payload carries the
   * group id, and `groups.ts`'s `moveGroup` keeps the name and the colour on
   * the far side of the drop.
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import { groupLabel } from '../group-ui.svelte.js'
  import type { Group, Pane } from '../panes.js'
  import { DRAG_THRESHOLD_PX, type PaneShell } from '../workspace-panes.svelte.js'
  import GroupDot from './GroupDot.svelte'

  interface Props {
    group: Group
    pane: Pane
    panes: PaneShell
    onManage: (groupId: string) => void
  }

  let { group, pane, panes, onManage }: Props = $props()

  const t = $derived($LL.web.groups)
  const name = $derived(groupLabel(group.name))
  const lifted = $derived(panes.drag?.payload.groupId === group.id)

  /**
   * Where the press started, so a drag that ends back on the chip is not also
   * read as a click — the gesture would otherwise fold the group it just
   * moved. (`click` reports the pointer-up position.)
   */
  let from: { x: number; y: number } | null = null

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return
    from = { x: e.clientX, y: e.clientY }
    panes.beginDrag(e, {
      tabIds: [...group.tabIds],
      fromPaneId: pane.id,
      groupId: group.id,
      label: name,
      color: group.color,
    })
  }

  function onClick(e: MouseEvent): void {
    const start = from
    from = null
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) >= DRAG_THRESHOLD_PX) return
    panes.toggleGroup(group.id)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
    e.preventDefault()
    onManage(group.id)
  }
</script>

<button
  type="button"
  aria-expanded={!group.collapsed}
  title={t.chip.hint()}
  data-testid="group-chip:{group.id}"
  data-color={group.color}
  data-folded={group.collapsed}
  onclick={onClick}
  onpointerdown={onPointerDown}
  onkeydown={onKeydown}
  oncontextmenu={(e) => {
    e.preventDefault()
    onManage(group.id)
  }}
  style="--ed-chip: var(--ed-group-{group.color});
    background: color-mix(in srgb, var(--ed-chip) 22%, transparent);
    border: 1px solid color-mix(in srgb, var(--ed-chip) 45%, transparent)"
  class="my-1 ml-1.5 flex shrink-0 touch-none items-center gap-1.5 rounded-md px-2 text-xs font-medium text-base-content select-none focus-visible:outline-2 focus-visible:outline-primary
    {lifted ? 'opacity-35' : ''}"
>
  <GroupDot color={group.color} />
  <span class="max-w-32 truncate">{name}</span>
  {#if group.collapsed}
    <!-- The count stands in for the tabs the fold hid; spelled out for a
         screen reader, since "5" on its own says nothing. -->
    <span aria-hidden="true" class="font-ed-mono text-[10px] text-base-content/70">
      {group.tabIds.length}
    </span>
    <span class="sr-only">{t.chip.tabs({ count: group.tabIds.length })}</span>
  {/if}
</button>
