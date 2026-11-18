<script lang="ts">
  /**
   * Settings › Editor (settings-shaping ST2, finding 6): how notes open and
   * read, gathered from the old General (the default view for new tabs) and
   * Layout (opening a note, line width, typewriter scrolling, the inline
   * title), and the typing aids (spelling, autocorrect, capitals). Everything
   * applies at once and is this device's config, so it works with no vault
   * open.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { CommandRegistry } from '../commands.js'
  import { escapeHtml } from '../html.js'
  import { VIEW_MODES, type ViewMode } from '../panes.js'
  import { readState, setDefaultMode } from '../read.svelte.js'
  import { setTypingAid, typingState } from '../typing.svelte.js'
  import type { SettingsLayout } from '../settings-host.js'
  import { CHOICE, CHOICE_OFF, CHOICE_ON, EYEBROW, GROUP, META } from '../ui/styles.js'
  import LayoutSettings from './LayoutSettings.svelte'

  interface Props {
    registry: CommandRegistry
    layout?: SettingsLayout
  }

  let { registry, layout }: Props = $props()

  const t = $derived($LL.web.settings.editor)
  const readingKey = $derived(registry.binding('view.toggle-reading') || 'Mod+E')
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`
  const AIDS = ['spellcheck', 'autocorrect', 'autocapitalize'] as const
</script>

<fieldset>
  <legend class={EYEBROW}>{t.default_mode()}</legend>
  <div class="mt-2 flex flex-wrap gap-2" data-testid="default-mode">
    {#each VIEW_MODES as value (value)}
      <button
        type="button"
        data-testid="default-mode:{value}"
        aria-pressed={readState.defaultMode === value}
        onclick={() => setDefaultMode(value as ViewMode)}
        class="{CHOICE} {readState.defaultMode === value ? CHOICE_ON : CHOICE_OFF}"
      >
        {$LL.web.read.modes[value]()}
      </button>
    {/each}
  </div>
  <p class="mt-2 {META}">
    {@html t.default_mode_hint({ key: code(readingKey) })}
  </p>
</fieldset>
<fieldset class={GROUP} data-testid="typing-aids">
  <legend class={EYEBROW}>{t.typing()}</legend>
  {#each AIDS as aid (aid)}
    <label class="mt-2 flex items-center gap-2 text-[13px] text-base-content">
      <input
        type="checkbox"
        data-testid="typing:{aid}"
        checked={typingState.aids[aid]}
        onchange={(e) => setTypingAid(aid, e.currentTarget.checked)}
      />
      {t[aid]()}
    </label>
  {/each}
  <p class="mt-2 {META}">{t.typing_hint()}</p>
</fieldset>
{#if layout}
  <div class={GROUP}>
    <LayoutSettings {layout} part="editor" />
  </div>
{/if}
