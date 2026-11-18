<script lang="ts">
  /** The live region the `toast()` helper writes into. Mount once, in the shell. */
  import { melt } from '@melt-ui/svelte'
  import { CircleAlert, Info, TriangleAlert, X } from '@lucide/svelte'
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

  /**
   * Every notice sits on the opaque surface: a translucent tint over
   * whatever is behind (a note, a dialog's scrim) reads as see-through and
   * measures against the blend. The tone is carried by the border, its
   * heavier leading edge and the icon — never by the fill.
   */
  const tone = {
    error: { box: 'border-error', icon: CircleAlert, ink: 'text-error' },
    warn: { box: 'border-warning', icon: TriangleAlert, ink: 'text-warning' },
    info: { box: 'border-base-300', icon: Info, ink: 'text-info' },
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
    {@const Icon = tone[t.data.level].icon}
    <div
      use:melt={$content(t.id)}
      data-testid="toast"
      data-level={t.data.level}
      class="flex items-start gap-2 rounded-lg border border-l-4 bg-base-100 p-3 text-sm text-base-content shadow-xl {tone[t.data.level].box}"
    >
      <Icon size={16} aria-hidden="true" class="mt-0.5 shrink-0 {tone[t.data.level].ink}" />
      <div class="min-w-0 flex-1">
        <!-- Not a heading: a toast lands wherever the page's outline is, and an
             h3 straight after the page's h1 breaks heading-order (axe). Same
             weight, and Melt's title id still names the toast. -->
        <div use:melt={$title(t.id)} class="text-sm font-medium">{t.data.title}</div>
        {#if t.data.description}
          <!-- Body ink, not muted: hierarchy here is size and weight
               (docs/theming.md, the contrast floor). -->
          <p use:melt={$description(t.id)} class="mt-0.5 text-xs">
            {t.data.description}
          </p>
        {/if}
        {#if t.data.action || t.data.secondary}
          <div class="mt-2 flex flex-wrap items-center gap-2">
            {#if t.data.action}
              {@const action = t.data.action}
              <button
                type="button"
                data-testid="toast-action"
                onclick={() => action.run()}
                class="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-content hover:bg-primary/90"
              >
                {action.label}
              </button>
            {/if}
            {#if t.data.secondary}
              {@const secondary = t.data.secondary}
              <button
                type="button"
                data-testid="toast-secondary"
                onclick={() => secondary.run()}
                class="rounded border border-base-300 px-2.5 py-1 text-xs font-medium text-base-content hover:bg-base-200"
              >
                {secondary.label}
              </button>
            {/if}
          </div>
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
