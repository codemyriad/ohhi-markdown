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
  import type { LinkRef } from '@ohhi/index'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { HEADING } from '../ui/styles.js'

  interface Props {
    backlinks: LinkRef[]
    outgoing: LinkRef[]
    /** Null when nothing is open. */
    path: string | null
    onOpen: (path: string, opts?: { background?: boolean }) => void
    onCreate: (target: string) => void
  }

  let { backlinks, outgoing, path, onOpen, onCreate }: Props = $props()

  const t = $derived($LL.web.links)
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

  /** A link row: one line, comfortable to hit, no border between rows. */
  const row =
    'block w-full truncate rounded py-0.5 text-left text-xs hover:bg-base-200 hover:underline'

  function label(link: LinkRef): string {
    return link.alias ?? link.target + (link.anchor ? ` › ${link.anchor}` : '')
  }
</script>

<div data-testid="links-panel" class="flex flex-col">
  {#if !path}
    <p class="px-3 py-2 text-xs text-base-content/70">{t.no_note()}</p>
  {:else}
    <section class="border-b border-base-200 px-3 py-2">
      <h3 class="mb-1.5 {HEADING}">
        {t.backlinks()}
        <span data-testid="backlink-count" class="ml-1 font-normal tabular-nums text-base-content/70"
          >{backlinks.length}</span
        >
      </h3>
      {#if backlinks.length === 0}
        <p class="text-xs text-base-content/70">{t.no_backlinks()}</p>
      {:else}
        <ul class="space-y-2">
          {#each bySource as [source, refs] (source)}
            <li>
              <button
                data-testid="backlink-source:{source}"
                onclick={(e) => onOpen(source, { background: e.metaKey || e.ctrlKey })}
                class="{row} font-medium text-ed-wikilink"
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

    <section class="px-3 py-2">
      <h3 class="mb-1.5 {HEADING}">
        {t.outgoing()}
        <span data-testid="outgoing-count" class="ml-1 font-normal tabular-nums text-base-content/70"
          >{outgoing.length}</span
        >
      </h3>
      {#if outgoing.length === 0}
        <p class="text-xs text-base-content/70">{t.no_outgoing()}</p>
      {:else}
        <ul>
          {#each resolved as link (link.offset)}
            <li>
              <button
                data-testid="outgoing-link:{link.target}"
                onclick={(e) => onOpen(link.resolved!, { background: e.metaKey || e.ctrlKey })}
                class="{row} text-ed-wikilink"
                title={link.resolved!}
              >
                {label(link)}
              </button>
            </li>
          {/each}
        </ul>
        {#if unresolved.length > 0}
          <h4 class="mt-4 mb-1.5 {HEADING}">{t.not_created()}</h4>
          <ul>
            {#each unresolved as link (link.offset)}
              <li>
                <button
                  data-testid="unresolved-link:{link.target}"
                  onclick={() => onCreate(link.target)}
                  title={t.create({ target: link.target })}
                  class="{row} decoration-dotted text-ed-wikilink-unresolved"
                >
                  {label(link)}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        {#if missingEmbeds.length > 0}
          <h4 class="mt-4 mb-1.5 {HEADING}">{t.missing_attachments()}</h4>
          <ul>
            {#each missingEmbeds as link (link.offset)}
              <li
                data-testid="missing-embed:{link.target}"
                title={t.missing_attachment_title()}
                class="truncate py-0.5 text-xs text-base-content/70 line-through"
              >
                {link.target}
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>
  {/if}
</div>
