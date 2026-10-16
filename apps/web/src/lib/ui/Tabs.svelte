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
   * `size: 'segmented'` (horizontal only; Settings › AI's route picker, QA
   * round 1): a segmented control — the tabs as one pill-shaped group, the
   * active one raised — for a choice that filters what is under it, never a
   * second navigation.
   *
   * Settings' own nav is `SettingsNav.svelte` (a tree, with an icon rail in a
   * narrow pane — QA round 1), so the vertical form here has no group rules
   * and no narrow form of its own any more.
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
    /** `sm`: the compact 32 px row; `segmented`: a segmented control (both horizontal only). */
    size?: 'md' | 'sm' | 'segmented'
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
  }: Props = $props()

  const vertical = $derived(orientation === 'vertical')
  const compact = $derived(!vertical && size === 'sm')
  const segmented = $derived(!vertical && size === 'segmented')
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
      ? 'w-40 flex-col gap-0.5'
      : compact
        ? `min-w-0 flex-row items-stretch gap-0.5 overflow-x-auto [scrollbar-width:none] ${after ? '' : 'flex-1'}`
        : segmented
          ? 'flex-row flex-wrap gap-0.5 self-start rounded-md bg-base-200 p-0.5'
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
        class={segmented
          ? 'inline-flex h-6 items-center rounded px-2.5 text-xs whitespace-nowrap text-base-content hover:bg-base-100/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary data-[state=active]:bg-base-100 data-[state=active]:font-semibold data-[state=active]:shadow-sm'
          : compact
          ? 'inline-flex items-center gap-1 border-b-2 border-transparent px-1.5 text-[11px] text-base-content/70 hover:text-base-content focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary data-[state=active]:border-primary data-[state=active]:font-medium data-[state=active]:text-base-content'
          : `rounded px-3 py-1.5 text-left text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-content ${vertical ? '' : 'rounded-b-none'}`}
      >
        {#if tab.icon}<tab.icon size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
        {tab.label}
      </button>
    {/each}
  </div>
{/snippet}

<div class="contents">
  <div
    use:melt={$root}
    data-testid={testid}
    class="flex min-h-0 {vertical
      ? 'flex-row gap-4'
      : compact
        ? 'flex-col'
        : segmented
          ? 'flex-col gap-3'
          : 'flex-col gap-4'}"
  >
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
