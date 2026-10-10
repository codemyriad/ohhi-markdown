<script lang="ts">
  /**
   * Settings › Appearance: the theme (applies at once) and a custom theme
   * from the vault's `.ohhi/themes/<name>/theme.css`, loaded by *Use custom*.
   * It opens with the theme's one source line (settings-shaping Fork 4):
   * the theme in use and where it came from — built in, or this vault.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { BUILTIN_THEMES, THEME_LABELS } from '@ohhi/ui/tokens'
  import type { ThemePref } from '../config.js'
  import { escapeHtml } from '../html.js'
  import { applyTheme, themePath, themeState, useCustomTheme } from '../theme.svelte.js'
  import { HEADING } from '../ui/styles.js'
  import ResourceSource from './ResourceSource.svelte'

  interface Props {
    /** Reads the vault's `.ohhi/`; absent with no vault open (no custom theme then). */
    readAppFile?: (path: string) => Promise<string | null>
  }

  let { readAppFile }: Props = $props()

  const t = $derived($LL.web.settings.appearance)
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`

  let customName = $state(themeState.pref.startsWith('custom:') ? themeState.pref.slice('custom:'.length) : '')
  let customError = $state('')

  async function loadCustom(): Promise<void> {
    if (!readAppFile) {
      customError = t.needs_vault()
      return
    }
    customError = (await useCustomTheme(customName, readAppFile)) ?? ''
  }

  /** The theme in use as a source line: a vault folder, or built in. */
  const source = $derived.by(() => {
    const custom = themeState.pref.startsWith('custom:') ? themeState.pref.slice('custom:'.length) : null
    return custom
      ? { name: custom, root: 'vault' as const, path: themePath(custom), shadows: [], fellBackFrom: null }
      : {
          name: (THEME_LABELS as Record<string, string>)[themeState.name] ?? themeState.name,
          root: 'builtin' as const,
          path: null,
          shadows: [],
          fellBackFrom: null,
        }
  })

  const options = $derived([
    { value: 'system' as ThemePref, label: t.system() },
    ...BUILTIN_THEMES.map((th) => ({ value: th as ThemePref, label: THEME_LABELS[th] })),
  ])
</script>

<ResourceSource label={$LL.web.settings.customise.source.theme()} testid="theme-source" {source} />
<fieldset>
  <legend class={HEADING}>{t.theme()}</legend>
  <div class="mt-2 flex flex-wrap gap-2" data-testid="theme-picker">
    {#each options as option (option.value)}
      <button
        type="button"
        data-testid="theme-{option.value}"
        aria-pressed={themeState.pref === option.value}
        onclick={() => applyTheme(option.value)}
        class="rounded border px-3 py-1.5 text-xs font-medium
          {themeState.pref === option.value
          ? 'border-primary bg-primary text-primary-content'
          : 'border-base-300 text-base-content/80 hover:bg-base-200'}"
      >
        {option.label}
      </button>
    {/each}
  </div>
  <!-- Sentences with inline markup render as html, the markup passed as
       arguments — the Edible pattern; user-derived text is escaped. -->
  <p class="mt-1 text-xs text-base-content/70">
    {@html t.theme_help({ system: `<em>${t.system()}</em>` })}
  </p>
</fieldset>
<div class="mt-4">
  <label for="custom-theme-name" class={HEADING}>{t.custom_theme()}</label>
  <div class="mt-1 flex gap-2">
    <input
      id="custom-theme-name"
      data-testid="custom-theme-name"
      bind:value={customName}
      placeholder={t.custom_placeholder()}
      class="min-w-0 flex-1 rounded border border-base-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
    />
    <button
      type="button"
      data-testid="custom-theme-load"
      onclick={() => void loadCustom()}
      disabled={!customName.trim()}
      class="rounded border border-base-300 px-3 py-1 text-xs font-medium text-base-content/80 hover:bg-base-200 disabled:opacity-50"
    >
      {t.use_custom()}
    </button>
  </div>
  {#if customError}
    <p data-testid="custom-theme-error" class="mt-1 text-xs text-error" role="alert">{customError}</p>
  {:else}
    <p class="mt-1 text-xs text-base-content/70">
      {@html t.custom_help({
        path: code(themePath(customName || '<name>')),
        template: code('libs/ui/src/styles/_template.css'),
        import_rule: code('@import'),
        url: code('url()'),
      })}
    </p>
  {/if}
</div>
