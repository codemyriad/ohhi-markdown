<script lang="ts">
  /**
   * One pane's tab strip (tab-groups B9): a real tablist — one tab stop,
   * arrows and Home/End move, Delete closes — plus the pointer gestures that
   * build the layout (B10) and the tab context menu that is their keyboard
   * equivalent (R8).
   *
   * The strip iterates `stripItems(pane)`, which yields a chip before each
   * group's run and then the run's tabs. W1 renders the chip as the group's
   * 2 px colour rule over its tabs and leaves the `groupChip` snippet for C1
   * to fill with `GroupChip.svelte`; nothing else has to move when it lands.
   *
   * The `data-slot-*` attributes are what the drag hit test measures — the
   * strip is the only thing that knows where its items are drawn.
   */
  import { ChevronDown, Pin, Plus, X } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { basename } from '@editor/index'
  import { stripItems, type Group, type Pane, type Tab } from '../panes.js'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import { melt } from '@melt-ui/svelte'
  import DropdownMenu, {
    type MenuItemAttrs,
    type MenuSeparatorAttrs,
  } from '../ui/DropdownMenu.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import TabContextMenu from './TabContextMenu.svelte'

  interface Props {
    pane: Pane
    focused: boolean
    panes: PaneShell
    /** Shared with the pane so tab and panel ids point at each other. */
    uid: string
    /** W2 (C1): the chip that stands in front of a group's run. */
    groupChip?: Snippet<[Group, Pane]>
    /** W2 (C1): group rows in a tab's context menu. */
    tabMenuGroupItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Tab]>
    /** W2 (C1): the strip-end `▾` list — open groups, saved groups, Show all. */
    moreMenuItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }]>
  }

  let { pane, focused, panes, uid, groupChip, tabMenuGroupItems, moreMenuItems }: Props =
    $props()

  const t = $derived($LL.web.tabs)
  const items = $derived(stripItems(pane))
  const tabDomId = (id: string): string => `${uid}-tab-${id}`
  const panelDomId = (id: string): string => `${uid}-panel-${id}`
  const nameOf = (tab: Tab): string => (tab.path ? basename(tab.path) : t.untitled())
  const dragging = $derived(new Set(panes.drag?.payload.tabIds ?? []))

  /** Right-clicked tab and where, or null; one menu per strip, not per tab. */
  let menu = $state.raw<{ tab: Tab; x: number; y: number } | null>(null)

  let listEl = $state<HTMLElement>()

  // Keep the active tab in view after a switch, a reorder or a drop — the
  // strip scrolls horizontally and 21 tabs do not fit (the measured vault).
  $effect(() => {
    pane.active
    listEl?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  })

  function onTabKeydown(e: KeyboardEvent, tab: Tab): void {
    const stops = [...(listEl?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])]
    const at = stops.findIndex((el) => el === e.currentTarget)
    if (e.key === 'ArrowRight') stops[(at + 1) % stops.length]?.focus()
    else if (e.key === 'ArrowLeft') stops[(at - 1 + stops.length) % stops.length]?.focus()
    else if (e.key === 'Home') stops[0]?.focus()
    else if (e.key === 'End') stops[stops.length - 1]?.focus()
    else if (e.key === 'Delete' && !tab.pinned) panes.closeTab(tab.id)
    else return
    e.preventDefault()
  }

  function startDrag(e: PointerEvent, tab: Tab): void {
    if (e.button !== 0) return
    panes.beginDrag(e, {
      tabIds: [tab.id],
      fromPaneId: pane.id,
      groupId: null,
      label: nameOf(tab),
      color: null,
    })
  }
</script>

<div
  data-strip
  class="flex h-8 shrink-0 items-stretch border-b border-base-300 bg-base-200
    {focused ? 'shadow-[inset_0_-2px_0_var(--color-primary)]' : ''}"
>
  <div
    bind:this={listEl}
    role="tablist"
    aria-label={t.list()}
    data-testid="tablist:{pane.id}"
    class="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
  >
    {#each items as item (item.kind === 'chip' ? `c${item.group.id}` : item.tab.id)}
      {#if item.kind === 'chip'}
        <!-- W1 draws the group only as the rule over its tabs; the chip itself
             is C1's. The slot is measured by the drag hit test either way. -->
        <div
          role="presentation"
          data-slot-index={item.index}
          data-slot-end={item.endIndex}
          data-slot-kind="chip"
          data-slot-group={item.group.id}
          data-slot-folded={item.group.collapsed}
          class="flex items-stretch"
        >
          {#if groupChip}{@render groupChip(item.group, pane)}{/if}
        </div>
      {:else}
        {@const tab = item.tab}
        {@const selected = pane.active === tab.id}
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the
             wrapper carries the POINTER gestures (drag, right-click, pin);
             the keyboard equivalents all live on the tab button inside it -->
        <div
          role="presentation"
          data-slot-index={item.index}
          data-slot-kind="tab"
          data-testid="tab:{pane.id}:{tab.id}"
          data-path={tab.path}
          style={item.group ? `--ed-tab-group: var(--ed-group-${item.group.color})` : undefined}
          oncontextmenu={(e) => {
            e.preventDefault()
            menu = { tab, x: e.clientX, y: e.clientY }
          }}
          onpointerdown={(e) => startDrag(e, tab)}
          ondblclick={() => panes.togglePin(tab.id)}
          class="group relative flex max-w-[11rem] min-w-[4rem] shrink-0 touch-none items-center gap-1 border-r border-base-300 pr-1 pl-2 select-none
            {selected ? 'bg-ed-surface text-base-content' : 'text-base-content/70 hover:bg-base-300'}
            {dragging.has(tab.id) ? 'opacity-35' : ''}"
        >
          {#if item.group}
            <span
              aria-hidden="true"
              class="pointer-events-none absolute inset-x-0 top-0 h-0.5"
              style="background: var(--ed-tab-group)"
            ></span>
          {/if}
          <button
            type="button"
            role="tab"
            id={tabDomId(tab.id)}
            aria-selected={selected}
            aria-controls={panelDomId(tab.id)}
            tabindex={selected ? 0 : -1}
            title={tab.path ?? t.untitled()}
            onclick={(e) => {
              // The ✕ lives inside the tab (the APG's deletable-tabs pattern):
              // a real button there would be a control nested in a control,
              // which is both an axe violation and a second tab stop per tab.
              if ((e.target as HTMLElement).closest('[data-tab-close]')) panes.closeTab(tab.id)
              else panes.activate(pane.id, tab.id)
            }}
            onkeydown={(e) => onTabKeydown(e, tab)}
            class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-xs focus-visible:outline-2 focus-visible:outline-primary"
          >
            {#if tab.pinned}
              <Pin size={10} aria-hidden="true" class="shrink-0" />
              <span class="sr-only">{t.pinned()}</span>
            {/if}
            {#if selected}
              <span
                data-testid="tab-live"
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full bg-primary"
              ></span>
              <span class="sr-only">{t.live()}</span>
            {/if}
            <span class="truncate">{nameOf(tab)}</span>
            {#if !tab.pinned}
              <!-- Decoration, not a control: the keyboard closes a tab with
                   Delete on the strip, Mod+W, or the tab menu (R8). -->
              <span
                data-tab-close
                aria-hidden="true"
                data-testid="tab-close:{pane.id}:{tab.id}"
                class="ml-auto shrink-0 rounded p-0.5 text-base-content/70 hover:bg-base-300 hover:text-base-content
                  {selected ? 'visible' : 'invisible group-hover:visible'}"
              >
                <X size={11} />
              </span>
            {/if}
          </button>
        </div>
      {/if}
    {/each}
  </div>

  <div class="flex shrink-0 items-center gap-0.5 border-l border-base-300 px-1">
    <IconButton
      label={t.new_tab()}
      icon={Plus}
      testid="tab-new:{pane.id}"
      onclick={() => panes.newTabIn(pane.id)}
    />
    <DropdownMenu placement="bottom-end" testid="tab-more-menu:{pane.id}">
      {#snippet trigger(attrs)}
        <button
          use:melt={attrs}
          type="button"
          aria-label={t.more()}
          data-testid="tab-more:{pane.id}"
          class="rounded p-1 text-base-content/70 hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      {/snippet}
      {#snippet children(attrs)}
        {#if moreMenuItems}
          {@render moreMenuItems(attrs)}
        {:else}
          <!-- W2 fills this list (open groups ticked, saved groups by
               recency, Show all…). Until then the menu says so rather than
               opening empty. -->
          <MenuItem item={attrs.item} disabled onSelect={() => {}}>{t.no_groups()}</MenuItem>
        {/if}
      {/snippet}
    </DropdownMenu>
  </div>
</div>

{#if menu}
  <TabContextMenu
    tab={menu.tab}
    at={{ x: menu.x, y: menu.y }}
    {pane}
    {panes}
    name={nameOf(menu.tab)}
    groupItems={tabMenuGroupItems}
    onClose={() => (menu = null)}
  />
{/if}
