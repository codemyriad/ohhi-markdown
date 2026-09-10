<script lang="ts">
  /**
   * Settings (chrome-shaping U6): five tabs, each short. General and Sync are
   * schema-validated forms with their own Save; Appearance, Vaults & shares
   * and Developer act immediately. Closing with unsaved changes prompts
   * rather than silently persisting or silently dropping them.
   */
  import { z } from 'zod'
  import { LL } from '@editor/i18n/i18n-svelte'
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
  import { escapeHtml } from '../html.js'
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
    /**
     * Open the device-link dialog (device-link N2, A1). Absent when no vault
     * is open — there is nothing to link. The dialog is the HOST's, not a
     * nested one: minting promotes the root mount, and a dialog inside a
     * dialog is a focus trap inside a focus trap.
     */
    onLinkDevice?: () => void
  }

  let { onClose, readAppFile, initialTab = 'general', onLinkDevice }: Props = $props()

  const t = $derived($LL.web.settings)
  const dl = $derived($LL.web.device_link)
  const TABS = $derived(
    (['general', 'appearance', 'sync', 'vaults', 'developer'] as const).map((value) => ({
      value,
      label: t.tabs[value](),
      testid: `settings-tab:${value}`,
    }))
  )
  // svelte-ignore state_referenced_locally -- seed only; Tabs owns it after
  let tab = $state<string>(initialTab)

  // ---- General ----
  const general = createForm(
    z.object({ name: z.string().trim().min(1, $LL.web.settings.general.name_required()) }),
    { name: loadUser() ?? '' }
  )

  // ---- Sync ----
  const sync = createForm(
    z.object({
      relay: z
        .string()
        .trim()
        .min(1, $LL.web.settings.sync.relay_required())
        .refine((u) => /^wss?:\/\/\S+$/.test(u), $LL.web.settings.sync.relay_invalid()),
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
  const code = (text: string): string => `<code class="font-ed-mono">${escapeHtml(text)}</code>`

  async function loadCustom(): Promise<void> {
    if (!readAppFile) {
      customError = t.appearance.needs_vault()
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

  /** Persist every dirty form; false (and a tab switch) if one is invalid. */
  async function saveAll(): Promise<boolean> {
    if (general.dirty) {
      if (!(await general.submit(({ name }) => saveUser(name)))) {
        tab = 'general'
        return false
      }
    }
    if (sync.dirty) {
      const ok = await sync.submit(({ relay, secret }) => {
        setDefaultRelay(relay)
        setOperatorSecret(secret)
      })
      if (!ok) {
        tab = 'sync'
        return false
      }
    }
    return true
  }

  async function saveAllAndClose(): Promise<void> {
    if (await saveAll()) onClose()
  }

  /**
   * Leaving settings for the device-link dialog SAVES first. Minting reads the
   * operator secret from config, so handing the dialog an unsaved one would
   * fail with "set the operator secret" while the user is looking at the
   * secret they just typed — and the dirty guard cannot fire, because the host
   * closes this dialog rather than the user dismissing it.
   */
  async function linkDeviceFromSettings(): Promise<void> {
    if (dirty && !(await saveAll())) return
    onLinkDevice?.()
  }

  function discardAndClose(): void {
    general.reset()
    sync.reset()
    onClose()
  }
</script>

<Dialog
  title={t.title()}
  align="top"
  width="lg"
  testid="settings-panel"
  showClose
  closeTestid="settings-close"
  {beforeClose}
  {onClose}
>
  <Tabs tabs={TABS} bind:value={tab} orientation="vertical" label={t.sections()} testid="settings-tabs">
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
                label={t.general.name()}
                bind:value={general.data.name}
                onblur={() => general.touch('name')}
                placeholder={t.general.name_placeholder()}
                testid="settings-name"
              />
              <Description>{t.general.name_hint()}</Description>
              <FieldErrors />
            </Field>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                data-testid="settings-save-general"
                disabled={!general.dirty || general.busy}
                class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
              >
                {$LL.common.save()}
              </button>
              {#if !general.dirty}<span class="text-xs text-base-content/70">{$LL.common.saved()}</span>{/if}
            </div>
          </form>
        {:else if id === 'appearance'}
          <fieldset>
            <legend class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.appearance.theme()}</legend>
            <div class="mt-2 flex flex-wrap gap-2" data-testid="theme-picker">
              {#each [{ value: 'system' as ThemePref, label: t.appearance.system() }, ...BUILTIN_THEMES.map( (th) => ({ value: th as ThemePref, label: THEME_LABELS[th] }) )] as option (option.value)}
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
            <!-- Sentences with inline markup render as html, the markup passed
                 as arguments — the Edible pattern; user-derived text is escaped. -->
            <p class="mt-1 text-xs text-base-content/70">
              {@html t.appearance.theme_help({ system: `<em>${t.appearance.system()}</em>` })}
            </p>
          </fieldset>
          <div class="mt-4">
            <label for="custom-theme-name" class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
              {t.appearance.custom_theme()}
            </label>
            <div class="mt-1 flex gap-2">
              <input
                id="custom-theme-name"
                data-testid="custom-theme-name"
                bind:value={customName}
                placeholder={t.appearance.custom_placeholder()}
                class="min-w-0 flex-1 rounded border border-base-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                data-testid="custom-theme-load"
                onclick={() => void loadCustom()}
                disabled={!customName.trim()}
                class="rounded border border-base-300 px-3 py-1 text-xs font-medium text-base-content/80 hover:bg-base-200 disabled:opacity-50"
              >
                {t.appearance.use_custom()}
              </button>
            </div>
            {#if customError}
              <p data-testid="custom-theme-error" class="mt-1 text-xs text-error" role="alert">{customError}</p>
            {:else}
              <p class="mt-1 text-xs text-base-content/70">
                {@html t.appearance.custom_help({
                  path: code(themePath(customName || '<name>')),
                  template: code('libs/ui/src/styles/_template.css'),
                  import_rule: code('@import'),
                  url: code('url()'),
                })}
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
                label={t.sync.relay()}
                mono
                bind:value={sync.data.relay}
                onblur={() => sync.touch('relay')}
                placeholder={DEFAULT_RELAY}
                testid="settings-relay"
              />
              <Description>{t.sync.relay_hint()}</Description>
              <FieldErrors />
            </Field>
            <Field name="secret" errors={sync.errorsFor('secret')}>
              <TextControl
                label={t.sync.secret()}
                mono
                type="password"
                autocomplete="off"
                bind:value={sync.data.secret}
                onblur={() => sync.touch('secret')}
                placeholder={t.sync.secret_placeholder()}
                testid="settings-secret"
              />
              <Description>{t.sync.secret_hint()}</Description>
              <FieldErrors />
            </Field>
            <div class="flex items-center gap-2">
              <button
                type="submit"
                data-testid="settings-save-sync"
                disabled={!sync.dirty || sync.busy}
                class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
              >
                {$LL.common.save()}
              </button>
              {#if !sync.dirty}<span class="text-xs text-base-content/70">{$LL.common.saved()}</span>{/if}
            </div>
          </form>
          <!-- Device linking (N2, A1). Its own section, below the relay
               settings it depends on — and outside the form, because it is an
               action against the relay, not a preference to save. -->
          <section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-device-link">
            <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
              {dl.section()}
            </h3>
            <p class="mt-1 text-xs text-base-content/70">{dl.section_help()}</p>
            {#if !onLinkDevice}
              <p class="mt-2 text-xs text-base-content/70">{dl.needs_vault()}</p>
            {:else if !sync.data.secret.trim()}
              <p class="mt-2 text-xs text-warning" data-testid="settings-link-device-needs-secret">
                {dl.needs_secret()}
              </p>
            {:else}
              <button
                type="button"
                data-testid="settings-link-device"
                onclick={() => void linkDeviceFromSettings()}
                class="mt-2 rounded border border-base-300 px-3 py-1.5 text-xs font-medium text-base-content/80 hover:bg-base-200"
              >
                {dl.open()}
              </button>
            {/if}
          </section>
        {:else if id === 'vaults'}
          <section>
            <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.vaults.vaults()}</h3>
            {#if vaults.length === 0}
              <p class="mt-1 text-xs text-base-content/70">{t.vaults.none()}</p>
            {:else}
              <ul class="mt-1 space-y-1">
                {#each vaults as v (v.room)}
                  <li class="flex items-center gap-2 text-sm text-base-content/80">
                    <span class="min-w-0 flex-1 truncate">{v.name}</span>
                    <button
                      type="button"
                      onclick={() => forgetVault(v.room)}
                      aria-label={t.vaults.forget_vault({ name: v.name })}
                      class="shrink-0 rounded px-2 py-0.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
                    >
                      {t.vaults.forget()}
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
            <p class="mt-1 text-xs text-base-content/70">{t.vaults.forget_hint()}</p>
          </section>
          <section class="mt-5">
            <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.vaults.shares()}</h3>
            {#if shares.length === 0}
              <p class="mt-1 text-xs text-base-content/70">{t.vaults.no_shares()}</p>
            {:else}
              <ul class="mt-1 space-y-1">
                {#each shares as s (s.room)}
                  <li class="flex items-center gap-2 text-sm text-base-content/80">
                    <span class="min-w-0 flex-1 truncate">{s.label || s.room}</span>
                    <button
                      type="button"
                      onclick={() => forgetShare(s.room)}
                      aria-label={t.vaults.forget_share({ label: s.label || s.room })}
                      class="shrink-0 rounded px-2 py-0.5 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content"
                    >
                      {t.vaults.forget()}
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
            <span class="text-sm text-base-content/80">{t.developer.devtools()}</span>
          </label>
          <p class="mt-1 text-xs text-base-content/70">
            {@html t.developer.devtools_help({ flag: code('?debug=1') })}
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
      <span class="flex-1">{t.unsaved()}</span>
      <button
        type="button"
        data-testid="settings-discard"
        onclick={discardAndClose}
        class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200"
      >
        {t.discard()}
      </button>
      <button
        type="button"
        data-testid="settings-save-all"
        onclick={() => void saveAllAndClose()}
        class="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-content hover:bg-primary/90"
      >
        {t.save_and_close()}
      </button>
    </div>
  {/if}
</Dialog>
