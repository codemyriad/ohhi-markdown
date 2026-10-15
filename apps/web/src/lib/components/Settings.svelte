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
   * The nav is `ui/SettingsNav.svelte` — the tree of `SETTINGS_GROUPS`
   * (Customise › Editor · Layout · Appearance · Keys | Sync & devices · AI |
   * Developer · About, Fork 7) as one tablist. Narrow panes (a split, a
   * phone): Settings is the `settings` container and measures its own width
   * (a container query, not the viewport). Below 32rem the nav is an icon
   * rail (QA round 1, N3 — Chris: "I like the icon rail") and the section
   * takes the rest; a section's grids use container breakpoints (`@md:`), so
   * a split pane on a wide screen gets the narrow layout too.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Clock } from '@ohhi/vault'
  import {
    Bug,
    Cloud,
    Info,
    Keyboard,
    Palette,
    PanelsTopLeft,
    PenLine,
    SlidersHorizontal,
    Sparkles,
    type LucideIcon,
  } from '@lucide/svelte'
  import { hotkeys } from '../config.js'
  import { overridesToBindings } from '../keymap-spec.js'
  import { isTauri } from '../platform.js'
  import type { ProbeResult, SecretCheck } from '../relay-probe.js'
  import { NEEDS_VAULT, settingsRows, type SettingsSection } from '../settings.js'
  import { setSettingsEnv, type SettingsHost } from '../settings-host.js'
  import { getViewShell } from '../views.js'
  import { BUTTON, LEDE, META, TITLE } from '../ui/styles.js'
  import SettingsNav, { type NavRow } from '../ui/SettingsNav.svelte'
  import AboutSettings from './AboutSettings.svelte'
  import AiSettings from './AiSettings.svelte'
  import AppearanceSettings from './AppearanceSettings.svelte'
  import CustomiseSettings from './CustomiseSettings.svelte'
  import DeveloperSettings from './DeveloperSettings.svelte'
  import EditorSettings from './EditorSettings.svelte'
  import HotkeySettings from './HotkeySettings.svelte'
  import LayoutSettings from './LayoutSettings.svelte'
  import SyncSettings from './SyncSettings.svelte'

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

  /** One glyph per section: the rail's only mark, and the wide list's on top-level rows. */
  const ICONS: Record<SettingsSection, LucideIcon> = {
    customise: SlidersHorizontal,
    editor: PenLine,
    layout: PanelsTopLeft,
    appearance: Palette,
    keys: Keyboard,
    sync: Cloud,
    ai: Sparkles,
    developer: Bug,
    about: Info,
  }

  const ROWS = $derived<NavRow[]>(
    settingsRows().map((row, i, rows) => ({
      value: row.id,
      label: t.nav[row.id](),
      icon: ICONS[row.id],
      depth: row.depth,
      groupStart: i > 0 && rows[i - 1]!.group !== row.group,
      testid: `settings-tab:${row.id}`,
    }))
  )

  const uid = $props.id()
  const tabId = (v: string): string => `${uid}-tab-${v}`
  const panelId = (v: string): string => `${uid}-panel-${v}`

  const sid = $derived(section)

  /** One lede per section, under its title (QA round 1, the tighten-up). */
  const lede = $derived(
    (
      {
        customise: t.customise.intro,
        editor: t.editor.intro,
        layout: t.layout.intro,
        appearance: t.appearance.lede,
        keys: t.keys.intro,
        sync: t.sync.lede,
        ai: $LL.web.ai.settings.egress,
        developer: t.developer.lede,
        about: t.about.lede,
      } satisfies Record<SettingsSection, () => string>
    )[sid]()
  )

  /** A pick goes to the host; the host's move comes back as `section`. */
  function select(next: string): void {
    if (next !== section) onSection(next as SettingsSection)
  }
</script>

<div data-testid="settings" data-section={section} class="@container/settings flex min-h-full">
  <SettingsNav rows={ROWS} value={section} onSelect={select} label={t.sections()} {tabId} {panelId} testid="settings-tabs" />
  <div
    role="tabpanel"
    id={panelId(section)}
    aria-labelledby={tabId(section)}
    class="min-w-0 flex-1 px-7 pt-5.5 @max-[32rem]/settings:px-4 @max-[32rem]/settings:pt-4"
  >
    <div class="@container max-w-2xl pb-8" data-testid="settings-section:{sid}">
      <h2 class={TITLE}>{t.nav[sid]()}</h2>
      <p class="mt-1.5 mb-6 {LEDE}" data-testid="settings-lede:{sid}">{lede}</p>
      {#if NEEDS_VAULT.has(sid) && !vaultOpen}
        <div
          data-testid="settings-needs-vault:{sid}"
          class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed border-base-300 px-3 py-2.5"
        >
          <div class="min-w-0 flex-1">
            <p class="text-[13px] text-base-content">{t.needs_vault.body()}</p>
            <p class={META}>{sid === 'keys' ? t.needs_vault.keys() : t.needs_vault.customise()}</p>
          </div>
          {#if onManageVaults}
            <button type="button" data-testid="settings-needs-vault-open" onclick={onManageVaults} class={BUTTON}>
              {t.needs_vault.open()}
            </button>
          {/if}
        </div>
      {:else if sid === 'editor'}
        <EditorSettings {registry} {layout} />
      {:else if sid === 'layout'}
        {#if !vaultOpen}
          <p class="mb-3 {META}" data-testid="settings-layout-no-vault">{t.layout.no_vault()}</p>
        {/if}
        {#if layout}<LayoutSettings {layout} {registry} />{/if}
      {:else if sid === 'appearance'}
        <AppearanceSettings {readAppFile} themes={resources?.themes} />
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
      {:else if sid === 'ai'}
        <AiSettings />
      {:else if sid === 'developer'}
        <DeveloperSettings {onConfigChange} />
      {:else if sid === 'about'}
        <AboutSettings {desktop} {clock} />
      {/if}
    </div>
  </div>
</div>
