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
    /** `sm`: the compact 32 px row (horizontal only). */
    size?: 'md' | 'sm'
    /** Controls at the compact row's right end (outside the tablist). */
    end?: Snippet
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
  }: Props = $props()

  const vertical = $derived(orientation === 'vertical')
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
  // (Settings' *Save and close* sending you to the tab that needs a name)
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
        ? 'min-w-0 flex-1 flex-row items-stretch gap-0.5'
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
          : `rounded px-3 py-1.5 text-left text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-content ${vertical ? '' : 'rounded-b-none'}`}
      >
        {#if tab.icon}<tab.icon size={14} strokeWidth={1.75} aria-hidden="true" />{/if}
        {tab.label}
      </button>
    {/each}
  </div>
{/snippet}

<div use:melt={$root} data-testid={testid} class="flex min-h-0 {vertical ? 'flex-row gap-4' : compact ? 'flex-col' : 'flex-col gap-4'}">
  {#if compact}
    <div class="flex h-8 shrink-0 items-stretch border-b border-base-300">
      {@render tabList()}
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
