<script lang="ts">
  import {
    defaultRelay,
    devtoolsEnabled,
    listVaults,
    loadShares,
    loadUser,
    operatorSecret,
    removeShare,
    removeVault,
    saveUser,
    setDefaultRelay,
    setDevtools,
    setOperatorSecret,
    type ThemePref,
  } from '../config.js'
  import { BUILTIN_THEMES, THEME_LABELS } from '@editor/ui/tokens'
  import Dialog from '../ui/Dialog.svelte'
  import { applyTheme, themePath, themeState, useCustomTheme } from '../theme.svelte.js'

  interface Props {
    onClose: () => void
    /** Reads Editor's own `.editor/` directory; absent when no vault is open. */
    readAppFile?: (path: string) => Promise<string | null>
  }

  let { onClose, readAppFile }: Props = $props()

  let customName = $state(
    themeState.pref.startsWith('custom:') ? themeState.pref.slice('custom:'.length) : ''
  )
  let customError = $state('')

  async function loadCustom(): Promise<void> {
    if (!readAppFile) {
      customError = 'Open a vault first — custom themes live inside it.'
      return
    }
    customError = (await useCustomTheme(customName, readAppFile)) ?? ''
  }

  // Editable copies; persisted on save/blur. The panel re-reads config on
  // every open (it is mounted fresh each time).
  let name = $state(loadUser() ?? '')
  let relay = $state(defaultRelay())
  let secret = $state(operatorSecret())
  let shares = $state(loadShares())
  let vaults = $state(listVaults())
  let devtools = $state(devtoolsEnabled())

  function persist(): void {
    if (name.trim()) saveUser(name)
    setDefaultRelay(relay)
    setOperatorSecret(secret)
    setDevtools(devtools)
  }

  function close(): void {
    persist()
    onClose()
  }

  function forgetShare(room: string): void {
    removeShare(room)
    shares = loadShares()
  }

  function forgetVault(room: string): void {
    removeVault(room)
    vaults = listVaults()
  }
</script>

<!-- Every route out — Escape, the scrim, the ✕ — persists first (`close`). -->
<Dialog
  title="Settings"
  align="top"
  testid="settings-panel"
  showClose
  closeTestid="settings-close"
  onClose={close}
>
  <div>
    <fieldset>
      <legend class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
        Theme
      </legend>
      <div class="mt-2 flex flex-wrap gap-2" data-testid="theme-picker">
        {#each [{ value: 'system' as ThemePref, label: 'System' }, ...BUILTIN_THEMES.map( (t) => ({ value: t as ThemePref, label: THEME_LABELS[t] }) )] as option (option.value)}
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
      <span class="mt-1 block text-xs text-base-content/70">
        Applies immediately, to the chrome and the editor alike. <em>System</em> follows your OS
        setting. Nord reproduces the Obsidian theme it is named after; the two Editor themes are
        our own defaults.
      </span>

      <div class="mt-3 flex gap-2">
        <input
          data-testid="custom-theme-name"
          bind:value={customName}
          placeholder="my-theme"
          aria-label="Custom theme name"
          class="min-w-0 flex-1 rounded border border-base-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
        />
        <button
          type="button"
          data-testid="custom-theme-load"
          onclick={() => void loadCustom()}
          disabled={!customName.trim()}
          class="rounded border border-base-300 px-3 py-1 text-xs font-medium text-base-content/80 hover:bg-base-200 disabled:opacity-50"
        >
          Use custom
        </button>
      </div>
      {#if customError}
        <span data-testid="custom-theme-error" class="mt-1 block text-xs text-error"
          >{customError}</span
        >
      {:else}
        <span class="mt-1 block text-xs text-base-content/70">
          Reads <code class="font-ed-mono">{themePath(customName || '<name>')}</code> from the open
          vault. Start from <code class="font-ed-mono">libs/ui/src/styles/_template.css</code>;
          <code class="font-ed-mono">@import</code> and remote
          <code class="font-ed-mono">url()</code> are stripped, and the sync-status colours cannot
          be overridden.
        </span>
      {/if}
    </fieldset>

    <label class="mt-4 block">
      <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Display name</span>
      <input
        data-testid="settings-name"
        bind:value={name}
        placeholder="Anonymous"
        class="mt-1 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
      />
      <span class="mt-1 block text-xs text-base-content/70">
        Shown to collaborators; applies the next time a vault is opened.
      </span>
    </label>

    <label class="mt-4 block">
      <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Default relay</span>
      <input
        data-testid="settings-relay"
        bind:value={relay}
        placeholder="ws://localhost:8787"
        class="mt-1 w-full rounded border border-base-300 px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
      />
      <span class="mt-1 block text-xs text-base-content/70">Used when creating new shares.</span>
    </label>

    <label class="mt-4 block">
      <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
        Relay operator secret
      </span>
      <input
        data-testid="settings-secret"
        type="password"
        bind:value={secret}
        placeholder="unset"
        autocomplete="off"
        class="mt-1 w-full rounded border border-base-300 px-3 py-2 font-mono text-sm focus:border-primary focus:outline-none"
      />
      <span class="mt-1 block text-xs text-base-content/70">
        Lets this app mint share tokens on your relay (coming with in-app sharing).
      </span>
    </label>

    <label class="mt-4 flex items-center gap-2">
      <input data-testid="settings-devtools" type="checkbox" bind:checked={devtools} />
      <span class="text-sm text-base-content/80">Developer tools</span>
      <span class="text-xs text-base-content/70">— sync inspector panel (or force with ?debug=1)</span>
    </label>

    {#if vaults.length > 0}
      <section class="mt-5">
        <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Vaults</h3>
        <ul class="mt-1 space-y-1">
          {#each vaults as v (v.room)}
            <li class="flex items-center gap-2 text-sm text-base-content/80">
              <span class="min-w-0 flex-1 truncate">{v.name}</span>
              <button
                onclick={() => forgetVault(v.room)}
                aria-label="Forget vault {v.name}"
                class="shrink-0 rounded px-2 py-0.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content/80"
              >
                forget
              </button>
            </li>
          {/each}
        </ul>
        <p class="mt-1 text-xs text-base-content/70">Forgetting a vault never touches its files.</p>
      </section>
    {/if}

    {#if shares.length > 0}
      <section class="mt-5">
        <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Remembered shares</h3>
        <ul class="mt-1 space-y-1">
          {#each shares as s (s.room)}
            <li class="flex items-center gap-2 text-sm text-base-content/80">
              <span class="min-w-0 flex-1 truncate">{s.label || s.room}</span>
              <button
                onclick={() => forgetShare(s.room)}
                aria-label="Forget share {s.label || s.room}"
                class="shrink-0 rounded px-2 py-0.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content/80"
              >
                forget
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  </div>
</Dialog>
