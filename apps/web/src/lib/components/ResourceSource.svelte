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
  import { OUTLINE_BUTTON } from '../ui/styles.js'
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
  let status = $state('')

  async function copy(): Promise<void> {
    if (!source.path) return
    try {
      await write(filePath(source.path, source.root, env.vault))
      status = t.copied()
    } catch {
      status = t.copy_failed()
    }
  }
</script>

<div class="mb-3 rounded border border-base-300 px-3 py-2" data-testid={testid}>
  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
    <span class="text-base-content/80">{label}</span>
    <span class="font-semibold text-base-content" data-testid="{testid}-name">{source.name}</span>
    <RootPill root={source.root} />
    {#if shadows}<span class="text-base-content/80">{t.shadows({ roots: shadows })}</span>{/if}
    {#if source.path}<code class="font-ed-mono text-base-content/80">{source.path}</code>{/if}
    <span class="ml-auto flex items-center gap-2">
      {#if source.path}
        <button
          type="button"
          class="{OUTLINE_BUTTON} px-2 py-0.5 font-medium text-base-content/80"
          data-testid="{testid}-copy"
          aria-label={t.copy_path_label({ what: source.path })}
          onclick={() => void copy()}
        >
          {t.copy_path()}
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
  <p class="text-xs text-base-content/70 empty:hidden" role="status">{status}</p>
</div>
