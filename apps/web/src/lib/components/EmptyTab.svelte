<script lang="ts">
  /**
   * What an empty tab shows (tab-groups B5): a quick-open over the vault,
   * inline in the pane. Firefox's new-tab page, with the vault as the thing
   * you can open.
   *
   * The rows come from the SAME provider the `Mod+O` palette uses
   * (`index.quickOpen`, recency-seeded, fuzzy-scored) — there is one matcher
   * in this app, and this is not a second one. Picking a note FILLS this tab
   * rather than opening another, because an empty tab is a slot waiting for a
   * note.
   */
  import { LL } from '@editor/i18n/i18n-svelte'

  export interface PickerRow {
    path: string
    spans?: { from: number; to: number }[]
  }

  interface Props {
    /** The quick-open provider; the shell hands it in so this stays a view. */
    search: (query: string) => Promise<PickerRow[]>
    onPick: (path: string) => void
    testid: string
  }

  let { search, onPick, testid }: Props = $props()

  let query = $state('')
  let rows = $state.raw<PickerRow[]>([])
  let active = $state(0)

  $effect(() => {
    const q = query
    void (async () => {
      const next = await search(q)
      // A slower query resolving late must not overwrite the current list.
      if (q === query) {
        rows = next.slice(0, 20)
        active = 0
      }
    })()
  })

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') active = rows.length ? (active + 1) % rows.length : 0
    else if (e.key === 'ArrowUp') active = rows.length ? (active - 1 + rows.length) % rows.length : 0
    else if (e.key === 'Enter') {
      const row = rows[active]
      if (row) onPick(row.path)
    } else return
    e.preventDefault()
  }

  function segments(text: string, spans: { from: number; to: number }[] = []) {
    if (!spans.length) return [{ text, hit: false }]
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

<div class="mx-auto flex h-full w-full max-w-lg flex-col gap-2 px-6 py-8" data-testid={testid}>
  <input
    bind:value={query}
    onkeydown={onKeydown}
    placeholder={$LL.web.tabs.picker.placeholder()}
    aria-label={$LL.web.tabs.picker.lead()}
    autocomplete="off"
    spellcheck="false"
    data-testid="{testid}-input"
    class="w-full rounded border border-base-300 bg-base-200 px-3 py-2 text-sm text-base-content placeholder:text-base-content/70 focus:outline-2 focus:outline-primary"
  />
  {#if rows.length === 0}
    <p class="px-1 py-6 text-center text-xs text-base-content/70">
      {$LL.web.tabs.picker.empty()}
    </p>
  {:else}
    <ul class="min-h-0 flex-1 overflow-y-auto">
      {#each rows as row, i (row.path)}
        <li>
          <button
            type="button"
            data-testid="{testid}-row"
            data-row-id={row.path}
            aria-current={i === active}
            onclick={() => onPick(row.path)}
            onmousemove={() => (active = i)}
            class="w-full truncate rounded px-2 py-1.5 text-left text-sm
              {i === active ? 'bg-primary/15 text-base-content' : 'text-base-content/70 hover:bg-base-200'}"
          >
            {#each segments(row.path, row.spans) as seg}{#if seg.hit}<mark
                  class="bg-transparent font-semibold text-primary">{seg.text}</mark
                >{:else}{seg.text}{/if}{/each}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>
