<script lang="ts">
  /**
   * Tabs with the keyboard model assistive tech expects (R1.1): one tab stop
   * on the list, arrows move between tabs (orientation-aware), the active
   * panel is the only one in the DOM. Melt's tabs builder does the ARIA.
   *
   * `size: 'sm'` (horizontal only; the dock's panel, Round 3 Q3) is a 32 px
   * row — the note tab strip's height — of 11 px labels, each beside its
   * icon, with `end` (the row's own controls) at its right end, outside the
   * tablist so the list holds tabs and nothing else.
   *
   * `collapse` (vertical only; Settings in a narrow pane): the tabs measure
   * their own width (a container, not the viewport — a split pane is narrow
   * on a wide screen). Below 32rem the side list gives way to a native
   * `<select>` above the panel, holding the same choices; the panel then has
   * the full width.
   */
  import type { LucideIcon } from '@lucide/svelte'
  import { createTabs, melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'

  export interface Tab {
    value: string
    label: string
    testid?: string
    /** Drawn beside the label (`aria-hidden`); the label still names the tab. */
    icon?: LucideIcon
    /**
     * Vertical only: a rule above this tab, starting a new group (Settings'
     * three groups). Drawn by the tab's own `::before`, so the tablist holds
     * tabs and nothing else.
     */
    separated?: boolean
  }

  interface Props {
    tabs: Tab[]
    /** Bindable: the active tab's value. */
    value?: string
    orientation?: 'horizontal' | 'vertical'
    /** Accessible name of the tab list. */
    label: string
    testid?: string
    panel: Snippet<[string]>
    /** `sm`: the compact 32 px row (horizontal only). */
    size?: 'md' | 'sm'
    /** Controls at the compact row's right end (outside the tablist). */
    end?: Snippet
    /**
     * Compact only: controls right after the last tab, outside the tablist
     * (a collection's view menu and its "+ add a view", like a browser's
     * new-tab button). The row's free space then sits between them and `end`.
     */
    after?: Snippet
    /**
     * Compact only: room the row keeps free at its right edge, as a CSS
     * length — what floats over it there (the dock's closed strip,
     * `var(--ed-dock-clear)`).
     */
    endInset?: string
    /** Vertical only: below a 32rem-wide container the list becomes a `<select>`. */
    collapse?: boolean
  }

  let {
    tabs,
    value = $bindable(tabs[0]?.value ?? ''),
    orientation = 'horizontal',
    label,
    testid,
    panel,
    size = 'md',
    end,
    after,
    endInset,
    collapse = false,
  }: Props = $props()

  const vertical = $derived(orientation === 'vertical')
  const collapsing = $derived(vertical && collapse)
  const compact = $derived(!vertical && size === 'sm')
  // Melt 0.86 emits role/tabindex/data-state but no aria-selected, and points
  // the panel's aria-labelledby at the bare value string; the ids below make
  // the tab ↔ panel relationship real (and axe-clean).
  const uid = $props.id()
  const tabId = (v: string): string => `${uid}-tab-${v}`
  const panelId = (v: string): string => `${uid}-panel-${v}`

  const {
    elements: { root, list, trigger, content },
    states: { value: current },
  } = createTabs({
    // svelte-ignore state_referenced_locally -- seed only; onValueChange keeps the binding in step
    defaultValue: value,
    // svelte-ignore state_referenced_locally -- fixed at mount
    orientation,
    loop: true,
    onValueChange: ({ next }) => {
      value = next
      return next
    },
  })
  // …and the other way: a value the PARENT sets selects that tab. Without
  // this, Melt kept its own copy and a bound `value` written from outside
  // (a Settings section's link to another section, or the view tab's arg)
  // changed nothing on screen.
  $effect(() => {
    const next = value
    if (next && tabs.some((t) => t.value === next) && current.get() !== next) current.set(next)
  })
</script>

{#snippet tabList()}
  <div
    use:melt={$list}
    aria-label={label}
    class="flex shrink-0 {vertical
      ? `w-40 flex-col gap-0.5 ${collapsing ? '@max-[32rem]:hidden' : ''}`
      : compact
        ? `min-w-0 flex-row items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] ${after ? '' : 'flex-1'}`
        : 'flex-row gap-1 border-b border-base-300'}"
  >
    {#each tabs as tab (tab.value)}
      <button
        use:melt={$trigger(tab.value)}
        role="tab"
        id={tabId(tab.value)}
        aria-selected={$current === tab.value}
        aria-controls={panelId(tab.value)}
        data-testid={tab.testid}
        class={compact
          ? 'inline-flex items-center gap-1 border-b-2 border-transparent px-1.5 text-[11px] text-base-content/70 hover:text-base-content focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-base-content'
          : `rounded px-3 py-1.5 text-left text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-content ${vertical ? '' : 'rounded-b-none'} ${vertical && tab.separated ? "relative mt-3 before:pointer-events-none before:absolute before:inset-x-2 before:-top-2 before:border-t before:border-base-300 before:content-['']" : ''}`}
      >
        {#if tab.icon}<tab.icon size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
        {tab.label}
      </button>
    {/each}
  </div>
{/snippet}

<div class={collapsing ? '@container h-full min-h-0' : 'contents'}>
  <div
    use:melt={$root}
    data-testid={testid}
    class="flex min-h-0 {vertical
      ? `flex-row gap-4 ${collapsing ? '@max-[32rem]:flex-col @max-[32rem]:gap-3' : ''}`
      : compact
        ? 'flex-col'
        : 'flex-col gap-4'}"
  >
    {#if collapsing}
      <select
        aria-label={label}
        data-testid={testid ? `${testid}-select` : undefined}
        value={$current}
        onchange={(e) => current.set(e.currentTarget.value)}
        class="hidden w-full rounded border border-base-300 bg-base-100 px-2 py-1.5 text-sm text-base-content focus:border-primary focus:outline-none @max-[32rem]:block"
      >
        {#each tabs as tab (tab.value)}
          <option value={tab.value}>{tab.label}</option>
        {/each}
      </select>
    {/if}
    {#if compact}
      <div class="flex h-8 shrink-0 items-stretch border-b border-base-300" style:padding-right={endInset}>
        {@render tabList()}
        {#if after}
          <div class="flex shrink-0 items-center gap-0.5 px-1">{@render after()}</div>
          <div class="min-w-0 flex-1"></div>
        {/if}
        {#if end}
          <div class="flex shrink-0 items-center gap-0.5 px-1">{@render end()}</div>
        {/if}
      </div>
    {:else}
      {@render tabList()}
    {/if}
    {#each tabs as tab (tab.value)}
      {#if $current === tab.value}
        <div
          use:melt={$content(tab.value)}
          id={panelId(tab.value)}
          aria-labelledby={tabId(tab.value)}
          class="min-h-0 min-w-0 flex-1 focus:outline-none"
        >
          {@render panel(tab.value)}
        </div>
      {/if}
    {/each}
  </div>
</div>
