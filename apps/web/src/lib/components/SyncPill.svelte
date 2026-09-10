<script lang="ts">
  import { pillTitle, type PillStatus } from '../pill-status.js'

  interface Props {
    status: PillStatus
    testid: string
    label?: string
  }

  let { status, testid, label = '' }: Props = $props()

  const title = $derived(pillTitle(status))
</script>

<!-- Pure rendering of f(syncRecord) — no status logic lives here. -->
<!-- `relative` contains the absolutely-positioned sr-only span; without a
     positioned ancestor it anchors to the viewport, escapes the file tree's
     overflow clip, and stretches the page scroll height (one span per row). -->
<span
  data-testid={testid}
  data-status={status}
  {title}
  class="relative inline-flex shrink-0 items-center gap-1.5"
>
  <!-- Size, shape AND colour all come from libs/ui's UNLAYERED
       `.ed-sync-dot` / `[data-status] > .ed-sync-dot` rules, keyed on the
       data-status above. No Tailwind utilities and no custom property: a
       utility sits in @layer utilities and an inherited var can be set on any
       ancestor, and either would let a user theme repaint or hide the one
       signal that must never lie. -->
  <span class="ed-sync-dot" aria-hidden="true"></span>
  {#if label}<span class="text-xs text-base-content/70">{label}</span>{/if}
  <span class="sr-only">{title}</span>
</span>
