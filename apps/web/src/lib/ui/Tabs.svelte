<script lang="ts">
  /**
   * Tabs with the keyboard model assistive tech expects (R1.1): one tab stop
   * on the list, arrows move between tabs (orientation-aware), the active
   * panel is the only one in the DOM. Melt's tabs builder does the ARIA.
   */
  import { createTabs, melt } from '@melt-ui/svelte'
  import type { Snippet } from 'svelte'

  export interface Tab {
    value: string
    label: string
    testid?: string
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
  }

  let {
    tabs,
    value = $bindable(tabs[0]?.value ?? ''),
    orientation = 'horizontal',
    label,
    testid,
    panel,
  }: Props = $props()

  const vertical = $derived(orientation === 'vertical')
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
</script>

<div use:melt={$root} data-testid={testid} class="flex min-h-0 gap-4 {vertical ? 'flex-row' : 'flex-col'}">
  <div
    use:melt={$list}
    aria-label={label}
    class="flex shrink-0 {vertical ? 'w-40 flex-col gap-0.5' : 'flex-row gap-1 border-b border-base-300'}"
  >
    {#each tabs as tab (tab.value)}
      <button
        use:melt={$trigger(tab.value)}
        role="tab"
        id={tabId(tab.value)}
        aria-selected={$current === tab.value}
        aria-controls={panelId(tab.value)}
        data-testid={tab.testid}
        class="rounded px-3 py-1.5 text-left text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary data-[state=active]:bg-primary data-[state=active]:font-medium data-[state=active]:text-primary-content
          {vertical ? '' : 'rounded-b-none'}"
      >
        {tab.label}
      </button>
    {/each}
  </div>
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
