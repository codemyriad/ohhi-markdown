<script lang="ts" module>
  import type { LucideIcon } from '@lucide/svelte'

  /** One row of the nav: a section, drawn at its depth in the tree. */
  export interface NavRow {
    value: string
    label: string
    /** The rail's glyph (`aria-hidden`); the wide list draws it on top-level rows only. */
    icon: LucideIcon
    /** 0 = a top-level section; 1 = a part of the row above it (indented in the wide list). */
    depth: 0 | 1
    /** The first row of a group after the first: a gap above it (a rule in the wide list). */
    groupStart?: boolean
    testid?: string
  }
</script>

<script lang="ts">
  /**
   * Settings' nav (settings-shaping Fork 7 + QA round 1's narrow nav): ONE
   * tablist drawn two ways by the width of the Settings it sits in — a
   * container query on the `settings` container, never the viewport, so a
   * split pane on a wide screen gets the narrow form too.
   *
   *  - Wide (32rem and up): the tree as a 200 px column — top-level sections
   *    with their icon, Customise's parts indented under it, a rule between
   *    the groups; the active row a primary tint at 600 weight (Fork 12).
   *  - Narrow: an icon rail, 44 px — every row its glyph alone, the groups as
   *    small gaps, the active one tinted with a bar at its edge. Each tab
   *    keeps its name: the label is still in the tab (visually hidden), it is
   *    the tab's `aria-label`, and a `Tooltip` shows it on hover and on
   *    keyboard focus (the tooltip is drawn in the rail only — in the wide
   *    list it would repeat the label beside it).
   *
   * The keyboard model is the tablist's (as `Tabs`): one tab stop (the active
   * tab), ↑/↓ (and ←/→) move and select, Home/End jump to the ends. Only the
   * active panel exists; the host renders it with `panelId(value)` as its id
   * and `tabId(value)` as its `aria-labelledby`.
   */
  import { melt } from '@melt-ui/svelte'
  import Tooltip from './Tooltip.svelte'

  interface Props {
    rows: NavRow[]
    /** The active row's value. */
    value: string
    /** A tab was picked (click or keys). */
    onSelect: (value: string) => void
    /** Accessible name of the tablist. */
    label: string
    /** Ids shared with the host's panel. */
    tabId: (value: string) => string
    panelId: (value: string) => string
    testid?: string
  }

  let { rows, value, onSelect, label, tabId, panelId, testid }: Props = $props()

  let list = $state<HTMLElement | null>(null)
  /** The rail's tooltips are drawn in the nav, outside the tablist (which may hold tabs only). */
  const uid = $props.id()
  const navId = `${uid}-settings-nav`

  function focusTab(at: number): void {
    const row = rows[at]
    if (!row) return
    onSelect(row.value)
    list?.querySelector<HTMLElement>(`#${CSS.escape(tabId(row.value))}`)?.focus()
  }

  function onkeydown(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    // From the tab that has focus (the host may not have moved yet), else the active one.
    const focused = rows.findIndex((r) => tabId(r.value) === (e.target as HTMLElement | null)?.id)
    const at = focused >= 0 ? focused : rows.findIndex((r) => r.value === value)
    const n = rows.length
    const next =
      e.key === 'ArrowDown' || e.key === 'ArrowRight'
        ? (at + 1) % n
        : e.key === 'ArrowUp' || e.key === 'ArrowLeft'
          ? (at - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1
    if (next < 0) return
    e.preventDefault()
    focusTab(next)
  }
</script>

<nav
  id={navId}
  class="shrink-0 border-r border-base-300 bg-base-100 @max-[32rem]/settings:w-11"
  data-testid={testid ? `${testid}-nav` : undefined}
>
  <div
    bind:this={list}
    role="tablist"
    aria-label={label}
    aria-orientation="vertical"
    tabindex="-1"
    data-testid={testid}
    {onkeydown}
    class="sticky top-0 flex w-50 flex-col gap-px px-2.5 py-3.5 @max-[32rem]/settings:w-11 @max-[32rem]/settings:items-center @max-[32rem]/settings:px-0 @max-[32rem]/settings:py-2"
  >
    {#each rows as row (row.value)}
      {@const active = row.value === value}
      <Tooltip
        text={row.label}
        placement="right"
        triggerId={tabId(row.value)}
        contentClass="@min-[32rem]/settings:hidden"
        portal="#{navId}"
      >
        {#snippet children(trigger)}
          <button
            use:melt={trigger}
            type="button"
            role="tab"
            id={tabId(row.value)}
            aria-label={row.label}
            aria-selected={active}
            aria-controls={active ? panelId(row.value) : undefined}
            tabindex={active ? 0 : -1}
            data-testid={row.testid}
            data-depth={row.depth}
            data-group-start={row.groupStart ? '' : undefined}
            onclick={() => onSelect(row.value)}
            class="relative flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2.5 text-left text-[13px] whitespace-nowrap
              hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary
              {active ? 'bg-primary/12 font-semibold text-base-content hover:bg-primary/12' : 'text-base-content/70 hover:text-base-content'}
              {row.depth === 1 ? `pl-[30px] ${active ? '' : 'font-normal'}` : active ? '' : 'font-medium'}
              {row.groupStart
              ? "mt-[21px] before:pointer-events-none before:absolute before:inset-x-2 before:-top-[11px] before:border-t before:border-base-300 before:content-[''] @max-[32rem]/settings:mt-3 @max-[32rem]/settings:before:hidden"
              : ''}
              @max-[32rem]/settings:size-8 @max-[32rem]/settings:justify-center @max-[32rem]/settings:p-0
              {active
              ? '@max-[32rem]/settings:shadow-[inset_2px_0_0_var(--color-primary)]'
              : ''}"
          >
            <row.icon
              size={row.depth === 1 ? 16 : 14}
              strokeWidth={1.75}
              aria-hidden="true"
              class="shrink-0 {active ? 'text-primary' : ''} {row.depth === 1
                ? 'hidden @max-[32rem]/settings:block'
                : '@max-[32rem]/settings:size-4'}"
            />
            <span class="min-w-0 truncate @max-[32rem]/settings:sr-only">{row.label}</span>
          </button>
        {/snippet}
      </Tooltip>
    {/each}
  </div>
</nav>
