<script lang="ts">
  /**
   * The right sidebar (chrome-shaping U2, amended by shell-polish P2).
   *
   * The icon column is PERMANENT: collapsed, the rail is that column alone;
   * expanded, the panel opens beside it and the icons stay exactly where they
   * were. Each icon is a toggle (`aria-pressed` = its section is on screen)
   * that shows ITS section and folds the rest — clicking the icon of the only
   * open section is the way back out, so the same control both opens and
   * closes the rail. The foldable headers survive for a deliberate second
   * section. Sections are data, so U4 (This note) and U5 (Activity) add rows
   * here rather than markup.
   */
  import type { LucideIcon } from '@lucide/svelte'
  import { ChevronDown, ChevronsLeft, ChevronsRight } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import type { RailSectionId } from '../layout.js'
  import IconButton from '../ui/IconButton.svelte'
  import { HEADING } from '../ui/styles.js'

  export interface RailSection {
    id: RailSectionId
    label: string
    icon: LucideIcon
    /** Unread-style count on the icon and the header. */
    badge?: number
  }

  interface Props {
    sections: RailSection[]
    open: boolean
    folded: string[]
    onOpenChange: (open: boolean) => void
    onFoldChange: (id: string, folded: boolean) => void
    /** Make `id` the only open section (`layout.showOnly`). */
    onShowOnly: (id: string) => void
    /** Close the rail down to its icon column. */
    onCollapse: () => void
    children: Snippet<[string]>
  }

  let {
    sections,
    open,
    folded,
    onOpenChange,
    onFoldChange,
    onShowOnly,
    onCollapse,
    children,
  }: Props = $props()

  const t = $derived($LL.web.rail)
  /** Sections on screen right now — none of them while the rail is collapsed. */
  const shown = $derived(
    open ? sections.filter((s) => !folded.includes(s.id)).map((s) => s.id) : []
  )

  function pick(id: string): void {
    // The icon of the only section on screen is the way out: pressing a
    // pressed toggle un-presses it, and with nothing left to show the rail
    // has no reason to stay open.
    if (shown.length === 1 && shown[0] === id) {
      onCollapse()
      return
    }
    onShowOnly(id)
    if (!open) onOpenChange(true)
  }
</script>

<aside
  data-testid="right-rail"
  data-state={open ? 'expanded' : 'collapsed'}
  aria-label={t.label()}
  class="flex shrink-0 border-l border-base-300 bg-base-100"
>
  {#if open}
    <div class="flex w-72 min-w-0 flex-col border-r border-base-200">
      <div class="min-h-0 flex-1 overflow-y-auto">
        {#each sections as s (s.id)}
          {@const isFolded = folded.includes(s.id)}
          <section
            data-testid="rail-section:{s.id}"
            aria-labelledby="rail-heading-{s.id}"
            class="border-b border-base-200"
          >
            <h2 id="rail-heading-{s.id}" class="m-0">
              <button
                type="button"
                data-testid="rail-fold:{s.id}"
                aria-expanded={!isFolded}
                onclick={() => onFoldChange(s.id, !isFolded)}
                class="flex w-full items-center gap-2 px-3 py-2 text-left {HEADING} hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              >
                <span class="flex-1">{s.label}</span>
                {#if s.badge}
                  <span class="rounded-full bg-primary px-1.5 text-[10px] font-medium text-primary-content"
                    >{s.badge}</span
                  >
                {/if}
                <ChevronDown
                  size={14}
                  aria-hidden="true"
                  class="transition-transform {isFolded ? '-rotate-90' : ''}"
                />
              </button>
            </h2>
            {#if !isFolded}
              {@render children(s.id)}
            {/if}
          </section>
        {/each}
      </div>
    </div>
  {/if}
  <div class="flex w-10 shrink-0 flex-col items-center gap-1 py-1">
    {#each sections as s (s.id)}
      <span class="relative">
        <IconButton
          label={s.label}
          icon={s.icon}
          placement="left"
          pressed={shown.includes(s.id)}
          testid="rail-icon:{s.id}"
          onclick={() => pick(s.id)}
        />
        {#if s.badge}
          <span
            aria-hidden="true"
            class="pointer-events-none absolute -top-0.5 -right-0.5 rounded-full bg-primary px-1 text-[9px] font-medium text-primary-content"
          >
            {s.badge}
          </span>
        {/if}
      </span>
    {/each}
    <div class="mt-auto">
      {#if open}
        <IconButton
          label={t.collapse()}
          icon={ChevronsRight}
          placement="left"
          testid="rail-collapse"
          onclick={onCollapse}
        />
      {:else}
        <IconButton
          label={t.expand()}
          icon={ChevronsLeft}
          placement="left"
          testid="rail-expand"
          onclick={() => onOpenChange(true)}
        />
      {/if}
    </div>
  </div>
</aside>
