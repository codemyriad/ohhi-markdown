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
   * Under the vault group, the example themes the app ships (Nord Light and
   * Dark, built in until Fork 4-A) that this vault does not hold yet, each
   * with *Add to this vault*: a write the person asks for, into `.ohhi/`,
   * journaled and atomic (quiet-shell F8; `theme-examples.ts`).
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
  import { EXAMPLE_THEMES, addExampleTheme, exampleLabel } from '../theme-examples.js'
  import {
    BUTTON,
    BUTTON_SM,
    CHOICE,
    CHOICE_OFF,
    CHOICE_ON,
    EYEBROW,
    GROUP,
    GROUP_ROW,
    META,
    ROW,
    ROW_SETTING,
    ROW_THING,
  } from '../ui/styles.js'
  import ResourceSource from './ResourceSource.svelte'

  interface Props {
    /** Reads the vault's `.ohhi/`; absent with no vault open (no vault theme then). */
    readAppFile?: (path: string) => Promise<string | null>
    /** Writes under the vault's `.ohhi/`, journaled and atomic; absent → no example can be added. */
    writeAppFile?: (path: string, text: string) => Promise<void>
    /** The open vault's theme folders (`resources.themes`); absent or empty → none listed. */
    themes?: readonly ThemeEntry[]
  }

  let { readAppFile, writeAppFile, themes = [] }: Props = $props()

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

  /** The examples this vault does not hold yet. */
  const examples = $derived(EXAMPLE_THEMES.filter((name) => !themes.some((th) => th.name === name)))
  /** What *Add to this vault* last said (`added` / an error), for the live region beside the list. */
  let added = $state<{ name: string; text: string; ok: boolean } | null>(null)

  async function addExample(name: (typeof EXAMPLE_THEMES)[number]): Promise<void> {
    if (!readAppFile || !writeAppFile) return
    try {
      const path = await addExampleTheme(name, { readAppFile, writeAppFile })
      added = { name, text: t.example_added({ path }), ok: true }
      // The preference already names it (a device that chose Nord when it was
      // built in): it applies now, without a second pick.
      if (themeState.pref === `custom:${name}`) await useVaultTheme(name)
    } catch (err) {
      added = { name, text: err instanceof Error ? err.message : String(err), ok: false }
    }
  }

  /** The theme in use as a source line: a vault folder, or built in — or the built-in standing in for a vault theme. */
  const source = $derived.by(() => {
    if (customInUse && themeState.fellBackFrom === customInUse) {
      return {
        name: builtinThemeLabel($LL, themeState.name) ?? themeState.name,
        root: 'builtin' as const,
        path: null,
        shadows: [],
        fellBackFrom: customInUse,
      }
    }
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

  <!-- The examples that ship with the app and this vault lacks: added on request, journaled. -->
  {#if env.vaultOpen && writeAppFile && examples.length > 0}
    <p class="mt-4 mb-1 {META}">{t.examples_intro()}</p>
    <ul class="m-0 max-w-md list-none p-0" data-testid="theme-examples">
      {#each examples as name (name)}
        <li class="grid grid-cols-[minmax(0,1fr)_auto] {ROW}" data-testid="theme-example:{name}">
          <span class="min-w-0">
            <span class={ROW_THING}>{exampleLabel($LL, name)}</span>
            <code class="ms-2 font-ed-mono text-[11.5px] {META}">{themePath(name)}</code>
          </span>
          <button
            type="button"
            class={BUTTON_SM}
            data-testid="theme-example-add:{name}"
            aria-label={t.add_example_label({ label: exampleLabel($LL, name), path: themePath(name) })}
            onclick={() => void addExample(name)}
          >
            {t.add_example()}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <p class="sr-only" role="status" data-testid="theme-example-status">{added?.ok ? added.text : ''}</p>
  {#if added && !added.ok}
    <p class="mt-1.5 text-xs text-error" role="alert" data-testid="theme-example-error">{added.text}</p>
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
