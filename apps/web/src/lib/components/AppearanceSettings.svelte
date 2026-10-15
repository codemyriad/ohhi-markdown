<script lang="ts">
  /**
   * Settings › Appearance: the theme, in two groups (Chris, 2026-10-15 —
   * "a visible difference between built-ins and themes saved or added as
   * custom themes"):
   *
   *  - **Built in** — System and the designed built-ins (`BUILTIN_THEMES`),
   *    which ship with the app;
   *  - **In this vault** — every theme folder the open vault holds
   *    (`.ohhi/themes/<name>/theme.css`, listed by the resource loader as
   *    `resources.themes`), by its folder's name. The typed-name field stays
   *    under it as a fallback, for a folder the list does not show.
   *
   * Every pick applies at once. It opens with the theme's one source line
   * (settings-shaping Fork 4): the theme in use and where it came from.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { BUILTIN_THEMES } from '@ohhi/ui/tokens'
  import type { ThemePref } from '../config.js'
  import { escapeHtml } from '../html.js'
  import type { ThemeEntry } from '../resources.svelte.js'
  import { getSettingsEnv } from '../settings-host.js'
  import { applyTheme, builtinThemeLabel, themePath, themeState, useCustomTheme } from '../theme.svelte.js'
  import { BUTTON, CHOICE, CHOICE_OFF, CHOICE_ON, EYEBROW, GROUP, GROUP_ROW, META, ROW_SETTING } from '../ui/styles.js'
  import ResourceSource from './ResourceSource.svelte'

  interface Props {
    /** Reads the vault's `.ohhi/`; absent with no vault open (no vault theme then). */
    readAppFile?: (path: string) => Promise<string | null>
    /** The open vault's theme folders (`resources.themes`); absent or empty → none listed. */
    themes?: readonly ThemeEntry[]
  }

  let { readAppFile, themes = [] }: Props = $props()

  const env = getSettingsEnv()
  const t = $derived($LL.web.settings.appearance)
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`

  /** The vault theme in use, by folder name; null on a built-in or System. */
  const customInUse = $derived(themeState.pref.startsWith('custom:') ? themeState.pref.slice('custom:'.length) : null)

  let customName = $state(themeState.pref.startsWith('custom:') ? themeState.pref.slice('custom:'.length) : '')
  let customError = $state('')

  /** Use a vault theme by name: read its file, install it, apply it — or say why not. */
  async function useVaultTheme(name: string): Promise<void> {
    if (!readAppFile) {
      customError = t.needs_vault()
      return
    }
    customError = (await useCustomTheme(name, readAppFile)) ?? ''
  }

  /** The theme in use as a source line: a vault folder, or built in. */
  const source = $derived.by(() => {
    return customInUse
      ? { name: customInUse, root: 'vault' as const, path: themePath(customInUse), shadows: [], fellBackFrom: null }
      : {
          name: builtinThemeLabel($LL, themeState.name) ?? themeState.name,
          root: 'builtin' as const,
          path: null,
          shadows: [],
          fellBackFrom: null,
        }
  })

  const builtins = $derived([
    { value: 'system' as ThemePref, label: t.system() },
    ...BUILTIN_THEMES.map((th) => ({ value: th as ThemePref, label: builtinThemeLabel($LL, th) ?? th })),
  ])
</script>

<ResourceSource label={$LL.web.settings.customise.source.theme()} testid="theme-source" {source} />

<!-- Built in: ships with the app. -->
<div role="group" aria-labelledby="theme-builtin-h" data-testid="theme-picker">
  <div class={GROUP_ROW}>
    <h3 id="theme-builtin-h" class="m-0 {EYEBROW}">{t.builtin()}</h3>
  </div>
  <div class="flex flex-wrap gap-2" data-testid="theme-builtin">
    {#each builtins as option (option.value)}
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
</div>

<!-- In this vault: the theme folders the open vault holds, by name. -->
<div class={GROUP} role="group" aria-labelledby="theme-vault-h" data-testid="theme-vault">
  <div class={GROUP_ROW}>
    <h3 id="theme-vault-h" class="m-0 {EYEBROW}">{t.in_vault()}</h3>
  </div>
  {#if !env.vaultOpen}
    <p class="m-0 {META}" data-testid="theme-vault-none">{t.vault_none()}</p>
  {:else if themes.length === 0}
    <p class="m-0 {META}" data-testid="theme-vault-empty">
      {@html t.vault_empty({ path: code(themePath('<name>')) })}
    </p>
  {:else}
    <div class="flex flex-wrap gap-2" data-testid="theme-vault-list">
      {#each themes as theme (theme.name)}
        <button
          type="button"
          data-testid="theme-custom:{theme.name}"
          aria-pressed={customInUse === theme.name}
          onclick={() => void useVaultTheme(theme.name)}
          class="{CHOICE} font-ed-mono {customInUse === theme.name ? CHOICE_ON : CHOICE_OFF}"
        >
          {theme.name}
        </button>
      {/each}
    </div>
  {/if}

  <!-- The fallback (QA round 1's field): a folder the list does not show —
       its Use button on the same line, the path and the rules as ONE hint
       line under them, the input's description. -->
  {#if env.vaultOpen}
    <label for="custom-theme-name" class="mt-4 block {ROW_SETTING}">{t.custom_label()}</label>
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
        onclick={() => void useVaultTheme(customName)}
        disabled={!customName.trim()}
        class="{BUTTON} h-7"
      >
        {t.use_custom()}
      </button>
    </div>
  {/if}
  {#if customError}
    <p id="custom-theme-hint" data-testid="custom-theme-error" class="mt-1.5 text-xs text-error" role="alert">{customError}</p>
  {:else if env.vaultOpen}
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
