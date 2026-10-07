<script lang="ts">
  /** The live region the `toast()` helper writes into. Mount once, in the shell. */
  import { melt } from '@melt-ui/svelte'
  import { X } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { toaster } from './toaster.js'

  const {
    elements: { content, title, description, close },
    states: { toasts },
    actions: { portal },
  } = toaster

  /**
   * Dismissing a notice never strands focus. A toast's close button would
   * take focus on a click and then unmount, dropping focus to `<body>` — so
   * the floating drawer or panel the reader was in stops hearing its
   * Escape. A pointer press does not move focus here at all; a keyboard
   * dismissal (Enter or Space, which Melt's close handles on keydown) hands
   * focus back to where it was before it entered the notices.
   */
  let region = $state<HTMLElement>()
  let before: HTMLElement | null = null
  $effect(() => {
    const onFocusIn = (e: FocusEvent): void => {
      if (e.target instanceof HTMLElement && !region?.contains(e.target)) before = e.target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  })
  function giveFocusBack(e: KeyboardEvent): void {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const to = before
    queueMicrotask(() => {
      if (to?.isConnected) to.focus()
    })
  }

  const tone = {
    error: 'border-error/40 bg-error/10',
    warn: 'border-warning/40 bg-warning/10',
    info: 'border-base-300 bg-base-100',
  } as const
</script>

<!-- A landmark, so the notices are reachable by region navigation and axe's
     "content outside landmarks" rule is satisfied for real, not silenced. -->
<div
  bind:this={region}
  use:portal
  role="region"
  aria-label={$LL.web.ui.notifications()}
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
        <!-- Not a heading: a toast lands wherever the page's outline is, and an
             h3 straight after the page's h1 breaks heading-order (axe). Same
             weight, and Melt's title id still names the toast. -->
        <div use:melt={$title(t.id)} class="text-sm font-medium">{t.data.title}</div>
        {#if t.data.description}
          <!-- Body ink, not muted: the tone tints are translucent, so a toast
               over a dialog scrim is measured against the BLEND (#b8abab),
               where /70 falls to 3.82:1 and the axe gate fails. Hierarchy here
               is size and weight (docs/theming.md, the contrast floor). -->
          <p use:melt={$description(t.id)} class="mt-0.5 text-xs">
            {t.data.description}
          </p>
        {/if}
        {#if t.data.action}
          {@const action = t.data.action}
          <button
            type="button"
            data-testid="toast-action"
            onclick={() => action.run()}
            class="mt-2 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-content hover:bg-primary/90"
          >
            {action.label}
          </button>
        {/if}
      </div>
      <button
        use:melt={$close(t.id)}
        aria-label={$LL.web.ui.dismiss_notification()}
        onmousedown={(e) => e.preventDefault()}
        onkeydown={giveFocusBack}
        class="shrink-0 rounded p-0.5 text-base-content/70 hover:bg-base-200 hover:text-base-content"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  {/each}
</div>
