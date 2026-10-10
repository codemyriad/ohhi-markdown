<script lang="ts">
  /**
   * Settings, host-neutral (settings-shaping ST1/ST2): the grouped nav and
   * the section on show. Two hosts render it — the `settings` view tab
   * (`SettingsView.svelte`, beside your notes) and the manager's page
   * (`SettingsPage.svelte`, no vault open) — so there is one Settings.
   *
   * One save model (R3): every control applies as it changes; a text field
   * that needs validation (the name, the relay) commits on Enter or when it
   * is left; Keys writes each change through, with Undo (ST3). There is no
   * Save button and no close guard.
   *
   * Sections are their own components, each handed the props it needs; what
   * a section may ask about where it is drawn (vault open, desktop, the host,
   * moving to another section) is the `SettingsEnv` context set here
   * (`settings-host.ts`). A section in `NEEDS_VAULT` says "open a vault to
   * change this" when none is open, rather than hiding.
   *
   * Narrow panes (a split, a phone): the nav and each section measure their
   * own width (container queries, not the viewport). Below 32rem the nav is
   * a `<select>` above the section (`Tabs`' `collapse`); a section's grids
   * use container breakpoints (`@md:`), so a split pane on a wide screen
   * gets the narrow layout too.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import { untrack } from 'svelte'
  import { hotkeys } from '../config.js'
  import { overridesToBindings } from '../keymap-spec.js'
  import { isTauri } from '../platform.js'
  import type { ProbeResult, SecretCheck } from '../relay-probe.js'
  import { NEEDS_VAULT, SETTINGS_GROUPS, type SettingsSection } from '../settings.js'
  import { setSettingsEnv, type SettingsHost } from '../settings-host.js'
  import { getViewShell } from '../views.js'
  import { OUTLINE_BUTTON } from '../ui/styles.js'
  import Tabs from '../ui/Tabs.svelte'
  import AboutSettings from './AboutSettings.svelte'
  import AgentSettings from './AgentSettings.svelte'
  import AppearanceSettings from './AppearanceSettings.svelte'
  import CustomiseSettings from './CustomiseSettings.svelte'
  import DeveloperSettings from './DeveloperSettings.svelte'
  import EditorSettings from './EditorSettings.svelte'
  import HotkeySettings from './HotkeySettings.svelte'
  import LayoutSettings from './LayoutSettings.svelte'
  import SyncSettings from './SyncSettings.svelte'
  import YouSettings from './YouSettings.svelte'

  interface Props extends SettingsHost {
    /** The section on show (the view tab's `viewArg`, or the page's own state). */
    section: SettingsSection
    /** The nav picked another section: the host moves (the view tab's `viewArg` follows). */
    onSection: (section: SettingsSection) => void
    /** Which host draws it. */
    host?: 'view' | 'page'
    /** The desktop app; default: the platform's answer. */
    desktop?: boolean
    // ---- environment for Sync & devices and About, injectable for tests ----
    clock?: Clock
    probe?: (relayUrl: string) => Promise<ProbeResult>
    verify?: (relayUrl: string, secret: string) => Promise<SecretCheck>
    pinnedHost?: string
    teamRelay?: string
    networkNote?: string
    secretHint?: string
  }

  let {
    section,
    onSection,
    host = 'view',
    desktop = isTauri(),
    registry,
    layout,
    resources,
    keymap,
    readAppFile,
    vault,
    relays,
    onLinkDevice,
    onManageVaults,
    onConfigChange,
    clock,
    probe,
    verify,
    pinnedHost,
    teamRelay,
    networkNote,
    secretHint,
  }: Props = $props()

  /**
   * Customise's *Show in Log* (ST6): the Log on its Customise filter — in the
   * view tab only (the manager's page has no workspace on screen to open it in).
   */
  const viewShell = getViewShell()
  const showLog = $derived(viewShell && host === 'view' ? (): void => viewShell.openView('log', 'customise') : undefined)

  const t = $derived($LL.web.settings)
  const vaultOpen = $derived(vault != null)

  setSettingsEnv({
    get vaultOpen() {
      return vaultOpen
    },
    get vault() {
      return vault
    },
    get desktop() {
      return desktop
    },
    get host() {
      return host
    },
    openSection: (next) => onSection(next),
    manageVaults: () => onManageVaults?.(),
  })

  const TABS = $derived(
    SETTINGS_GROUPS.flatMap((group, g) =>
      group.map((value, i) => ({
        value,
        label: t.nav[value](),
        testid: `settings-tab:${value}`,
        separated: g > 0 && i === 0,
      }))
    )
  )

  /** Bound to the nav; a pick goes to the host, a host move comes back through `section`. */
  // svelte-ignore state_referenced_locally -- seed only; the effects below keep the two in step
  let current = $state<string>(section)
  $effect(() => {
    const next = section
    untrack(() => {
      if (current !== next) current = next
    })
  })
  $effect(() => {
    const picked = current as SettingsSection
    untrack(() => {
      if (picked !== section) onSection(picked)
    })
  })
</script>

<div data-testid="settings" data-section={section} class="h-full min-h-0">
  <Tabs tabs={TABS} bind:value={current} orientation="vertical" collapse label={t.sections()} testid="settings-tabs">
    {#snippet panel(id)}
      {@const sid = id as SettingsSection}
      <div class="@container max-w-2xl pb-8" data-testid="settings-section:{sid}">
        <h2 class="mb-3 text-base font-semibold text-base-content">{t.nav[sid]()}</h2>
        {#if NEEDS_VAULT.has(sid) && !vaultOpen}
          <div data-testid="settings-needs-vault:{sid}" class="space-y-2">
            <p class="text-sm text-base-content/80">{t.needs_vault.body()}</p>
            <p class="text-xs text-base-content/70">
              {sid === 'keys' ? t.needs_vault.keys() : t.needs_vault.customise()}
            </p>
            {#if onManageVaults}
              <button
                type="button"
                data-testid="settings-needs-vault-open"
                onclick={onManageVaults}
                class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs font-medium text-base-content/80"
              >
                {t.needs_vault.open()}
              </button>
            {/if}
          </div>
        {:else if sid === 'you'}
          <YouSettings {onConfigChange} />
        {:else if sid === 'editor'}
          <EditorSettings {registry} {layout} />
        {:else if sid === 'layout'}
          {#if !vaultOpen}
            <p class="mb-3 text-xs text-base-content/70" data-testid="settings-layout-no-vault">{t.layout.no_vault()}</p>
          {/if}
          {#if layout}<LayoutSettings {layout} {registry} />{/if}
        {:else if sid === 'appearance'}
          <AppearanceSettings {readAppFile} />
        {:else if sid === 'keys'}
          <HotkeySettings
            {registry}
            {keymap}
            {resources}
            canSave={keymap !== undefined && readAppFile !== undefined}
            legacy={() => overridesToBindings(hotkeys())}
            onShowLog={showLog}
          />
        {:else if sid === 'sync'}
          <SyncSettings
            {relays}
            {onLinkDevice}
            {onManageVaults}
            {onConfigChange}
            {desktop}
            {clock}
            {probe}
            {verify}
            {pinnedHost}
            {teamRelay}
            {networkNote}
            {secretHint}
          />
        {:else if sid === 'customise'}
          <CustomiseSettings {registry} {resources} {layout} {keymap} showLog={showLog} />
        {:else if sid === 'agents'}
          <AgentSettings />
        {:else if sid === 'developer'}
          <DeveloperSettings {onConfigChange} />
        {:else if sid === 'about'}
          <AboutSettings {desktop} {clock} />
        {/if}
      </div>
    {/snippet}
  </Tabs>
</div>
