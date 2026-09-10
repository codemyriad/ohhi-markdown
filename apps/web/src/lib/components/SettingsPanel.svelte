<script lang="ts">
  /**
   * Settings (chrome-shaping U6): five tabs, each short. General and Sync are
   * schema-validated forms with their own Save; Appearance, Vaults & shares
   * and Developer act immediately. Closing with unsaved changes prompts
   * rather than silently persisting or silently dropping them.
   */
  import { z } from 'zod'
  import {
    DEFAULT_RELAY,
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
  import { applyTheme, themePath, themeState, useCustomTheme } from '../theme.svelte.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import Tabs from '../ui/Tabs.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    onClose: () => void
    /** Reads Editor's own `.editor/` directory; absent when no vault is open. */
    readAppFile?: (path: string) => Promise<string | null>
    /** Which tab to open on; General by default. */
    initialTab?: 'general' | 'appearance' | 'sync' | 'vaults' | 'developer'
  }

  let { onClose, readAppFile, initialTab = 'general' }: Props = $props()

  const TABS = [
    { value: 'general', label: 'General', testid: 'settings-tab:general' },
    { value: 'appearance', label: 'Appearance', testid: 'settings-tab:appearance' },
    { value: 'sync', label: 'Sync', testid: 'settings-tab:sync' },
    { value: 'vaults', label: 'Vaults & shares', testid: 'settings-tab:vaults' },
    { value: 'developer', label: 'Developer', testid: 'settings-tab:developer' },
  ]
  // svelte-ignore state_referenced_locally -- seed only; Tabs owns it after
  let tab = $state<string>(initialTab)

  // ---- General ----
  const general = createForm(
    z.object({ name: z.string().trim().min(1, 'A name your collaborators will see.') }),
    { name: loadUser() ?? '' }
  )

  // ---- Sync ----
  const sync = createForm(
    z.object({
      relay: z
        .string()
        .trim()
        .min(1, 'The relay new shares are created on.')
        .refine((u) => /^wss?:\/\/\S+$/.test(u), 'A relay URL starts with ws:// or wss://.'),
      secret: z.string(),
    }),
    { relay: defaultRelay(), secret: operatorSecret() }
  )

  async function saveGeneral(): Promise<void> {
    await general.submit(({ name }) => saveUser(name))
  }
  async function saveSync(): Promise<void> {
    await sync.submit(({ relay, secret }) => {
      setDefaultRelay(relay)
      setOperatorSecret(secret)
    })
  }

  // ---- Appearance ----
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

  // ---- Vaults & shares ----
  let shares = $state(loadShares())
  let vaults = $state(listVaults())

  function forgetShare(room: string): void {
    removeShare(room)
    shares = loadShares()
  }
  function forgetVault(room: string): void {
    removeVault(room)
    vaults = listVaults()
  }

  // ---- Developer ----
  let devtools = $state(devtoolsEnabled())

  // ---- closing: the dirty guard ----
  const dirty = $derived(general.dirty || sync.dirty)
  let pendingClose = $state(false)

  function beforeClose(): boolean {
    if (!dirty) return true
    pendingClose = true
    return false
  }

  async function saveAllAndClose(): Promise<void> {
    if (general.dirty) {
      if (!(await general.submit(({ name }) => saveUser(name)))) {
        tab = 'general'
        return
      }
    }
    if (sync.dirty) {
      const ok = await sync.submit(({ relay, secret }) => {
        setDefaultRelay(relay)
        setOperatorSecret(secret)
      })
      if (!ok) {
        tab = 'sync'
        return
      }
    }
    onClose()
  }

  function discardAndClose(): void {
    general.reset()
    sync.reset()
    onClose()
  }
</script>

<Dialog
  title="Settings"
  align="top"
  width="lg"
  testid="settings-panel"
  showClose
  closeTestid="settings-close"
  {beforeClose}
  {onClose}
>
  <Tabs tabs={TABS} bind:value={tab} orientation="vertical" label="Settings sections" testid="settings-tabs">
    {#snippet panel(id)}
      <div class="min-h-72">
        {#if id === 'general'}
          <form
            novalidate
            class="space-y-3"
            onsubmit={(e) => {
              e.preventDefault()
              void saveGeneral()
            }}
          >
            <Field name="name" errors={general.errorsFor('name')} required>
              <TextControl
                label="Display name"
                bind:value={general.data.name}
                onblur={() => general.touch('name')}
                placeholder="Anonymous"
                testid="settings-name"
              />
              <Description>Shown to collaborators; applies the next time a vault is opened.</Description>
              <FieldErrors />
            </Field>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                data-testid="settings-save-general"
                disabled={!general.dirty || general.busy}
                class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
              {#if !general.dirty}<span class="text-xs text-base-content/70">Saved</span>{/if}
            </div>
          </form>
        {:else if id === 'appearance'}
          <fieldset>
            <legend class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Theme</legend>
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
            <p class="mt-1 text-xs text-base-content/70">
              Applies immediately, to the chrome and the editor alike. <em>System</em> follows your
              OS setting. Nord reproduces the Obsidian theme it is named after; the two Editor
              themes are our own defaults.
            </p>
          </fieldset>
          <div class="mt-4">
            <label for="custom-theme-name" class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
              Custom theme
            </label>
            <div class="mt-1 flex gap-2">
              <input
                id="custom-theme-name"
                data-testid="custom-theme-name"
                bind:value={customName}
                placeholder="my-theme"
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
              <p data-testid="custom-theme-error" class="mt-1 text-xs text-error" role="alert">{customError}</p>
            {:else}
              <p class="mt-1 text-xs text-base-content/70">
                Reads <code class="font-ed-mono">{themePath(customName || '<name>')}</code> from the
                open vault. Start from <code class="font-ed-mono">libs/ui/src/styles/_template.css</code>;
                <code class="font-ed-mono">@import</code> and remote
                <code class="font-ed-mono">url()</code> are stripped, and the sync-status colours
                cannot be overridden.
              </p>
            {/if}
          </div>
        {:else if id === 'sync'}
          <form
            novalidate
            class="space-y-3"
            onsubmit={(e) => {
              e.preventDefault()
              void saveSync()
            }}
          >
            <Field name="relay" errors={sync.errorsFor('relay')} required>
              <TextControl
                label="Default relay"
                mono
                bind:value={sync.data.relay}
                onblur={() => sync.touch('relay')}
                placeholder={DEFAULT_RELAY}
                testid="settings-relay"
              />
              <Description>Used when creating new shares. Each share remembers its own relay in its link.</Description>
              <FieldErrors />
            </Field>
            <Field name="secret" errors={sync.errorsFor('secret')}>
              <TextControl
                label="Relay operator secret"
                mono
                type="password"
                autocomplete="off"
                bind:value={sync.data.secret}
                onblur={() => sync.touch('secret')}
                placeholder="unset"
                testid="settings-secret"
              />
              <Description>Lets this app mint, list and revoke share links on your relay.</Description>
              <FieldErrors />
            </Field>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                data-testid="settings-save-sync"
                disabled={!sync.dirty || sync.busy}
                class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
              >
                Save
              </button>
              {#if !sync.dirty}<span class="text-xs text-base-content/70">Saved</span>{/if}
            </div>
          </form>
        {:else if id === 'vaults'}
          <section>
            <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Vaults</h3>
            {#if vaults.length === 0}
              <p class="mt-1 text-xs text-base-content/70">No vaults remembered.</p>
            {:else}
              <ul class="mt-1 space-y-1">
                {#each vaults as v (v.room)}
                  <li class="flex items-center gap-2 text-sm text-base-content/80">
                    <span class="min-w-0 flex-1 truncate">{v.name}</span>
                    <button
                      type="button"
                      onclick={() => forgetVault(v.room)}
                      aria-label="Forget vault {v.name}"
                      class="shrink-0 rounded px-2 py-0.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
                    >
                      forget
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="mt-1 text-xs text-base-content/70">Forgetting a vault never touches its files.</p>
          </section>
          <section class="mt-5">
            <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Remembered shares</h3>
            {#if shares.length === 0}
              <p class="mt-1 text-xs text-base-content/70">No shares remembered.</p>
            {:else}
              <ul class="mt-1 space-y-1">
                {#each shares as s (s.room)}
                  <li class="flex items-center gap-2 text-sm text-base-content/80">
                    <span class="min-w-0 flex-1 truncate">{s.label || s.room}</span>
                    <button
                      type="button"
                      onclick={() => forgetShare(s.room)}
                      aria-label="Forget share {s.label || s.room}"
                      class="shrink-0 rounded px-2 py-0.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
                    >
                      forget
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {:else if id === 'developer'}
          <label class="flex items-center gap-2">
            <input
              data-testid="settings-devtools"
              type="checkbox"
              bind:checked={devtools}
              onchange={() => setDevtools(devtools)}
            />
            <span class="text-sm text-base-content/80">Developer tools</span>
          </label>
          <p class="mt-1 text-xs text-base-content/70">
            The sync inspector: a per-file view of disk ↔ CRDT state. Also at the foot of the
            rail's Activity section, or forced for one session with <code class="font-ed-mono">?debug=1</code>.
          </p>
        {/if}
      </div>
    {/snippet}
  </Tabs>

  {#if pendingClose}
    <div
      role="alert"
      data-testid="settings-unsaved"
      class="mt-3 flex flex-wrap items-center gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-base-content"
    >
      <span class="flex-1">You have unsaved changes.</span>
      <button
        type="button"
        data-testid="settings-discard"
        onclick={discardAndClose}
        class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200"
      >
        Discard
      </button>
      <button
        type="button"
        data-testid="settings-save-all"
        onclick={() => void saveAllAndClose()}
        class="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-content hover:bg-primary/90"
      >
        Save and close
      </button>
    </div>
  {/if}
</Dialog>
