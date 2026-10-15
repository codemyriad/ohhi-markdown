<script lang="ts">
  /**
   * `title` (round 2, P1; spike S21 Q2): the focused pane's active tab by
   * name — a note's basename without `.md`, a view's registry title, nothing
   * for an empty tab — centred, truncating at a narrow width.
   *
   * It is that tab's HANDLE when the pane draws no strip: drag it to another
   * pane's edge or centre (`tabDragSource`, the strip's own payload),
   * right-click it, or focus it (a roving stop of the toolbar) and press
   * `Shift+F10` / the context-menu key for the same `TabContextMenu` the
   * strip opens.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { displayName } from '../../collection-cells.js'
  import { tabDragSource } from '../../pane-drag.js'
  import { findPane, type Tab } from '../../panes.js'
  import { targetOf, type ReadoutContext } from '../../readouts.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../../ui/DropdownMenu.svelte'
  import { viewDef } from '../../views.js'
  import TabContextMenu from '../TabContextMenu.svelte'
  import TabGroupMenuItems from '../TabGroupMenuItems.svelte'

  let { ctx }: { ctx: ReadoutContext } = $props()

  const focused = $derived(targetOf(ctx))
  /** The strip's own name for a tab — the drag ghost and the menu say the same thing. */
  const nameOf = (tab: Tab): string =>
    tab.path ? displayName(tab.path) : tab.view ? viewDef(tab.view).title($LL, tab.viewArg) : ''
  const name = $derived(focused.tab ? nameOf(focused.tab) : '')
  /** A bar at the bottom opens its menu upward, from the title's top edge. */
  const upward = $derived(ctx.side === 'top')

  /** The open tab menu: ids, resolved live, so a layout write under it never points at a stale pane. */
  let menu = $state.raw<{ paneId: string; tabId: string; x: number; y: number } | null>(null)
  const menuPane = $derived(menu ? findPane(ctx.panes.layout, menu.paneId) : null)
  const menuTab = $derived(menuPane?.tabs.find((t) => t.id === menu?.tabId) ?? null)
  let titleEl = $state<HTMLElement>()

  function openMenu(x: number, y: number): void {
    const { pane, tab } = focused
    if (tab) menu = { paneId: pane.id, tabId: tab.id, x, y }
  }

  function anchorUnder(el: HTMLElement): void {
    const r = el.getBoundingClientRect()
    openMenu(r.left, upward ? r.top : r.bottom)
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    // A keyboard-raised `contextmenu` has no pointer: anchor under the title.
    if (e.clientX === 0 && e.clientY === 0 && titleEl) anchorUnder(titleEl)
    else openMenu(e.clientX, e.clientY)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu')) return
    e.preventDefault()
    anchorUnder(titleEl ?? (e.currentTarget as HTMLElement))
  }

  /** The anchor stays mounted, so focus comes back to the title (the strip's rule). */
  function closeMenu(): void {
    menu = null
    queueMicrotask(() => titleEl?.focus())
  }
</script>

{#if focused.tab && name}
  {@const tab = focused.tab}
  {@const drag = tabDragSource(ctx.panes, focused.pane.id, tab.id, name)}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -- the title is a
       roving stop of the toolbar, so the tab menu is one Shift+F10 away from
       the keyboard; not a button, because a click on it does nothing -->
  <div
    bind:this={titleEl}
    role="group"
    aria-label={name}
    aria-keyshortcuts="Shift+F10 ContextMenu"
    tabindex="-1"
    title={tab.path ?? name}
    data-testid="toolbar-title"
    data-drag-source={drag['data-drag-source']}
    onpointerdown={drag.onpointerdown}
    oncontextmenu={onContextMenu}
    onkeydown={onKeydown}
    class="min-w-0 max-w-full touch-none truncate rounded px-1 text-center text-sm text-base-content select-none focus-visible:outline-2 focus-visible:outline-primary"
  >
    {name}
  </div>
{/if}

{#if menu && menuPane && menuTab}
  <TabContextMenu
    tab={menuTab}
    pane={menuPane}
    panes={ctx.panes}
    name={nameOf(menuTab) || $LL.web.tabs.untitled()}
    at={{ x: menu.x, y: menu.y }}
    {groupItems}
    onClose={closeMenu}
  />
{/if}

{#snippet groupItems(attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }, tab: Tab)}
  <TabGroupMenuItems {attrs} {tab} panes={ctx.panes} groups={ctx.groups} />
{/snippet}
