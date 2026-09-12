<script lang="ts">
  /**
   * Settings (chrome-shaping U6): six tabs, each short. General and Sync are
   * schema-validated forms with their own Save; Appearance, Hotkeys, Vaults &
   * shares and Developer act immediately. Closing with unsaved changes prompts
   * rather than silently persisting or silently dropping them.
   */
  import { TriangleAlert } from '@lucide/svelte'
  import { z } from 'zod'
  import { LL } from '@editor/i18n/i18n-svelte'
  import {
    DEFAULT_RELAY,
    defaultRelay,
    devtoolsEnabled,
    hotkeys,
    listVaults,
    loadShares,
    loadUser,
    operatorSecret,
    removeShare,
    removeVault,
    resetHotkey,
    saveUser,
    setDefaultRelay,
    setDevtools,
    setHotkey,
    setOperatorSecret,
    type ThemePref,
  } from '../config.js'
  import { parseBinding, type CommandBinding, type CommandRegistry } from '../commands.js'
  import { VIEW_MODES, type ViewMode } from '../panes.js'
  import { readState, setDefaultMode } from '../read.svelte.js'
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
    initialTab?: 'general' | 'appearance' | 'hotkeys' | 'sync' | 'vaults' | 'developer'
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
  }

  let { onClose, readAppFile, initialTab = 'general', onLinkDevice, registry }: Props = $props()

  const t = $derived($LL.web.settings)
  const dl = $derived($LL.web.device_link)
  const TABS = $derived(
    (['general', 'appearance', 'hotkeys', 'sync', 'vaults', 'developer'] as const).map((value) => ({
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

  // ---- Hotkeys (tab-groups R1.3) ----
  /**
   * Rows come from the registry, not from a table of our own, and every edit
   * goes straight to config: a hotkey has nothing to validate against a
   * server and nothing to batch, so a Save button would only add a way to
   * lose the change. Reset is the undo.
   */
  // svelte-ignore state_referenced_locally -- seed only; refreshHotkeys re-reads
  let hotkeyRows = $state<CommandBinding[]>(registry.bindings())
  /** What the user has typed per row, seeded from the binding in force. */
  // svelte-ignore state_referenced_locally -- seed only; refreshHotkeys re-seeds
  let drafts = $state<Record<string, string>>(seedDrafts(hotkeyRows))
  let hotkeyErrors = $state<Record<string, string>>({})
  /** The row currently swallowing key presses to record a chord, if any. */
  let recording = $state<string | null>(null)
  /** Row id → the wrapper around its input, so Record can focus what it records into. */
  const fields = $state<Record<string, HTMLElement | undefined>>({})

  const EXAMPLE_BINDING = 'Mod+Shift+P'

  /** Command titles as one phrase — the dictionary owns the sentence around it. */
  const list = (titles: string[]): string => titles.join(', ')

  function seedDrafts(rows: CommandBinding[]): Record<string, string> {
    return Object.fromEntries(rows.map((row) => [row.id, row.keys]))
  }

  function refreshHotkeys(): void {
    registry.setOverrides(hotkeys())
    hotkeyRows = registry.bindings()
    drafts = seedDrafts(hotkeyRows)
    // Every field is showing the truth again; an error about text that is no
    // longer in the box would be the only thing left lying.
    hotkeyErrors = {}
  }

  /** Commands in registration order, bucketed by their palette group. */
  const hotkeyGroups = $derived.by(() => {
    const out: { label: string; rows: CommandBinding[] }[] = []
    for (const row of hotkeyRows) {
      const label = row.group || t.hotkeys.ungrouped()
      const bucket = out.find((b) => b.label === label)
      if (bucket) bucket.rows.push(row)
      else out.push({ label, rows: [row] })
    }
    return out
  })

  function commitHotkey(row: CommandBinding): void {
    const typed = (drafts[row.id] ?? '').trim()
    if (typed && !parseBinding(typed)) {
      hotkeyErrors[row.id] = t.hotkeys.invalid({ example: EXAMPLE_BINDING })
      return
    }
    hotkeyErrors[row.id] = ''
    // Typing the default back (or clearing a command that ships unbound) is
    // the same thing as Reset — no override is stored for what already holds.
    if (typed === row.defaultKeys) resetHotkey(row.id)
    else setHotkey(row.id, typed || null)
    refreshHotkeys()
  }

  function resetRow(row: CommandBinding): void {
    hotkeyErrors[row.id] = ''
    resetHotkey(row.id)
    refreshHotkeys()
  }

  function startRecording(row: CommandBinding): void {
    hotkeyErrors[row.id] = ''
    recording = row.id
    // Global hotkeys are handled in the capture phase, so without this the
    // chord being recorded would ALSO run whatever it is currently bound to.
    registry.setSuspended(true)
    // Recording happens IN the field: the chord lands where the user can see
    // it, correct it and tab away from, and it needs no pointer.
    queueMicrotask(() => fields[row.id]?.querySelector('input')?.focus())
  }

  function stopRecording(): void {
    recording = null
    registry.setSuspended(false)
  }

  function onRecordKey(row: CommandBinding, e: KeyboardEvent): void {
    // Tab is how a keyboard user leaves the field; it must never be recorded.
    if (e.key === 'Tab') {
      stopRecording()
      return
    }
    // Escape belongs to the dialog's dismissal path, and `beforeClose` turns
    // it into "cancel the recording" (see there). Swallowing it here instead
    // would leave the dialog no way to tell a cancel from a close.
    if (e.key === 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    const binding = registry.bindingFor(e)
    if (!binding) return // modifiers only — the user is still reaching
    drafts[row.id] = binding
    stopRecording()
    commitHotkey(row)
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

  // ---- Developer ----
  let devtools = $state(devtoolsEnabled())

  // ---- closing: the dirty guard ----
  const dirty = $derived(general.dirty || sync.dirty)
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
        {:else if id === 'hotkeys'}
          <section data-testid="settings-hotkeys">
            <p class="text-xs text-base-content/70">{t.hotkeys.intro()}</p>
            <p class="mt-1 text-xs text-base-content/70">
              {@html t.hotkeys.syntax({ example: code(EXAMPLE_BINDING), mod: code('Mod') })}
            </p>
            {#if hotkeyGroups.length === 0}
              <p class="mt-3 text-xs text-base-content/70">{t.hotkeys.none()}</p>
            {/if}
            {#each hotkeyGroups as group (group.label)}
              <h3 class="mt-4 text-xs font-semibold tracking-wide text-base-content/70 uppercase">
                {group.label}
              </h3>
              <ul class="mt-1 space-y-2">
                {#each group.rows as row (row.id)}
                  <li data-testid="hotkey-row:{row.id}">
                    <Field name={row.id} errors={hotkeyErrors[row.id] ? [hotkeyErrors[row.id]] : []}>
                      <div class="flex flex-wrap items-center gap-2">
                        <span class="min-w-0 flex-1 truncate text-sm text-base-content/80">{row.title}</span>
                        <span
                          data-testid="hotkey-binding:{row.id}"
                          class="shrink-0 rounded border border-base-300 px-1.5 py-0.5 font-ed-mono text-xs text-base-content"
                        >
                          {row.display || t.hotkeys.unbound()}
                        </span>
                        <div class="w-44 shrink-0" bind:this={fields[row.id]}>
                          <TextControl
                            label={t.hotkeys.shortcut_for({ command: row.title })}
                            hideLabel
                            mono
                            bind:value={drafts[row.id]}
                            readonly={recording === row.id}
                            placeholder={recording === row.id ? t.hotkeys.recording() : t.hotkeys.placeholder()}
                            testid="hotkey-input:{row.id}"
                            onkeydown={(e: KeyboardEvent) => {
                              if (recording === row.id) onRecordKey(row, e)
                              else if (e.key === 'Enter') {
                                e.preventDefault()
                                commitHotkey(row)
                              }
                            }}
                            onblur={() => {
                              if (recording === row.id) stopRecording()
                              commitHotkey(row)
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          data-testid="hotkey-record:{row.id}"
                          aria-pressed={recording === row.id}
                          aria-label={recording === row.id
                            ? t.hotkeys.stop_recording({ command: row.title })
                            : t.hotkeys.record_for({ command: row.title })}
                          onclick={() => (recording === row.id ? stopRecording() : startRecording(row))}
                          class="shrink-0 rounded border border-base-300 px-2 py-1 text-xs font-medium text-base-content/80 hover:bg-base-200 aria-pressed:bg-primary aria-pressed:text-primary-content"
                        >
                          {recording === row.id ? t.hotkeys.recording() : t.hotkeys.record()}
                        </button>
                        <button
                          type="button"
                          data-testid="hotkey-reset:{row.id}"
                          disabled={!row.overridden}
                          aria-label={t.hotkeys.reset_for({ command: row.title })}
                          onclick={() => resetRow(row)}
                          class="shrink-0 rounded px-2 py-1 text-xs text-base-content/70 hover:bg-base-200 hover:text-base-content disabled:opacity-50"
                        >
                          {t.hotkeys.reset()}
                        </button>
                      </div>
                      <Description>
                        {row.defaultDisplay
                          ? t.hotkeys.default_is({ binding: row.defaultDisplay })
                          : t.hotkeys.default_none()}
                      </Description>
                      <!-- A collision is a command that quietly stopped
                           working (`match()` keeps the last registration), and
                           a chord the desktop eats never arrives at all. Both
                           are warnings about a key that is bound and does
                           nothing, so they read where the binding does. -->
                      {#if row.conflicts.length > 0 || row.reserved}
                        <p
                          data-testid="hotkey-warning:{row.id}"
                          class="mt-1 flex items-start gap-1.5 text-xs text-warning"
                        >
                          <TriangleAlert size={13} aria-hidden="true" class="mt-0.5 shrink-0" />
                          <span>
                            {#if row.conflicts.length > 0}
                              {t.hotkeys.conflict({ commands: list(row.conflicts) })}
                            {/if}
                            {#if row.reserved}
                              {t.hotkeys.reserved()}
                            {/if}
                          </span>
                        </p>
                      {/if}
                      <FieldErrors />
                    </Field>
                  </li>
                {/each}
              </ul>
            {/each}
          </section>
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
