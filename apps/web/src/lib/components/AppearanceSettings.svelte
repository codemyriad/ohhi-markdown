<script lang="ts">
  /**
   * Settings › Appearance: the theme (applies at once) and a custom theme
   * from the vault's `.ohhi/themes/<name>/theme.css`, loaded by *Use custom*.
   * It opens with the theme's one source line (settings-shaping Fork 4):
   * the theme in use and where it came from — built in, or this vault.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { BUILTIN_THEMES } from '@ohhi/ui/tokens'
  import type { ThemePref } from '../config.js'
  import { escapeHtml } from '../html.js'
  import { applyTheme, builtinThemeLabel, themePath, themeState, useCustomTheme } from '../theme.svelte.js'
  import { BUTTON, CHOICE, CHOICE_OFF, CHOICE_ON, EYEBROW, GROUP, META, ROW_SETTING } from '../ui/styles.js'
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
          name: builtinThemeLabel($LL, themeState.name) ?? themeState.name,
          root: 'builtin' as const,
          path: null,
          shadows: [],
          fellBackFrom: null,
        }
  })

  const options = $derived([
    { value: 'system' as ThemePref, label: t.system() },
    ...BUILTIN_THEMES.map((th) => ({ value: th as ThemePref, label: builtinThemeLabel($LL, th) ?? th })),
  ])
</script>

<ResourceSource label={$LL.web.settings.customise.source.theme()} testid="theme-source" {source} />
<fieldset>
  <legend class={EYEBROW}>{t.theme()}</legend>
  <div class="mt-2 flex flex-wrap gap-2" data-testid="theme-picker">
    {#each options as option (option.value)}
      <button
        type="button"
        data-testid="theme-{option.value}"
        aria-pressed={themeState.pref === option.value}
        onclick={() => applyTheme(option.value)}
        class="{CHOICE} {themeState.pref === option.value ? CHOICE_ON : CHOICE_OFF}"
      >
        {option.label}
      </button>
    {/each}
  </div>
  <!-- Sentences with inline markup render as html, the markup passed as
       arguments — the Edible pattern; user-derived text is escaped. -->
  <p class="mt-2 {META}">
    {@html t.theme_help({ system: `<em>${t.system()}</em>` })}
  </p>
</fieldset>
<!-- A theme of your own (QA round 1): the field, its Use button on the same
     line, and the path and the rules as ONE hint line under them — the
     input's description — never a wrapped label beside it. -->
<div class={GROUP}>
  <h3 class={EYEBROW}>{t.custom_theme()}</h3>
  <label for="custom-theme-name" class="mt-2 block {ROW_SETTING}">{t.custom_label()}</label>
  <div class="mt-1 flex max-w-md gap-2">
    <input
      id="custom-theme-name"
      data-testid="custom-theme-name"
      bind:value={customName}
      placeholder={t.custom_placeholder()}
      aria-describedby="custom-theme-hint"
      class="h-7 min-w-0 flex-1 rounded-md border border-base-300 bg-base-100 px-2 font-ed-mono text-xs text-base-content focus:border-primary focus:outline-none"
    />
    <button
      type="button"
      data-testid="custom-theme-load"
      onclick={() => void loadCustom()}
      disabled={!customName.trim()}
      class="{BUTTON} h-7"
    >
      {t.use_custom()}
    </button>
  </div>
  {#if customError}
    <p id="custom-theme-hint" data-testid="custom-theme-error" class="mt-1.5 text-xs text-error" role="alert">{customError}</p>
  {:else}
    <p id="custom-theme-hint" data-testid="custom-theme-hint" class="mt-1.5 {META}">
      {@html t.custom_help({
        path: code(themePath(customName || '<name>')),
        template: code('libs/ui/src/styles/_template.css'),
        import_rule: code('@import'),
        url: code('url()'),
      })}
    </p>
  {/if}
</div>
