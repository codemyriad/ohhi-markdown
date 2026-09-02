<script lang="ts">
  import { PILL_TITLES, type PillStatus } from '../pill-status.js'

  interface Props {
    status: PillStatus
    testid: string
    label?: string
  }

  let { status, testid, label = '' }: Props = $props()

  const colors: Record<PillStatus, string> = {
    green: 'bg-emerald-500',
    yellow: 'bg-amber-400',
    red: 'bg-red-500',
    offline: 'bg-gray-400',
  }
</script>

<!-- Pure rendering of f(syncRecord) — no status logic lives here. -->
<!-- `relative` contains the absolutely-positioned sr-only span; without a
     positioned ancestor it anchors to the viewport, escapes the file tree's
     overflow clip, and stretches the page scroll height (one span per row). -->
<span
  data-testid={testid}
  data-status={status}
  title={PILL_TITLES[status]}
  class="relative inline-flex shrink-0 items-center gap-1.5"
>
  <span class="size-2.5 rounded-full {colors[status]}" aria-hidden="true"></span>
  {#if label}<span class="text-xs text-gray-600">{label}</span>{/if}
  <span class="sr-only">{PILL_TITLES[status]}</span>
</span>
