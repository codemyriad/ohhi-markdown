<script lang="ts">
  /** The live region the `toast()` helper writes into. Mount once, in the shell. */
  import { melt } from '@melt-ui/svelte'
  import { X } from '@lucide/svelte'
  import { toaster } from './toaster.js'

  const {
    elements: { content, title, description, close },
    states: { toasts },
    actions: { portal },
  } = toaster

  const tone = {
    error: 'border-error/40 bg-error/10',
    warn: 'border-warning/40 bg-warning/10',
    info: 'border-base-300 bg-base-100',
  } as const
</script>

<!-- A landmark, so the notices are reachable by region navigation and axe's
     "content outside landmarks" rule is satisfied for real, not silenced. -->
<div
  use:portal
  role="region"
  aria-label="Notifications"
  class="fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100%-2rem)] flex-col gap-2"
>
  {#each $toasts as t (t.id)}
    <div
      use:melt={$content(t.id)}
      data-testid="toast"
      data-level={t.data.level}
      class="flex items-start gap-2 rounded-lg border p-3 text-sm text-base-content shadow-xl {tone[t.data.level]}"
    >
      <div class="min-w-0 flex-1">
        <h3 use:melt={$title(t.id)} class="text-sm font-medium">{t.data.title}</h3>
        {#if t.data.description}
          <p use:melt={$description(t.id)} class="mt-0.5 text-xs text-base-content/70">
            {t.data.description}
          </p>
        {/if}
      </div>
      <button
        use:melt={$close(t.id)}
        aria-label="Dismiss notification"
        class="shrink-0 rounded p-0.5 text-base-content/70 hover:bg-base-200 hover:text-base-content"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  {/each}
</div>
