<script lang="ts">
  /**
   * Settings › Editor (settings-shaping ST2, finding 6): how notes open and
   * read, gathered from the old General (the default view for new tabs) and
   * Layout (opening a note, line width, typewriter scrolling, the inline
   * title). Everything applies at once and is this device's config, so it
   * works with no vault open.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandRegistry } from '../commands.js'
  import { escapeHtml } from '../html.js'
  import { VIEW_MODES, type ViewMode } from '../panes.js'
  import { readState, setDefaultMode } from '../read.svelte.js'
  import type { SettingsLayout } from '../settings-host.js'
  import { HEADING } from '../ui/styles.js'
  import LayoutSettings from './LayoutSettings.svelte'

  interface Props {
    registry: CommandRegistry
    layout?: SettingsLayout
  }

  let { registry, layout }: Props = $props()

  const t = $derived($LL.web.settings.editor)
  const readingKey = $derived(registry.binding('view.toggle-reading') || 'Mod+E')
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`
</script>

<p class="text-xs text-base-content/70">{t.intro()}</p>
<fieldset class="mt-3">
  <legend class={HEADING}>{t.default_mode()}</legend>
  <div class="mt-2 flex flex-wrap gap-2" data-testid="default-mode">
    {#each VIEW_MODES as value (value)}
      <button
        type="button"
        data-testid="default-mode:{value}"
        aria-pressed={readState.defaultMode === value}
        onclick={() => setDefaultMode(value as ViewMode)}
        class="rounded border px-3 py-1.5 text-xs font-medium
          {readState.defaultMode === value
          ? 'border-primary bg-primary text-primary-content'
          : 'border-base-300 text-base-content/80 hover:bg-base-200'}"
      >
        {$LL.web.read.modes[value]()}
      </button>
    {/each}
  </div>
  <p class="mt-1 text-xs text-base-content/70">
    {@html t.default_mode_hint({ key: code(readingKey) })}
  </p>
</fieldset>
{#if layout}
  <div class="mt-4">
    <LayoutSettings {layout} part="editor" />
  </div>
{/if}
