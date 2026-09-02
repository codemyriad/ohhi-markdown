<script lang="ts">
  /**
   * One overlay, three providers: quick-open (Mod+O), command palette
   * (Mod+Shift+P) and vault search (Mod+Shift+F) differ only in what fills the
   * list and what Enter does. Building three overlays would have meant three
   * keyboard models and three focus bugs.
   *
   * Everything it renders is already in memory — the index answers in under a
   * millisecond on the real vault — so there is no debounce, no spinner and no
   * loading state. That absence is the feature (parent R4.1).
   */
  import type { Snippet } from 'svelte'
  import Modal from './Modal.svelte'

  export interface PaletteRow {
    /** Stable key AND what Enter acts on. */
    id: string
    title: string
    /** Highlight ranges into `title`. */
    spans?: { from: number; to: number }[]
    subtitle?: string
    /** Right-aligned hint: a key binding, a match count. */
    hint?: string
    /** Extra lines under the row (search snippets). */
    detail?: { text: string; spans: { from: number; to: number }[] }[]
    /** Character offset to land the caret on when this row is picked. */
    offset?: number
  }

  interface Props {
    placeholder: string
    testid: string
    rows: PaletteRow[]
    /** Shown instead of the list when there are no rows. */
    empty?: string
    query: string
    onQuery: (q: string) => void
    /** Search results carry snippets; the switcher does not need the room. */
    width?: 'md' | 'lg'
    onPick: (row: PaletteRow) => void
    onClose: () => void
    footer?: Snippet
  }

  let {
    placeholder,
    testid,
    rows,
    empty,
    query,
    onQuery,
    width = 'md',
    onPick,
    onClose,
    footer,
  }: Props = $props()

  let active = $state(0)
  let listEl = $state<HTMLUListElement>()

  // Any change to the result set puts the cursor back on the best match —
  // otherwise typing one more character silently moves the selection.
  $effect(() => {
    rows.length
    active = 0
  })

  function move(delta: number): void {
    if (rows.length === 0) return
    active = (active + delta + rows.length) % rows.length
    listEl?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const row = rows[active]
      if (row) onPick(row)
    } else if (e.key === 'Home') {
      e.preventDefault()
      active = 0
    } else if (e.key === 'End') {
      e.preventDefault()
      active = Math.max(rows.length - 1, 0)
    }
  }

  /** Split `text` into alternating plain/highlighted segments. */
  function segments(
    text: string,
    spans: { from: number; to: number }[] = []
  ): { text: string; hit: boolean }[] {
    if (spans.length === 0) return [{ text, hit: false }]
    const out: { text: string; hit: boolean }[] = []
    let at = 0
    for (const span of spans) {
      const from = Math.max(0, Math.min(span.from, text.length))
      const to = Math.max(from, Math.min(span.to, text.length))
      if (from > at) out.push({ text: text.slice(at, from), hit: false })
      if (to > from) out.push({ text: text.slice(from, to), hit: true })
      at = to
    }
    if (at < text.length) out.push({ text: text.slice(at), hit: false })
    return out
  }
</script>

<Modal layer="palette" align="top" label={placeholder} {testid} {width} {onClose}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div onkeydown={onKeydown} role="none">
    <input
      data-testid="{testid}-input"
      value={query}
      oninput={(e) => onQuery(e.currentTarget.value)}
      {placeholder}
      aria-label={placeholder}
      autocomplete="off"
      spellcheck="false"
      class="w-full border-b border-base-300 bg-transparent px-4 py-3 text-sm text-base-content
        placeholder:text-base-content/40 focus:outline-none"
    />

    {#if rows.length === 0}
      <p data-testid="{testid}-empty" class="px-4 py-6 text-center text-xs text-base-content/60">
        {empty ?? 'No matches'}
      </p>
    {:else}
      <ul
        bind:this={listEl}
        data-testid="{testid}-results"
        class="max-h-[52vh] overflow-y-auto py-1"
      >
        {#each rows as row, i (row.id)}
          <li data-row={i}>
            <button
              type="button"
              data-testid="{testid}-row"
              data-row-id={row.id}
              aria-current={i === active}
              onclick={() => onPick(row)}
              onmousemove={() => (active = i)}
              class="flex w-full flex-col gap-0.5 px-4 py-2 text-left
                {i === active ? 'bg-primary/15' : 'hover:bg-base-200'}"
            >
              <span class="flex w-full items-baseline gap-2">
                <span class="min-w-0 flex-1 truncate text-sm text-base-content">
                  {#each segments(row.title, row.spans) as seg}{#if seg.hit}<mark
                        class="bg-transparent font-semibold text-primary">{seg.text}</mark
                      >{:else}{seg.text}{/if}{/each}
                </span>
                {#if row.hint}
                  <span class="shrink-0 font-ed-mono text-[10px] text-base-content/50"
                    >{row.hint}</span
                  >
                {/if}
              </span>
              {#if row.subtitle}
                <span class="truncate text-xs text-base-content/60">{row.subtitle}</span>
              {/if}
              {#each row.detail ?? [] as line}
                <span class="truncate font-ed-mono text-[11px] text-base-content/70">
                  {#each segments(line.text, line.spans) as seg}{#if seg.hit}<mark
                        class="rounded-sm bg-primary/25 text-base-content">{seg.text}</mark
                      >{:else}{seg.text}{/if}{/each}
                </span>
              {/each}
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    {#if footer}
      <div class="border-t border-base-300 px-4 py-2 text-[11px] text-base-content/50">
        {@render footer()}
      </div>
    {/if}
  </div>
</Modal>
