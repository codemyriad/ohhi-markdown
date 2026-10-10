<script lang="ts">
  /**
   * Settings (chrome-shaping U6): six tabs, each short. General and Sync are
   * schema-validated forms with their own Save; Appearance, Hotkeys, Vaults &
   * shares and Developer act immediately. Closing with unsaved changes prompts
   * rather than silently persisting or silently dropping them.
   */
  import { TriangleAlert } from '@lucide/svelte'
  import { z } from 'zod'
  import { LL, locale } from '@ohhi/i18n/i18n-svelte'
  import { isTauri } from '../platform.js'
  import { formatBytes, notGuaranteed } from '../storage-persistence.js'
  import {
    askToKeepStorage,
    refreshStorageUsage,
    setStorageReminder,
    storageState,
  } from '../storage.svelte.js'
  import {
    DEFAULT_RELAY,
    DEFAULT_RELAY_CONFIGURED,
    TEAM_HOST,
    TEAM_NETWORK_NOTE,
    defaultRelay,
    devtoolsEnabled,
    hotkeys,
    ignoredSavedRelay,
    isRelayUrl,
    listVaults,
    loadShares,
    loadUser,
    operatorSecret,
    removeShare,
    relayKnown,
    removeVault,
    saveUser,
    setDefaultRelay,
    setDevtools,
    setOperatorSecret,
    type ThemePref,
  } from '../config.js'
  import type { CommandRegistry } from '../commands.js'
  import { createHotkeyDraft } from '../hotkey-draft.svelte.js'
  import { overridesToBindings } from '../keymap-spec.js'
  import type { Keymap } from '../keymap.svelte.js'
  import HotkeySettings from './HotkeySettings.svelte'
  import { untrack } from 'svelte'
  import { VIEW_MODES, type ViewMode } from '../panes.js'
  import { readState, setDefaultMode } from '../read.svelte.js'
  import { BUILTIN_THEMES, THEME_LABELS } from '@ohhi/ui/tokens'
  import { escapeHtml } from '../html.js'
  import { applyTheme, themePath, themeState, useCustomTheme } from '../theme.svelte.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import Tabs from '../ui/Tabs.svelte'
  import LayoutSettings from './LayoutSettings.svelte'
  import type { Resources } from '../resources.svelte.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import TextControl from '../ui/TextControl.svelte'
  import type { Clock } from '@ohhi/vault'
  import { relayHost, type SharedSnapshot } from '@ohhi/workspace'
  import { guideHref, openGuide } from '../guide.js'
  import { realClock } from '../real-clock.js'
  import type { ProbeResult, SecretCheck } from '../relay-probe.js'
  import { HEADING } from '../ui/styles.js'
  import RelayCard from './RelayCard.svelte'
  import RelaySecretField from './RelaySecretField.svelte'
  import SecretHelp from './SecretHelp.svelte'

  interface Props {
    onClose: () => void
    /** Reads Editor's own `.ohhi/` directory; absent when no vault is open. */
    readAppFile?: (path: string) => Promise<string | null>
    /** Which tab to open on; General by default. */
    initialTab?: 'general' | 'appearance' | 'layout' | 'hotkeys' | 'sync' | 'vaults' | 'developer'
    /**
     * The shell's one command registry (tab-groups R1.3). The Hotkeys tab
     * reads the table from it and writes overrides back through it, so there
     * is one command table in the app and Settings is a view of it — a panel
     * with its own copy would drift the day a slice registers a command.
     */
    registry: CommandRegistry
    /**
     * Open the device-link dialog (device-link N2, A1). Absent when no vault
     * is open — there is nothing to link. The dialog is the HOST's, not a
     * nested one: minting promotes the root mount, and a dialog inside a
     * dialog is a focus trap inside a focus trap.
     */
    onLinkDevice?: () => void
    /**
     * The shell's layout (Settings › Layout edits this device's overrides on
     * it, live — round 3, Q6); the tab hides without it.
     */
    layout?: Pick<ShellLayout, 'fileSpec' | 'ownSpec' | 'overrides' | 'setOverrides' | 'resetOverrides'> &
      Partial<Pick<ShellLayout, 'pins' | 'unpin'>>
    resources?: Partial<Pick<Resources, 'keymaps' | 'refreshKeymaps'>>
    /** The active keymap (quiet-shell F10): Settings › Hotkeys edits its file. Absent → legacy rows only. */
    keymap?: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'setActive' | 'save'>
    /**
     * The open vault's relays, from the Shared view's snapshot (first-run
     * D1): the Sync tab's relay card reads "Connected · …" from the one new
     * shares go on, and probes it when the vault holds no room there.
     */
    relays?: SharedSnapshot['relays']
    // ---- environment, injectable for tests ----
    clock?: Clock
    probe?: (relayUrl: string) => Promise<ProbeResult>
    verify?: (relayUrl: string, secret: string) => Promise<SecretCheck>
    /** The pinned host (`TEAM_HOST`); '' = a generic build. */
    pinnedHost?: string
    /** The build's default relay, when it was given one: the team's ('' = none). */
    teamRelay?: string
    networkNote?: string
    secretHint?: string
  }

  let {
    onClose,
    readAppFile,
    initialTab = 'general',
    onLinkDevice,
    registry,
    layout,
    resources,
    keymap,
    relays = [],
    clock = realClock,
    probe,
    verify,
    pinnedHost = TEAM_HOST,
    teamRelay = DEFAULT_RELAY_CONFIGURED ? DEFAULT_RELAY : '',
    networkNote = TEAM_NETWORK_NOTE,
    secretHint,
  }: Props = $props()

  const t = $derived($LL.web.settings)

  const dl = $derived($LL.web.device_link)
  const TABS = $derived(
    (['general', 'appearance', 'hotkeys', 'sync', 'vaults', 'layout', 'developer'] as const)
      .filter((value) => value !== 'layout' || layout)
      .map((value) => ({
        value,
        label: t.tabs[value](),
        testid: `settings-tab:${value}`,
      }))
  )
  // svelte-ignore state_referenced_locally -- seed only; Tabs owns it after
  let tab = $state<string>(initialTab)

  // ---- General ----
  /** The desktop build's version (bug reports name a build); null in the browser. */
  let appVersion = $state<string | null>(null)
  if (isTauri()) {
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => (appVersion = v))
      .catch(() => {})
  }
  const general = createForm(
    z.object({ name: z.string().trim().min(1, $LL.web.settings.general.name_required()) }),
    { name: loadUser() ?? '' }
  )

  // ---- Sync ----
  // The relay as the form showed it: saving stores the relay only when the
  // user changed it, so saving just the secret never pins this build's
  // default (config.ts, `AppConfigV2.defaultRelay`).
  // svelte-ignore state_referenced_locally -- seed only; the pin is fixed at build time
  let shownRelay = $state(defaultRelay(pinnedHost))
  /** A relay saved before this build was pinned, which the pin now ignores ('' = none). */
  // svelte-ignore state_referenced_locally -- seed only
  const ignoredRelay = ignoredSavedRelay(pinnedHost)
  function persistSync({ relay, secret }: { relay: string; secret: string }): void {
    if (relay.trim() !== shownRelay) {
      setDefaultRelay(relay)
      shownRelay = defaultRelay(pinnedHost)
    }
    setOperatorSecret(secret)
    secretTypedFor = null
    syncRelayKnown = relayKnown(pinnedHost) || !!pinnedHost
  }

  // ---- the relay card (first-run D1, R10) ----
  /** Whether a relay is known at all; a pinned build always knows its one. */
  // svelte-ignore state_referenced_locally -- seed only; the pin is fixed at build time
  let syncRelayKnown = $state(relayKnown(pinnedHost) || !!pinnedHost)
  /**
   * The address field: open with nothing known (the card says none), after
   * *Change…*, and — read-only — always in a pinned build, which offers no
   * other relay.
   */
  // svelte-ignore state_referenced_locally -- seed only
  let relayOpen = $state(!syncRelayKnown || !!pinnedHost)
  const teamHost = $derived(teamRelay ? (relayHost(teamRelay) ?? '') : '')

  const sync = createForm(
    z.object({
      relay: z
        .string()
        .trim()
        .min(1, $LL.web.settings.sync.relay_required())
        .refine(isRelayUrl, $LL.web.settings.sync.relay_invalid()),
      secret: z.string(),
    }),
    // svelte-ignore state_referenced_locally -- seed only; the form owns it after
    { relay: shownRelay, secret: operatorSecret() }
  )

  /**
   * Read B3. Outside the General form on purpose: like the theme, it applies
   * the moment it is chosen — there is nothing to validate and nothing to
   * batch, so a Save button would only be a way to lose the change.
   */
  const readingKey = $derived(registry.binding('view.toggle-reading') || 'Mod+E')

  async function saveGeneral(): Promise<void> {
    await general.submit(({ name }) => saveUser(name))
  }
  async function saveSync(): Promise<void> {
    await sync.submit(persistSync)
  }
  /** The relay the card is about: what the field holds when it is a relay URL, else the saved one. */
  const cardRelay = $derived(isRelayUrl(sync.data.relay.trim()) ? sync.data.relay.trim() : shownRelay)
  /**
   * The relay the secret may be checked against. The SAVED secret only ever
   * goes to the SAVED relay: while the address field holds another one (a
   * paste, a typo, a `ws://` host), only a secret typed after that edit is
   * checked there — never the one saved for the team's relay. Save makes the
   * new relay the saved one.
   */
  let secretTypedFor = $state<string | null>(null)
  const secretRelay = $derived(cardRelay === shownRelay ? shownRelay : secretTypedFor === cardRelay ? cardRelay : '')
  /** The snapshot's roll-up for that relay, when the vault holds rooms there. */
  const cardConnection = $derived(
    relays.find((r) => r.host && r.host.toLowerCase() === (relayHost(cardRelay) ?? '').toLowerCase()) ?? null
  )

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

  // ---- Hotkeys (tab-groups R1.3; quiet-shell F10) ----
  /**
   * The edit to the ACTIVE keymap file. Owned here, not by the tab, because
   * the tab unmounts on every tab switch and an unsaved edit must survive it;
   * the dirty guard below covers it like the two forms.
   */
  const noKeymap = {
    active: 'default' as const,
    resolved: null,
    legacy: true,
    save: () => Promise.reject(new Error('no keymap')),
  }
  const hotkeyDraft = createHotkeyDraft({
    get registry() {
      return registry
    },
    get keymap() {
      return keymap ?? noKeymap
    },
    legacy: () => overridesToBindings(hotkeys()),
    canSave: () => keymap !== undefined && readAppFile !== undefined,
  })
  // A file that changed on disk (or a different keymap chosen) re-seeds the
  // draft — unless it holds an edit to keep.
  $effect(() => {
    void keymap?.resolved
    void keymap?.legacy
    untrack(() => hotkeyDraft.sync())
  })
  // ---- Layout (round 3, Q6) ----
  // Applies and persists on every change, so it has nothing for the dirty
  // guard: closing never asks about it.
  /** The row currently swallowing key presses to record a chord, if any. */
  let recording = $state<string | null>(null)

  function stopRecording(): void {
    recording = null
    registry.setSuspended(false)
  }

  // A dialog can close mid-recording (Escape elsewhere, Save and close); the
  // registry must not stay suspended when it does.
  $effect(() => () => registry.setSuspended(false))

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

  // Browser storage (storage-persistence.ts): browser only — the desktop app
  // keeps real files.
  const inBrowser = !isTauri()
  const st = $derived($LL.web.storage)
  const storageStatus = $derived(
    {
      unknown: st.settings.checking,
      persisted: st.settings.kept,
      'best-effort': st.settings.best_effort,
      unsupported: st.settings.unsupported,
    }[storageState.state]()
  )
  const storageAtRisk = $derived(notGuaranteed(storageState.state))
  if (inBrowser) void refreshStorageUsage()

  // ---- Developer ----
  let devtools = $state(devtoolsEnabled())

  // ---- closing: the dirty guard ----
  const dirty = $derived(general.dirty || sync.dirty || hotkeyDraft.dirty)
  let pendingClose = $state(false)

  function beforeClose(): boolean {
    // Escape while a chord is being recorded is aimed at the field, not at
    // the dialog: the first press cancels the recording, a second one closes.
    // (Dismissal policy is fixed at mount in `Dialog`, so the veto is the seam.)
    if (recording !== null) {
      stopRecording()
      return false
    }
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
      const ok = await sync.submit(persistSync)
      if (!ok) {
        tab = 'sync'
        return false
      }
    }
    if (hotkeyDraft.dirty) {
      // Only an editable file saves without a name; Save as needs one, typed
      // on the tab.
      const saved = hotkeyDraft.writable ? await hotkeyDraft.save().then(() => true, () => false) : false
      if (!saved) {
        tab = 'hotkeys'
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
    hotkeyDraft.discard()
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
                class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content disabled:opacity-50"
              >
                {$LL.common.save()}
              </button>
              {#if !general.dirty}<span class="text-xs text-base-content/70">{$LL.common.saved()}</span>{/if}
            </div>
          </form>
          <fieldset class="mt-4">
            <legend class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
              {t.general.default_mode()}
            </legend>
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
              {@html t.general.default_mode_hint({ key: code(readingKey) })}
            </p>
          </fieldset>
          {#if appVersion}
            <p class="mt-4 text-xs text-base-content/70" data-testid="settings-version">
              {t.general.version({ version: appVersion })}
            </p>
          {/if}
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
        {:else if id === 'layout' && layout}
          <LayoutSettings {layout} />
        {:else if id === 'hotkeys'}
          <HotkeySettings
            {registry}
            draft={hotkeyDraft}
            {keymap}
            {resources}
            canSave={keymap !== undefined && readAppFile !== undefined}
            bind:recording
          />
        {:else if id === 'sync'}
          <!-- The relay as one thing with a state (first-run D1): connected
               from the snapshot when this vault holds rooms there, probed
               otherwise, none when nothing is known; pinned builds offer no
               other relay (R10). -->
          <form
            novalidate
            class="space-y-3"
            onsubmit={(e) => {
              e.preventDefault()
              void saveSync()
            }}
          >
            <div class="space-y-1.5" data-testid="settings-relay-card">
              <h3 class={HEADING}>{$LL.web.relay_card.label()}</h3>
              <RelayCard
                relayUrl={cardRelay}
                known={syncRelayKnown || (relayOpen && sync.data.relay.trim() !== shownRelay && isRelayUrl(sync.data.relay.trim()))}
                connection={cardConnection}
                {pinnedHost}
                {teamHost}
                {networkNote}
                {clock}
                {probe}
                showTest
                onChange={relayOpen ? undefined : () => (relayOpen = true)}
              />
            </div>
            {#if relayOpen}
              <Field name="relay" errors={sync.errorsFor('relay')} required={!pinnedHost}>
                <TextControl
                  label={t.sync.relay()}
                  mono
                  bind:value={sync.data.relay}
                  onblur={() => sync.touch('relay')}
                  placeholder={DEFAULT_RELAY}
                  readonly={!!pinnedHost}
                  testid="settings-relay"
                />
                <Description>{pinnedHost ? t.sync.relay_pinned_hint() : t.sync.relay_hint()}</Description>
                <FieldErrors />
              </Field>
              {#if pinnedHost && ignoredRelay}
                <p data-testid="settings-relay-ignored" class="text-xs text-base-content/80">
                  {t.sync.relay_pinned_saved_ignored({ saved: ignoredRelay, host: pinnedHost })}
                </p>
              {/if}
            {/if}
            <RelaySecretField
              relayUrl={secretRelay}
              oninput={() => (secretTypedFor = cardRelay)}
              bind:value={sync.data.secret}
              errors={sync.errorsFor('secret')}
              onblur={() => sync.touch('secret')}
              placeholder={t.sync.secret_placeholder()}
              {clock}
              {verify}
              hint={secretHint}
              testid="settings-secret"
            />
            <div class="flex items-center gap-2">
              <button
                type="submit"
                data-testid="settings-save-sync"
                disabled={!sync.dirty || sync.busy}
                class="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content disabled:opacity-50"
              >
                {$LL.common.save()}
              </button>
              {#if !sync.dirty}<span class="text-xs text-base-content/70">{$LL.common.saved()}</span>{/if}
            </div>
          </form>
          <!-- Your devices (N2, A1). Its own section, below the relay settings
               it depends on — and outside the form, because it is an action
               against the relay, not a preference to save. -->
          <section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-device-link">
            <h3 class={HEADING}>{t.sync.devices()}</h3>
            <p class="mt-1 text-xs text-base-content/70">{dl.section_help()}</p>
            {#if !onLinkDevice}
              <p class="mt-2 text-xs text-base-content/70">{dl.needs_vault()}</p>
            {:else if !sync.data.secret.trim()}
              <p class="mt-2 text-xs text-base-content/80" data-testid="settings-link-device-needs-secret">
                {dl.needs_secret()}
              </p>
              <SecretHelp hint={secretHint} testid="settings-link-device-where" />
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
          <!-- One relay per group (first-run R10): said where it is felt. -->
          <section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-own-relay">
            <h3 class={HEADING}>{t.sync.running_title()}</h3>
            <p class="mt-1 text-xs text-base-content/80">
              {pinnedHost ? t.sync.running_pinned({ host: pinnedHost }) : t.sync.running_body()}
            </p>
            {#if !pinnedHost}
              <a
                href={guideHref('relay')}
                target="_blank"
                rel="noreferrer"
                onclick={(e) => {
                  // The desktop has no opener: a guide opens in its own window.
                  if (!isTauri()) return
                  e.preventDefault()
                  void openGuide('relay')
                }}
                data-testid="settings-relay-guide"
                class="mt-1 inline-block text-xs font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
                >{t.sync.running_guide()}</a
              >
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
          {#if inBrowser}
            <!-- The status is a live region: an ask made here changes it in place. -->
            <section class="mt-5 border-t border-base-300 pt-4" data-testid="settings-storage">
              <h3 class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">
                {st.settings.heading()}
              </h3>
              <div role="status" class="mt-1">
                <p class="text-sm text-base-content/80" data-testid="settings-storage-status">{storageStatus}</p>
                {#if storageState.refused && storageAtRisk}
                  <p class="mt-1 text-xs text-base-content/70">{st.refused()}</p>
                {/if}
              </div>
              {#if storageState.usage}
                <p class="mt-1 text-xs text-base-content/70" data-testid="settings-storage-usage">
                  {st.settings.usage({
                    used: formatBytes(storageState.usage.usage, $locale),
                    quota: formatBytes(storageState.usage.quota, $locale),
                  })}
                </p>
              {/if}
              {#if storageAtRisk}
                <p class="mt-1 text-xs text-base-content/70">{st.advice()}</p>
                {#if storageState.state === 'best-effort'}
                  <button
                    type="button"
                    data-testid="settings-storage-keep"
                    onclick={() => void askToKeepStorage()}
                    class="mt-2 rounded border border-base-300 px-3 py-1.5 text-xs font-medium text-base-content/80 hover:bg-base-200"
                  >
                    {st.ask()}
                  </button>
                {/if}
                <label class="mt-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    data-testid="settings-storage-remind"
                    checked={!storageState.dismissed}
                    onchange={(e) => setStorageReminder(e.currentTarget.checked)}
                  />
                  <span class="text-sm text-base-content/80">{st.settings.remind()}</span>
                </label>
              {/if}
            </section>
          {/if}
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
        class="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-content"
      >
        {t.save_and_close()}
      </button>
    </div>
  {/if}
</Dialog>
