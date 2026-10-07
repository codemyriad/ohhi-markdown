<script lang="ts">
  import { pillTitle, type PillStatus } from '../pill-status.js'

  interface Props {
    status: PillStatus
    testid: string
    label?: string
    /**
     * Overrides the per-doc title for a pill that is about something else —
     * the vault rollup says "This vault: …" (P3). Still copy about `status`,
     * still from the dictionary; the pill itself decides nothing.
     */
    title?: string
    /**
     * The pill as a DOOR (sharing Fork 3-A): rendered as a button that does
     * this — same testid, same `data-status`, same unlayered dot. The status
     * logic stays out: the caller decides only where the door leads.
     */
    onclick?: () => void
    /** The door's accessible name (it says where it leads as well as the state). */
    ariaLabel?: string
    /** Words after the label (the door's room and people counts). */
    extra?: string
  }

  let { status, testid, label = '', title = '', onclick, ariaLabel, extra = '' }: Props = $props()

  const titleText = $derived(title || pillTitle(status))
</script>

{#snippet body()}
  <!-- Size, shape AND colour all come from libs/ui's UNLAYERED
       `.ed-sync-dot` / `[data-status] > .ed-sync-dot` rules, keyed on the
       data-status above. No Tailwind utilities and no custom property: a
       utility sits in @layer utilities and an inherited var can be set on any
       ancestor, and either would let a user theme repaint or hide the one
       signal that must never lie. -->
  <span class="ed-sync-dot" aria-hidden="true"></span>
  {#if label}<span class="text-xs text-base-content/70">{label}</span>{/if}
  {#if extra}<span class="text-xs text-base-content/70">· {extra}</span>{/if}
  <span class="sr-only">{titleText}</span>
{/snippet}

{#if onclick}
  <button
    type="button"
    data-testid={testid}
    data-status={status}
    title={titleText}
    aria-label={ariaLabel}
    {onclick}
    class="ed-sync-host relative inline-flex shrink-0 items-center gap-1.5 rounded px-1 py-0.5 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
  >
    {@render body()}
  </button>
{:else}

<!-- Pure rendering of f(syncRecord) — no status logic lives here.
     `ed-sync-host`: libs/ui's unlayered display, so a theme cannot hide the
     pill by hiding its own element. -->
<!-- `relative` contains the absolutely-positioned sr-only span; without a
     positioned ancestor it anchors to the viewport, escapes the file tree's
     overflow clip, and stretches the page scroll height (one span per row). -->
<span
  data-testid={testid}
  data-status={status}
  title={titleText}
  class="ed-sync-host relative inline-flex shrink-0 items-center gap-1.5"
>
  {@render body()}
</span>
{/if}
