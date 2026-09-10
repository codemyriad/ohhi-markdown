<script lang="ts">
  /**
   * The right sidebar (chrome-shaping U2, the Cursor-style rail): collapsed,
   * a column of section icons; expanded, the sections stacked, each with a
   * foldable header. Clicking an icon while collapsed expands the rail and
   * unfolds that section. Sections are data, so U4 (This note) and U5
   * (Activity) add rows here rather than markup.
   */
  import type { LucideIcon } from '@lucide/svelte'
  import { ChevronDown, ChevronsLeft, ChevronsRight } from '@lucide/svelte'
  import type { Snippet } from 'svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
  import IconButton from '../ui/IconButton.svelte'

  export interface RailSection {
    id: string
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
    children: Snippet<[string]>
  }

  let { sections, open, folded, onOpenChange, onFoldChange, children }: Props = $props()

  const t = $derived($LL.web.rail)

  function show(id: string): void {
    onFoldChange(id, false)
    onOpenChange(true)
  }
</script>

{#if open}
  <aside
    data-testid="right-rail"
    data-state="expanded"
    aria-label={t.label()}
    class="flex w-72 shrink-0 flex-col border-l border-base-300 bg-base-100"
  >
    <div class="flex items-center justify-end border-b border-base-200 px-1 py-0.5">
      <IconButton
        label={t.collapse()}
        icon={ChevronsRight}
        placement="left"
        testid="rail-collapse"
        onclick={() => onOpenChange(false)}
      />
    </div>
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
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold tracking-wide text-base-content/70 uppercase hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
            >
              <s.icon size={14} aria-hidden="true" />
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
  </aside>
{:else}
  <aside
    data-testid="right-rail"
    data-state="collapsed"
    aria-label={t.label()}
    class="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-base-300 bg-base-100 py-1"
  >
    {#each sections as s (s.id)}
      <span class="relative">
        <IconButton
          label={s.label}
          icon={s.icon}
          placement="left"
          testid="rail-icon:{s.id}"
          onclick={() => show(s.id)}
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
      <IconButton
        label={t.expand()}
        icon={ChevronsLeft}
        placement="left"
        testid="rail-expand"
        onclick={() => onOpenChange(true)}
      />
    </div>
  </aside>
{/if}
