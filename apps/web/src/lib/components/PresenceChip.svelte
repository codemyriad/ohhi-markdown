<script lang="ts">
  /**
   * The tree's presence chip (foundations-plan P7): who is in a note, or
   * online in a shared folder, as ONE chip — at most two initials, the count
   * of people to their right (none when there is one: the initial says it),
   * vertically centred in the row. Replaces the row's loose initials and the
   * shared folder's `👥 N` badge. Each initial is an image named by the
   * person (`{testid}-peer`, `data-peer`), coloured from the presence band
   * (R5); with nobody, it renders NOTHING (R6). The cap and the order are
   * `capped()`'s (`presence.ts`).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { capped, initialsOf, type Peer } from '../presence.js'

  interface Props {
    peers: readonly Peer[]
    testid: string
  }

  let { peers, testid }: Props = $props()

  /** Initials shown before the count takes over. */
  const CHIP_CAP = 2

  const stack = $derived(capped(peers, CHIP_CAP))
  const t = $derived($LL.web.presence)
  const names = $derived(stack.all.map((p) => p.name).join(', '))
</script>

{#if stack.all.length > 0}
  <span
    data-testid={testid}
    title={names}
    class="inline-flex h-4 shrink-0 items-center gap-1 self-center rounded-full bg-base-200 py-0 pl-0.5 leading-none {stack.all.length > 1 ? 'pr-1.5' : 'pr-0.5'}"
  >
    <span class="inline-flex items-center">
      {#each stack.shown as peer, i (peer.name)}
        <span
          role="img"
          aria-label={peer.name}
          data-testid="{testid}-peer"
          data-peer={peer.name}
          class="inline-grid size-3.5 place-items-center rounded-full text-[8px] leading-none font-semibold ring-1 ring-base-200 {i > 0
            ? '-ml-1'
            : ''}"
          style="background: var(--ed-presence-{peer.color}); color: var(--ed-presence-fg-{peer.color})"
        >
          <span aria-hidden="true">{initialsOf(peer.name)}</span>
        </span>
      {/each}
    </span>
    {#if stack.all.length > 1}
      <span data-testid="{testid}-count" class="text-[10px] text-base-content/80 tabular-nums">
        <span aria-hidden="true">{stack.all.length}</span>
        {#if stack.more > 0}<span class="sr-only">{t.more({ count: stack.more })}</span>{/if}
      </span>
    {/if}
  </span>
{/if}
