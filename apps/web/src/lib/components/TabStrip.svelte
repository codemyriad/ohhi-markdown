<script lang="ts">
  /**
   * One pane's tab strip (tab-groups B9): a real tablist — one tab stop,
   * arrows and Home/End move, Delete closes — plus the pointer gestures that
   * build the layout (B10) and the tab context menu that is their keyboard
   * equivalent (R8).
   *
   * The strip iterates `stripItems(pane)`, which yields a chip before each
   * group's run and then the run's tabs, and draws each group's colour as a
   * 2 px rule over its tabs. `GroupChip.svelte` fills the `groupChip` snippet.
   *
   * **Why the strip holds several tablists.** ARIA lets a `tablist` own
   * nothing but `tab`s, so a group chip — a real button with `aria-expanded`
   * — cannot live inside one; axe fails the pane on `aria-required-children`
   * the moment a chip is rendered there. So the items are grouped into runs:
   * a chip is a plain sibling, and each contiguous run of visible tabs is its
   * own tablist, named after the group it belongs to. DOM order still matches
   * what is on screen, so a screen reader hears a group's chip immediately
   * before that group's tabs. Roving focus is unchanged — it walks every
   * `[role=tab]` in the strip, which is what the user sees as one row.
   *
   * The `data-slot-*` attributes are what the drag hit test measures — the
   * strip is the only thing that knows where its items are drawn.
   */
  import {
    ChevronDown,
    CodeXml,
    Eye,
    PenLine,
    Pin,
    Plus,
    X,
    type LucideIcon,
  } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { basename } from '@ohhi/index'
  import { groupLabel } from '../group-ui.svelte.js'
  import {
    activeTab,
    stripItems,
    type Group,
    type Pane,
    type StripItem,
    type Tab,
    type ViewMode,
    VIEW_MODES,
  } from '../panes.js'
  import { viewDef } from '../views.js'
  import { newTabDocks } from '../pane-chrome.js'
  import { presenceFor, type PresenceByPath } from '../presence.js'
  import PresenceStack from './PresenceStack.svelte'
  import { tabDragSource } from '../pane-drag.js'
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
    moreMenuItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Pane]>
    /**
     * The focused pane's mark is the strip's bottom inset (the `dense` look).
     * Off when the layout draws the pane's own focus edge instead (S21).
     */
    insetMark?: boolean
    /** Sharing E1: who is in each note — a small avatar on a tab whose note holds a peer. */
    presence?: PresenceByPath
  }

  let {
    pane,
    focused,
    panes,
    uid,
    groupChip,
    tabMenuGroupItems,
    moreMenuItems,
    insetMark = true,
    presence = {},
  }: Props = $props()

  type TabItem = Extract<StripItem, { kind: 'tab' }>
  type TabRun = { key: string; kind: 'tabs'; group: Group | null; label: string; items: TabItem[] }
  /** A chip, or the run of tabs one tablist holds. */
  type Run = { key: string; kind: 'chip'; item: Extract<StripItem, { kind: 'chip' }> } | TabRun

  const t = $derived($LL.web.tabs)
  const r = $derived($LL.web.read)
  /**
   * A tab says its mode only when it is NOT Live (the mock, v4): Live is what
   * 36 of 36 measured leaves are, so a badge on every tab would be noise —
   * the icon marks the exception.
   */
  const MODE_ICON: Record<ViewMode, LucideIcon | null> = {
    live: null,
    source: CodeXml,
    reading: Eye,
  }
  /**
   * The strip-end mode menu (round 3, Q5) is the active tab's: all three
   * modes, its trigger drawn with the mode the tab is in. `Mod+E` stays
   * Obsidian's pair (editing ↔ Reading) and the palette has a row per mode.
   */
  const MENU_ICON: Record<ViewMode, LucideIcon> = { live: PenLine, source: CodeXml, reading: Eye }
  const current = $derived(activeTab(pane))
  const currentMode = $derived(panes.modeOf(current))
  const items = $derived(stripItems(pane))
  /** Consecutive tabs of the same group (or of none) share one tablist. */
  const runs = $derived.by(() => {
    const out: Run[] = []
    let openId: string | null | undefined
    for (const item of items) {
      if (item.kind === 'chip') {
        out.push({ key: `c${item.group.id}`, kind: 'chip', item })
        openId = undefined
        continue
      }
      const gid = item.group?.id ?? null
      if (gid !== openId) {
        openId = gid
        out.push({ key: `l${item.tab.id}`, kind: 'tabs', group: item.group, label: '', items: [] })
      }
      const last = out[out.length - 1]
      if (last.kind === 'tabs') last.items.push(item)
    }
    // A grouped run is named by its group. A loose one is named by WHERE it is:
    // three lists all called "Open notes" tell a screen-reader user nothing
    // about which side of which group they have landed in.
    const loose = out.filter((r): r is TabRun => r.kind === 'tabs' && !r.group)
    for (const run of out) {
      if (run.kind !== 'tabs') continue
      run.label = run.group
        ? groupLabel(run.group.name)
        : loose.length > 1
          ? t.list_n({ index: loose.indexOf(run) + 1, total: loose.length })
          : t.list()
    }
    return out
  })
  const tabDomId = (id: string): string => `${uid}-tab-${id}`
  const panelDomId = (id: string): string => `${uid}-panel-${id}`
  const nameOf = (tab: Tab): string =>
    tab.path ? basename(tab.path) : tab.view ? viewDef(tab.view).title($LL, tab.viewArg) : t.untitled()
  const dragging = $derived(new Set(panes.drag?.payload.tabIds ?? []))

  /** Right-clicked tab and where, or null; one menu per strip, not per tab. */
  let menu = $state.raw<{ tab: Tab; x: number; y: number } | null>(null)

  let listEl = $state<HTMLElement>()
  let runEl = $state<HTMLElement>()

  /**
   * The `+` docks at the strip's end once the tabs overflow (`newTabDocks`):
   * measured whenever the run's room or its content changes size — a tab
   * opened or closed, the pane resized. No polling.
   */
  let docked = $state(false)
  $effect(() => {
    const list = listEl
    const run = runEl
    if (!list || !run) return
    const measure = (): void => {
      docked = newTabDocks({ content: run.getBoundingClientRect().width, room: list.clientWidth })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(list)
    observer.observe(run)
    measure()
    return () => observer.disconnect()
  })

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

  /**
   * The menu's trigger is a zero-size anchor placed at the pointer, and it
   * unmounts with the menu — so Melt's focus-return lands on `<body>` and the
   * keyboard is pointing at nothing. Focus goes back to the tab the menu acted
   * on, or to whatever is selected if that tab was just closed.
   */
  function closeMenu(): void {
    const id = menu?.tab.id
    menu = null
    queueMicrotask(() => {
      const back =
        (id ? listEl?.querySelector<HTMLElement>(`[id="${CSS.escape(tabDomId(id))}"]`) : null) ??
        listEl?.querySelector<HTMLElement>('[aria-selected="true"]')
      back?.focus()
    })
  }

  /** The same handle the toolbar title is when the strip is not drawn (S21). */
  function startDrag(e: PointerEvent, tab: Tab): void {
    tabDragSource(panes, pane.id, tab.id, nameOf(tab)).onpointerdown(e)
  }
</script>

{#snippet newTab()}
  <IconButton
    label={t.new_tab()}
    icon={Plus}
    testid="tab-new:{pane.id}"
    data-docked={docked}
    onclick={() => panes.newTabIn(pane.id)}
  />
{/snippet}

<!-- Only the SELECTED tab gets `aria-controls`: a pane renders one panel,
     for its active tab (R2.1), so a background tab would point at an element
     that is not in the document. That is the APG's deferred-panel form. -->
{#snippet tabSlot(item: TabItem)}
  {@const tab = item.tab}
  {@const selected = pane.active === tab.id}
  {@const tabMode = panes.modeOf(tab)}
  {@const ModeIcon = MODE_ICON[tabMode]}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- the
       wrapper carries the POINTER gestures (drag, right-click, pin);
       the keyboard equivalents all live on the tab button inside it -->
  <div
    role="presentation"
    data-slot-index={item.index}
    data-slot-kind="tab"
    data-slot-group={item.group?.id}
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
      {selected ? 'bg-ed-tab-active-bg text-base-content' : 'text-base-content/70 hover:bg-base-300'}
      {dragging.has(tab.id) ? 'opacity-35' : ''}"
  >
    {#if item.group}
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-x-0 top-0 h-ed-group-cap"
        style="background: var(--ed-tab-group)"
      ></span>
    {/if}
    <button
      type="button"
      role="tab"
      id={tabDomId(tab.id)}
      aria-selected={selected}
      aria-controls={selected ? panelDomId(tab.id) : undefined}
      tabindex={selected ? 0 : -1}
      title={tab.path ?? nameOf(tab)}
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
          class="size-1.5 shrink-0 rounded-full bg-ed-tab-live"
        ></span>
        <span class="sr-only">{t.live()}</span>
      {/if}
      {#if tab.view && !tab.path}
        {@const ViewIcon = viewDef(tab.view).icon}
        <ViewIcon size={11} aria-hidden="true" class="shrink-0" />
      {/if}
      <span class="truncate">{nameOf(tab)}</span>
      {#if tab.path}
        <PresenceStack peers={presenceFor(presence, tab.path)} testid="tab-presence:{tab.path}" />
      {/if}
      {#if ModeIcon}
        <ModeIcon size={11} aria-hidden="true" class="shrink-0" />
        <span class="sr-only">{r.tab_mode({ mode: r.modes[tabMode]() })}</span>
      {/if}
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
{/snippet}

<div
  data-strip
  class="flex h-8 shrink-0 items-stretch border-b border-base-300 bg-ed-strip-bg"
  style={focused && insetMark
    ? 'box-shadow: inset 0 calc(-1 * var(--ed-pane-focus-width)) 0 var(--ed-pane-focus)'
    : undefined}
>
  <div
    bind:this={listEl}
    data-testid="tabs:{pane.id}"
    class="flex min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
  >
    <!-- The run's content, as wide as its tabs: what the overflow test measures. -->
    <div bind:this={runEl} class="flex w-max shrink-0 items-stretch">
      {#each runs as run (run.key)}
        {#if run.kind === 'chip'}
          <div
            role="presentation"
            data-slot-index={run.item.index}
            data-slot-end={run.item.endIndex}
            data-slot-kind="chip"
            data-slot-group={run.item.group.id}
            data-slot-folded={run.item.group.collapsed}
            class="flex items-stretch"
          >
            {#if groupChip}{@render groupChip(run.item.group, pane)}{/if}
          </div>
        {:else}
          <div role="tablist" aria-label={run.label} class="flex items-stretch">
            {#each run.items as item (item.tab.id)}
              {@render tabSlot(item)}
            {/each}
          </div>
        {/if}
      {/each}
      <!-- New tab, right after the last tab (Chris, 2026-10-06), as a browser
           puts it — while the tabs fit; once they overflow it docks at the
           strip's end, left of the mode control (`newTabDocks`). A sibling of
           the tablists, never in one — a tablist owns only tabs — and no
           `data-slot-*`: the drag hit test skips it. -->
      {#if !docked}
        <div class="flex shrink-0 items-center px-1">{@render newTab()}</div>
      {/if}
    </div>
  </div>

  <div class="flex shrink-0 items-center gap-0.5 border-l border-base-300 px-1">
    {#if docked}{@render newTab()}{/if}
    {#if current?.path}
      {@const tabId = current.id}
      {@const CurrentIcon = MENU_ICON[currentMode]}
      <DropdownMenu placement="bottom-end" testid="tab-mode-list:{pane.id}">
        {#snippet trigger(attrs)}
          <button
            use:melt={attrs}
            type="button"
            aria-label={r.mode_menu_current({ mode: r.modes[currentMode]() })}
            data-testid="tab-mode:{pane.id}"
            data-mode={currentMode}
            class="flex items-center gap-0.5 rounded p-1 text-base-content/70 hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
          >
            <CurrentIcon size={14} aria-hidden="true" />
            <ChevronDown size={10} aria-hidden="true" />
          </button>
        {/snippet}
        {#snippet children(attrs)}
          {#each VIEW_MODES as value (value)}
            {@const Icon = MENU_ICON[value]}
            <MenuItem
              item={attrs.item}
              checked={currentMode === value}
              testid="tab-mode:{pane.id}:{value}"
              onSelect={() => panes.setMode(tabId, value)}
            >
              <span class="flex items-center gap-2">
                <Icon size={14} aria-hidden="true" />
                {r.modes[value]()}
              </span>
            </MenuItem>
          {/each}
        {/snippet}
      </DropdownMenu>
    {/if}
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
          {@render moreMenuItems(attrs, pane)}
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
    onClose={closeMenu}
  />
{/if}
