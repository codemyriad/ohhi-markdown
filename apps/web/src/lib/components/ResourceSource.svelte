<script lang="ts">
  /**
   * One line on a file-backed Settings section (settings-shaping Fork 4,
   * quiet-shell Fork 8's promise): which file is in use, the root it came
   * from as a pill, what it shadows, and — when the chosen file could not be
   * used — that the built-in stands in. *Copy path* copies the file's path
   * (absolute on the desktop; there is no reveal: the desktop app carries no
   * opener), and *Customise* moves Settings to the overview. Settings ›
   * Customise is where every kind is listed; each section has this one line.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Snippet } from 'svelte'
  import { filePath, type Source } from '../customise-overview.js'
  import { getSettingsEnv } from '../settings-host.js'
  import { BUTTON_SM, MUTED } from '../ui/styles.js'
  import RootPill from './RootPill.svelte'

  interface Props {
    /** What the file is: "Layout file", "Theme". */
    label: string
    source: Source
    /** The test id of the line: `<testid>`, its copy button `<testid>-copy`. */
    testid: string
    /** A sentence after the line (Layout: the settings below are device overrides). */
    children?: Snippet
    /** Injected for the tests. */
    write?: (text: string) => Promise<void>
  }

  let { label, source, testid, children, write = (text) => navigator.clipboard.writeText(text) }: Props = $props()

  const env = getSettingsEnv()
  const t = $derived($LL.web.settings.customise)
  const shadows = $derived(source.shadows.map((r) => t.from[r]()).join(', '))
  /** The button says *Copied* / *Could not copy* for two seconds; the live region says it too, then clears. */
  let done = $state<'copied' | 'failed' | null>(null)
  let reset: ReturnType<typeof setTimeout> | undefined

  async function copy(): Promise<void> {
    if (!source.path) return
    clearTimeout(reset)
    done = null
    try {
      await write(filePath(source.path, source.root, env.vault))
      done = 'copied'
    } catch {
      done = 'failed'
    }
    reset = setTimeout(() => (done = null), 2000)
  }
  $effect(() => () => clearTimeout(reset))
  const said = $derived(done === 'copied' ? t.copied() : done === 'failed' ? t.copy_failed() : '')
</script>

<div class="mb-6 rounded-lg border border-base-300 px-3 py-2" data-testid={testid}>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span class={MUTED}>{label}</span>
    <span class="font-semibold text-base-content" data-testid="{testid}-name">{source.name}</span>
    <RootPill root={source.root} />
    {#if shadows}<span class={MUTED}>{t.shadows({ roots: shadows })}</span>{/if}
    {#if source.path}<code class="font-ed-mono {MUTED}">{source.path}</code>{/if}
    <span class="ml-auto flex items-center gap-2">
      {#if source.path}
        <button
          type="button"
          class={BUTTON_SM}
          data-testid="{testid}-copy"
          aria-label={t.copy_path_label({ what: source.path })}
          onclick={() => void copy()}
        >
          {said || t.copy_path()}
        </button>
      {/if}
      <button
        type="button"
        class="font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
        data-testid="{testid}-overview"
        aria-label={t.source.overview_label()}
        onclick={() => env.openSection('customise')}
      >
        {t.source.overview()}
      </button>
    </span>
  </div>
  {#if source.fellBackFrom}
    <p class="mt-1 text-xs text-error" data-testid="{testid}-fallback">{t.fell_back({ name: source.fellBackFrom })}</p>
  {/if}
  {#if children}<p class="mt-1 text-xs text-base-content/70">{@render children()}</p>{/if}
  <p class="sr-only" role="status" data-testid="{testid}-status">{said}</p>
</div>
