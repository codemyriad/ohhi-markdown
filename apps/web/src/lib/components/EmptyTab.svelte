<script lang="ts">
  /**
   * What an empty tab shows (tab-groups B5, redesigned in shell-polish P5): a
   * small **launcher**, not a list. Two verbs — start a note, find a note —
   * then a filter field, then one contained list that is folded *Recent*
   * until you type and *Results* once you do.
   *
   * The rows come from the SAME provider the `Mod+O` palette uses
   * (`index.quickOpen`, recency-seeded, fuzzy-scored) — there is one matcher
   * in this app, and this is not a second one. Picking a note FILLS this tab
   * rather than opening another, and so does *New note*, because an empty tab
   * is a slot waiting for a note.
   */
  import { ChevronDown, FilePlus, FileSearch, Search } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { segments, within, type Span } from '../highlight.js'
  import { CARD, HEADING } from '../ui/styles.js'

  export interface PickerRow {
    path: string
    spans?: Span[]
  }

  interface Props {
    /** The quick-open provider; the shell hands it in so this stays a view. */
    search: (query: string) => Promise<PickerRow[]>
    /** Recently opened notes in this vault, newest first, already filtered to what exists. */
    recent: () => string[]
    onPick: (path: string) => void
    /** Create an untitled note and fill THIS tab with it. */
    onNew: () => void
    /** Hand over to the full quick-open palette. */
    onOpenQuick: () => void
    /** The bindings for those two verbs, when the host knows them. */
    bindings?: { newNote: string; openQuick: string }
    testid: string
  }

  let { search, recent, onPick, onNew, onOpenQuick, bindings, testid }: Props = $props()

  let query = $state('')
  let rows = $state.raw<PickerRow[]>([])
  let active = $state(0)
  /** Folded by default: a wall of notes was the complaint this redesign answers. */
  let recentOpen = $state(false)

  const t = $derived($LL.web.tabs.picker)
  const recentRows = $derived<PickerRow[]>(recent().slice(0, 8).map((path) => ({ path })))
  /** One list is on screen at a time, and the keyboard acts on whichever it is. */
  const visible = $derived(query ? rows : recentOpen ? recentRows : [])

  $effect(() => {
    const q = query
    // An empty query is *Recent*'s to answer, so the index is never asked.
    if (!q) {
      rows = []
      return
    }
    void (async () => {
      const next = await search(q)
      // A slower query resolving late must not overwrite the current list.
      if (q === query) rows = next.slice(0, 20)
    })()
  })

  // Any change to what is listed puts the cursor back on the first row —
  // otherwise typing one more character silently moves the selection.
  $effect(() => {
    visible.length
    active = 0
  })

  function onKeydown(e: KeyboardEvent): void {
    const list = visible
    if (e.key === 'ArrowDown') active = list.length ? (active + 1) % list.length : 0
    else if (e.key === 'ArrowUp') active = list.length ? (active - 1 + list.length) % list.length : 0
    else if (e.key === 'Enter') {
      const row = list[active]
      if (row) onPick(row.path)
    } else return
    e.preventDefault()
  }

  /**
   * Sized by the PANE, not the window (`@container` below): a four-way split
   * on a wide monitor makes a pane as narrow as a phone. Under 18rem the two
   * verbs stack, their hotkey hints go (the palette still shows them) and the
   * gutter halves — and `min-w-0` + `truncate` keep a label from ever
   * spilling over its neighbour again. The variant is written out each time
   * because Tailwind's scanner only sees literal class strings.
   */
  const action = `flex min-w-0 items-center justify-center gap-2 ${CARD} px-3 py-2 text-sm font-medium text-base-content hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary`
</script>

<!-- A row's matched characters. `text-primary` on the row's `bg-primary/15`
     measures 3.8:1, so a tint keeps body ink — as `Palette.svelte`'s own hit
     marks do (docs/theming.md). One line: a newline inside a snippet renders
     as whitespace between a mark and the text beside it. -->
{#snippet marks(text: string, spans: Span[])}{#each segments(text, spans) as seg}{#if seg.hit}<mark class="rounded-sm bg-primary/25 text-base-content">{seg.text}</mark>{:else}{seg.text}{/if}{/each}{/snippet}

<div class="@container h-full w-full">
<div
  class="mx-auto flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto px-6 pt-[10vh] pb-8 @max-[18rem]:px-3"
  data-testid={testid}
>
  <div class="grid grid-cols-2 gap-2 @max-[18rem]:grid-cols-1">
    <button type="button" data-testid="{testid}-new" onclick={onNew} class={action}>
      <FilePlus size={16} strokeWidth={1.75} aria-hidden="true" class="text-base-content/70" />
      <span class="truncate">{t.new_note()}</span>
      {#if bindings?.newNote}
        <kbd class="font-ed-mono text-[10px] font-normal text-base-content/70 @max-[18rem]:hidden">
          {bindings.newNote}
        </kbd>
      {/if}
    </button>
    <button type="button" data-testid="{testid}-open" onclick={onOpenQuick} class={action}>
      <FileSearch size={16} strokeWidth={1.75} aria-hidden="true" class="text-base-content/70" />
      <span class="truncate">{t.open_note()}</span>
      {#if bindings?.openQuick}
        <kbd class="font-ed-mono text-[10px] font-normal text-base-content/70 @max-[18rem]:hidden">
          {bindings.openQuick}
        </kbd>
      {/if}
    </button>
  </div>

  <div class="relative">
    <Search
      size={16}
      strokeWidth={1.75}
      aria-hidden="true"
      class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-base-content/70"
    />
    <input
      bind:value={query}
      onkeydown={onKeydown}
      placeholder={t.placeholder()}
      aria-label={t.lead()}
      autocomplete="off"
      spellcheck="false"
      data-testid="{testid}-input"
      class="w-full {CARD} py-2 pr-3 pl-9 text-sm text-base-content placeholder:text-base-content/70 focus:outline-2 focus:outline-primary"
    />
  </div>

  <div class={CARD}>
    {#if query}
      <p class="px-3 pt-2.5 pb-1.5 {HEADING}">{t.results()}</p>
    {:else}
      <button
        type="button"
        data-testid="{testid}-recent"
        aria-expanded={recentOpen}
        onclick={() => (recentOpen = !recentOpen)}
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left {HEADING} hover:bg-base-200 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
      >
        <span class="flex-1">{t.recent()}</span>
        <ChevronDown
          size={14}
          strokeWidth={1.75}
          aria-hidden="true"
          class="transition-transform {recentOpen ? '' : '-rotate-90'}"
        />
      </button>
    {/if}

    {#if query || recentOpen}
      {#if visible.length === 0}
        <p class="px-3 pb-3 text-xs text-base-content/70">
          {query ? t.empty() : t.recent_empty()}
        </p>
      {:else}
        <ul class="max-h-72 overflow-y-auto px-1 pb-1">
          {#each visible as row, i (row.path)}
            {@const cut = row.path.lastIndexOf('/')}
            <li>
              <button
                type="button"
                data-testid="{testid}-row"
                data-row-id={row.path}
                aria-current={i === active}
                onclick={() => onPick(row.path)}
                onmousemove={() => (active = i)}
                class="flex w-full items-baseline gap-2 rounded px-2 py-1.5 text-left
                  {i === active ? 'bg-primary/15' : 'hover:bg-base-200'}"
              >
                <span class="shrink-0 truncate text-sm text-base-content">{@render marks(row.path.slice(cut + 1), within(row.spans, cut + 1, row.path.length))}</span>
                {#if cut > 0}
                  <span class="min-w-0 flex-1 truncate text-xs text-base-content/70">{@render marks(row.path.slice(0, cut), within(row.spans, 0, cut))}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>
</div>
