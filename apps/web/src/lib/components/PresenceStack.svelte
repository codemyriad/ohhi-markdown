<script lang="ts">
  /**
   * Initials for the people in a note or a shared folder (sharing E1, Fork
   * 4-A): at most three, then "+N" — the cap and the order are `capped()`'s
   * (`presence.ts`), never decided here. Each initial is an image named by
   * the person (`aria-label` + `title`), coloured from the presence band
   * (`--ed-presence-N` with its own ink `--ed-presence-fg-N`, 4.5:1 per theme),
   * never from the sync band (R5). With nobody, it renders NOTHING (R6).
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { capped, initialsOf, type Peer } from '../presence.js'

  interface Props {
    peers: readonly Peer[]
    /** The stack's testid; each initial carries `{testid}-peer` and `data-peer`. */
    testid: string
    size?: 'sm' | 'md'
  }

  let { peers, testid, size = 'sm' }: Props = $props()

  const stack = $derived(capped(peers))
  const t = $derived($LL.web.presence)
  const dim = $derived(size === 'md' ? 'size-5 text-[10px]' : 'size-4 text-[9px]')
</script>

{#if stack.all.length > 0}
  <span data-testid={testid} class="inline-flex shrink-0 items-center">
    {#each stack.shown as peer, i (peer.name)}
      <span
        role="img"
        aria-label={peer.name}
        title={peer.name}
        data-testid="{testid}-peer"
        data-peer={peer.name}
        class="inline-grid {dim} place-items-center rounded-full leading-none font-semibold ring-[1.5px] ring-base-100 {i > 0
          ? '-ml-1'
          : ''}"
        style="background: var(--ed-presence-{peer.color}); color: var(--ed-presence-fg-{peer.color})"
      >
        <span aria-hidden="true">{initialsOf(peer.name)}</span>
      </span>
    {/each}
    {#if stack.more > 0}
      <span
        role="img"
        aria-label={t.more({ count: stack.more })}
        title={stack.all
          .slice(stack.shown.length)
          .map((p) => p.name)
          .join(', ')}
        class="ml-0.5 text-[10px] text-base-content/70"
      >
        <span aria-hidden="true">+{stack.more}</span>
      </span>
    {/if}
  </span>
{/if}
