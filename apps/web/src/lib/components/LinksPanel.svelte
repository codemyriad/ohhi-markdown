<script lang="ts">
  /**
   * Backlinks and outgoing links for the open note.
   *
   * Both panels are pinned open in Chris's real Obsidian layout, and the
   * measured link graph is what this vault is navigated by: 951 wikilinks
   * across 29% of notes, 204 targets with two or more inbound links, and a
   * 20-note `__index` map-of-content convention.
   *
   * The unresolved links get their own section rather than being hidden or
   * rendered like the rest: 12% of this vault's link targets resolve to
   * nothing, and they read as intent (`Edible Inbox`, `Myriad WORKING`) rather
   * than as typos. That section is a note-creation queue.
   */
  import type { LinkRef } from '@editor/index'

  interface Props {
    backlinks: LinkRef[]
    outgoing: LinkRef[]
    /** Null when nothing is open. */
    path: string | null
    onOpen: (path: string) => void
    onCreate: (target: string) => void
  }

  let { backlinks, outgoing, path, onOpen, onCreate }: Props = $props()

  const resolved = $derived(outgoing.filter((l) => l.resolved !== null))
  /** Notes you meant to write — 12% of this vault's link targets. */
  const unresolved = $derived(outgoing.filter((l) => l.resolved === null && !l.embed))
  /** `![[image.png]]` with nothing behind it: a missing FILE, not a note. */
  const missingEmbeds = $derived(outgoing.filter((l) => l.resolved === null && l.embed))

  /** Group backlinks by source note — one heading, its matching lines under it. */
  const bySource = $derived.by(() => {
    const groups = new Map<string, LinkRef[]>()
    for (const link of backlinks) {
      const list = groups.get(link.path)
      if (list) list.push(link)
      else groups.set(link.path, [link])
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  })

  function label(link: LinkRef): string {
    return link.alias ?? link.target + (link.anchor ? ` › ${link.anchor}` : '')
  }
</script>

<aside
  data-testid="links-panel"
  aria-label="Links"
  class="flex h-full w-72 shrink-0 flex-col overflow-y-auto border-l border-base-300 bg-base-100"
>
  {#if !path}
    <p class="p-4 text-xs text-base-content/70">Open a note to see its links.</p>
  {:else}
    <section class="border-b border-base-200 p-3">
      <h2 class="mb-2 text-xs font-semibold tracking-wide text-base-content/70 uppercase">
        Backlinks
        <span data-testid="backlink-count" class="ml-1 font-normal">{backlinks.length}</span>
      </h2>
      {#if backlinks.length === 0}
        <p class="text-xs text-base-content/70">No note links here yet.</p>
      {:else}
        <ul class="space-y-2">
          {#each bySource as [source, refs] (source)}
            <li>
              <button
                data-testid="backlink-source:{source}"
                onclick={() => onOpen(source)}
                class="w-full truncate text-left text-xs font-medium text-ed-wikilink hover:underline"
              >
                {source}
              </button>
              <ul class="mt-0.5 space-y-0.5">
                {#each refs as ref (ref.offset)}
                  <li
                    class="truncate border-l-2 border-base-300 pl-2 font-ed-mono text-[11px] text-base-content/70"
                    title={ref.context}
                  >
                    {ref.context}
                  </li>
                {/each}
              </ul>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="p-3">
      <h2 class="mb-2 text-xs font-semibold tracking-wide text-base-content/70 uppercase">
        Outgoing
        <span data-testid="outgoing-count" class="ml-1 font-normal">{outgoing.length}</span>
      </h2>
      {#if outgoing.length === 0}
        <p class="text-xs text-base-content/70">This note links nowhere yet.</p>
      {:else}
        <ul class="space-y-1">
          {#each resolved as link (link.offset)}
            <li>
              <button
                data-testid="outgoing-link:{link.target}"
                onclick={() => onOpen(link.resolved!)}
                class="w-full truncate text-left text-xs text-ed-wikilink hover:underline"
                title={link.resolved!}
              >
                {label(link)}
              </button>
            </li>
          {/each}
        </ul>
        {#if unresolved.length > 0}
          <h3
            class="mt-3 mb-1 text-[10px] font-semibold tracking-wide text-base-content/70 uppercase"
          >
            Not created yet
          </h3>
          <ul class="space-y-1">
            {#each unresolved as link (link.offset)}
              <li>
                <button
                  data-testid="unresolved-link:{link.target}"
                  onclick={() => onCreate(link.target)}
                  title="Create {link.target}.md"
                  class="w-full truncate text-left text-xs text-ed-wikilink-unresolved
                    decoration-dotted hover:underline"
                >
                  {label(link)}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if missingEmbeds.length > 0}
          <h3
            class="mt-3 mb-1 text-[10px] font-semibold tracking-wide text-base-content/70 uppercase"
          >
            Missing attachments
          </h3>
          <ul class="space-y-1">
            {#each missingEmbeds as link (link.offset)}
              <li
                data-testid="missing-embed:{link.target}"
                title="No file at this path — attachments are not created from a link"
                class="truncate text-xs text-base-content/70 line-through"
              >
                {link.target}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}
</aside>
