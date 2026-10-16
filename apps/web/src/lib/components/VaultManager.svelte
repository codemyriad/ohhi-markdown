<script lang="ts">
  /**
   * The vault manager (first-run A1/B1, superseding shell-polish P4's two
   * columns). Two states of one screen:
   *
   *  - **the welcome** — no vault registered: "Oh hi.", one sentence and the
   *    doors worded as the thing you have (a folder of notes / a vault in
   *    this browser, a folder someone shared, your vault on another device);
   *  - **the list** — one row per vault with what it is (kind, where, when
   *    last opened, what its mount table says is shared), one *Add* menu
   *    holding the same doors plus Import, and the identity and the
   *    remembered links demoted to the foot.
   *
   * The name sent to peers is not asked here any more (Fork 5-A): Settings ›
   * General keeps it, and `defaultUser` is passed through to every flow as
   * before. One accent on the page: the first door, or the Add button.
   */
  import {
    ChevronDown,
    ChevronRight,
    CircleQuestionMark,
    Folder,
    Globe,
    HardDrive,
    Laptop,
    MoreHorizontal,
    Settings,
    Users,
    X,
  } from '@lucide/svelte'
  import { untrack } from 'svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL, locale } from '@ohhi/i18n/i18n-svelte'
  import type { StoredShare, VaultEntry } from '../config.js'
  import { guideHref, openGuide } from '../guide.js'
  import type { JoinOutcome } from '../manager.svelte.js'
  import type { SettingsSection } from '../settings.js'
  import { realClock } from '../real-clock.js'
  import type { Probe } from '../relay-check.js'
  import { formatBytes } from '../storage-persistence.js'
  import { storageState } from '../storage.svelte.js'
  import { openedWhen, type VaultFacts } from '../vault-facts.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import Field from '../ui/Field.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import MenuSeparator from '../ui/MenuSeparator.svelte'
  import Popover from '../ui/Popover.svelte'
  import TextControl from '../ui/TextControl.svelte'
  import { CARD, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import DesktopDownload from './DesktopDownload.svelte'
  import AddSharedFolderDialog from './AddSharedFolderDialog.svelte'
  import HelpMenu from './HelpMenu.svelte'
  import ImportDialog from './ImportDialog.svelte'

  interface Props {
    isTauri: boolean
    /**
     * The phone app (docs/mobile-android.md): Tauri, but its vaults live in
     * the app's own storage, as a browser's do; the copy says "this phone".
     */
    isMobile?: boolean
    hasOpfs: boolean
    /** The saved name ('' = none): passed through to every flow, never asked here (Fork 5-A). */
    defaultUser: string
    vaults: VaultEntry[]
    shares: StoredShare[]
    prefillLink: string
    /**
     * Boot failure to surface — attached to its vault row when room matches.
     * `access`: the desktop fs scope refused the folder (DEL-89); the row
     * offers to allow access again.
     */
    failure: { room: string | null; message: string; access?: true } | null
    busy: boolean
    /** Shown when a workspace is open behind the manager (switcher route). */
    canGoBack: boolean
    /** The room open behind the manager, marked `aria-current` in the list. */
    currentRoom: string | null
    /** Row facts per room from each vault's mount table (`null` = unreadable). */
    facts?: Readonly<Record<string, VaultFacts | null>>
    /** The open vault's facts, live from the workspace; preferred for `currentRoom`. */
    openFacts?: VaultFacts | null
    /** Asked once when the list shows: (re)read the rows' facts. */
    onLoadFacts?: () => void
    onOpenVault: (entry: VaultEntry) => void
    onRemoveVault: (room: string) => void
    /** Rename the registry entry (this list's name), never the folder. */
    onRenameVault?: (room: string, name: string) => void
    /** Reopen the picker on a refused vault's folder (DEL-89). */
    onAllowAccess: (room: string) => void
    onOpenFolder: (name: string) => void
    onCreateBrowserVault: (name: string, vaultName: string) => void
    /**
     * Open a share as its own vault. Resolving the join's outcome lets the
     * Add dialog keep the paste when the desktop folder picker is cancelled
     * (`cancelled`) and say why when it failed (`failed`).
     */
    onJoin: (name: string, link: string) => void | Promise<JoinOutcome | void>
    /**
     * The vault open behind the manager, offered by *Add a shared folder* as
     * a destination beside "as its own vault" (sharing E4); null = none open.
     */
    joinInto?: { vaultName: string; dirs: string[]; join: (link: string, dest: string) => Promise<void> } | null
    /** Open the "Link this device…" dialog (device-link N2, A1). */
    onLinkDevice: (name: string) => void
    onBack: () => void
    /** Settings on the manager's page, at `section` (the welcome's *Connect an agent* → `agents`). */
    onSettings: (section?: SettingsSection) => void
    /** Forget a remembered share link (moved here from Settings' old Vaults & shares). */
    onForgetShare?: (room: string) => void
    /** The browser-storage note, decided by App; null = hidden. `outcome` is the user's own ask. */
    storageNote: { canAsk: boolean; outcome: 'refused' | 'granted' | null } | null
    /** Must call `persist()` synchronously: Firefox wants the click's gesture. */
    onKeepStorage: () => void
    onDismissStorage: () => void
    /** The wall clock, for "opened today". */
    now?: () => number
    /** The Add dialog's relay health check; tests hand in a fake (default: the network). */
    probe?: Probe
  }

  let {
    isTauri,
    isMobile = false,
    hasOpfs,
    defaultUser,
    vaults,
    shares,
    prefillLink,
    failure,
    busy,
    canGoBack,
    currentRoom,
    facts = {},
    openFacts = null,
    onLoadFacts,
    onOpenVault,
    onRemoveVault,
    onRenameVault,
    onAllowAccess,
    onOpenFolder,
    onCreateBrowserVault,
    onJoin,
    joinInto = null,
    onLinkDevice,
    onBack,
    onSettings,
    onForgetShare,
    storageNote,
    onKeepStorage,
    onDismissStorage,
    now = () => realClock.now(),
    probe,
  }: Props = $props()

  const t = $derived($LL.web.manager)
  const w = $derived($LL.web.manager.welcome)
  const l = $derived($LL.web.manager.list)
  const st = $derived($LL.web.storage)

  /** The saved name, handed to every flow exactly as the name field used to. */
  const name = $derived(defaultUser.trim())
  const browserBlocked = $derived(!isTauri && !hasOpfs)
  const welcome = $derived(vaults.length === 0)

  // A `?share=` link arrives with the dialog already open on it, from either state.
  // svelte-ignore state_referenced_locally
  let joinOpen = $state(prefillLink !== '')
  let importOpen = $state(false)
  /** The browser door is asking for the new vault's name (welcome), or the Add menu's dialog is (list). */
  let naming = $state(false)
  let newVaultOpen = $state(false)
  let newVaultName = $state('')
  /** Room whose inline confirm row is showing (Remove is never one click). */
  let confirmRemove = $state<string | null>(null)
  let renaming = $state<VaultEntry | null>(null)
  let renameValue = $state('')
  let rememberedAnchor = $state<HTMLElement | null>(null)

  /** The desktop build's version, from the same source Settings › About reads. */
  let appVersion = $state<string | null>(null)
  // svelte-ignore state_referenced_locally -- the platform is fixed for the page's life
  if (isTauri) {
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((v) => (appVersion = v))
      .catch(() => {})
  }

  // The list's facts are read when it shows, and again when the rows change.
  $effect(() => {
    if (welcome) return
    void vaults.length
    untrack(() => onLoadFacts?.())
  })

  const chrome =
    'rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'
  /**
   * The page's one accent: the Add button, or the button that creates a
   * browser vault. No lighter hover tint: `primary/90` under white text drops
   * below 4.5:1, and the pointer is still on the trigger while its menu is open.
   */
  const primary =
    'rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content shadow-sm hover:shadow-md focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
  const outline = `${OUTLINE_BUTTON} px-4 py-2 text-sm font-medium text-base-content/80 disabled:opacity-50`
  const textLink =
    'font-medium text-base-content underline underline-offset-2 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary'
  const chip = 'shrink-0 rounded bg-base-200 px-1.5 py-px text-[11px] font-medium text-base-content/80'

  function createInBrowser(): void {
    const vaultName = newVaultName.trim()
    if (!vaultName) return
    onCreateBrowserVault(name, vaultName)
    newVaultName = ''
    naming = false
    newVaultOpen = false
  }

  /**
   * The guide link: a real anchor in the browser (a new tab, as `openGuide`
   * opens one there); on the desktop, where an anchor's new tab goes nowhere
   * (no opener plugin), `openGuide`'s own window instead.
   */
  function onGuide(e: MouseEvent): void {
    if (!isTauri) return
    e.preventDefault()
    void openGuide('start')
  }

  /** The Add dialog's "as its own vault": the TYPED name, and the join's outcome back to the dialog. */
  async function joinAsVault(link: string, typed: string): Promise<boolean | void> {
    const outcome = await onJoin(typed, link)
    if (!outcome) return
    if (outcome.kind === 'cancelled') return false
    if (outcome.kind === 'failed') throw new Error(outcome.message)
  }

  /** Focus a control the moment it appears (the browser door's name field). */
  function focusOnMount(node: HTMLElement): void {
    node.querySelector<HTMLElement>('input')?.focus()
  }

  // ---- a row's facts ----
  const factsOf = (entry: VaultEntry): VaultFacts | null | undefined =>
    entry.room === currentRoom && openFacts ? openFacts : facts[entry.room]

  function opened(entry: VaultEntry): string | null {
    if (!entry.lastOpenedAt) return null
    const when = openedWhen(entry.lastOpenedAt, now(), $locale)
    if (when.kind === 'today') return l.opened_today()
    if (when.kind === 'yesterday') return l.opened_yesterday()
    return l.opened_on({ date: when.date })
  }

  function sub(entry: VaultEntry): string {
    const parts: string[] = []
    if (entry.vault.kind === 'tauri') {
      parts.push(entry.vault.path)
      const o = opened(entry)
      if (o) parts.push(o)
    } else if (entry.vault.kind === 'opfs') {
      parts.push(isMobile ? l.in_phone() : l.in_browser())
      // The browser reports usage for the whole site, so the line says so.
      if (storageState.usage) parts.push(l.site_usage({ used: formatBytes(storageState.usage.usage, $locale) }))
      if (storageState.state === 'persisted') parts.push(l.storage_kept())
      else if (storageState.state !== 'unknown') parts.push(l.storage_may_clear())
    } else {
      parts.push(t.memory_vault())
    }
    return parts.join(' · ')
  }

  /** The row's kind glyph: a folder on disk, a browser vault, or one that cannot open. */
  const glyphOf = (entry: VaultEntry): typeof Folder =>
    failure?.room === entry.room ? HardDrive : entry.vault.kind === 'tauri' ? Folder : Globe
</script>

{#snippet door(opts: {
  icon: typeof Folder
  title: string
  hint: string
  testid: string
  accent?: boolean
  expanded?: boolean
  onclick: () => void
})}
  <button
    type="button"
    data-testid={opts.testid}
    disabled={busy}
    aria-expanded={opts.expanded}
    onclick={opts.onclick}
    class="flex w-full items-center gap-4 rounded-lg px-4 py-3.5 text-left hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
  >
    <span
      class="flex size-9 shrink-0 items-center justify-center rounded-md {opts.accent
        ? 'bg-primary text-primary-content'
        : 'bg-base-200 text-base-content/80'}"
    >
      <opts.icon size={18} strokeWidth={1.75} aria-hidden="true" />
    </span>
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-semibold">{opts.title}</span>
      <span class="mt-0.5 block text-xs text-base-content/70">{opts.hint}</span>
    </span>
    <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" class="shrink-0 text-base-content/70" />
  </button>
{/snippet}

{#snippet storageLine()}
  {#if storageNote}
    <!-- A note, not an alert: the browser's refusal is nobody's fault. The
         outcome line is a live region, rendered before it changes. -->
    <div data-testid="storage-note" class="px-4 pb-3 pl-[4.25rem] text-xs text-base-content/70">
      {#if storageNote.canAsk}
        <button type="button" data-testid="storage-keep" onclick={onKeepStorage} class={textLink}>
          {st.ask()}
        </button>
      {/if}
      <p role="status" data-testid="storage-note-outcome" class={storageNote.outcome ? 'mt-1' : ''}>
        {storageNote.outcome === 'granted'
          ? st.granted()
          : storageNote.outcome === 'refused'
            ? st.refused()
            : ''}
      </p>
    </div>
  {/if}
{/snippet}

{#snippet settingsButton()}
  <IconButton
    label={t.settings()}
    icon={Settings}
    size="md"
    testid="manager-settings"
    onclick={() => onSettings()}
  />
{/snippet}

<!-- The Help menu, not just the guide, in both states: Report a problem must
     be reachable from here, where a vault that will not open leaves people. -->
{#snippet helpButton()}
  <HelpMenu testid="manager-help">
    {#snippet trigger(attrs)}
      <button
        use:melt={attrs}
        type="button"
        aria-label={t.help()}
        title={t.help()}
        data-testid="manager-help"
        class="inline-flex shrink-0 items-center rounded p-1.5 text-base-content/70 hover:bg-base-200 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
      >
        <CircleQuestionMark size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
    {/snippet}
  </HelpMenu>
{/snippet}

{#snippet topError()}
  {#if failure && !failure.room}
    <p role="alert" data-testid="manager-error" class="rounded bg-error/10 px-3 py-2 text-sm text-error">
      {failure.message}
    </p>
  {/if}
{/snippet}

{#if welcome}
  <!-- ======================= the welcome (A1) ======================= -->
  <div class="flex min-h-full flex-col text-base-content">
    <header class="flex items-center justify-between gap-4 border-b border-base-300 px-5 py-2.5">
      <span class="text-sm font-semibold">{$LL.common.app_name()}</span>
      <div class="flex items-center gap-1">
        {#if appVersion}
          <span data-testid="manager-version" class="mr-2 text-xs text-base-content/70">
            {t.version({ version: appVersion })}
          </span>
        {/if}
        {#if canGoBack}
          <button data-testid="manager-back" onclick={onBack} class={chrome}>{t.back()}</button>
        {/if}
        {@render helpButton()}
        {@render settingsButton()}
      </div>
    </header>

    <main class="mx-auto w-full max-w-[560px] flex-1 px-4 py-12 sm:py-16" data-testid="manager-welcome">
      {@render topError()}
      <h1 class="mt-4 text-3xl font-semibold">{w.title()}</h1>
      <p class="mt-2 text-sm text-base-content/80">{w.lede()}</p>

      <ul aria-label={w.doors()} class="mt-8 flex flex-col divide-y divide-base-300 {CARD}">
        {#if isTauri}
          <li>
            {@render door({
              icon: Folder,
              title: w.folder(),
              hint: w.folder_hint(),
              testid: 'open-folder',
              accent: true,
              onclick: () => onOpenFolder(name),
            })}
          </li>
        {:else if browserBlocked}
          <li class="px-4 py-3.5">
            <p role="alert" class="text-xs text-warning">{t.no_opfs()}</p>
          </li>
        {:else}
          <li>
            {@render door({
              icon: Globe,
              title: isMobile ? w.phone() : w.browser(),
              hint: isMobile ? w.phone_hint() : w.browser_hint(),
              testid: 'start-browser-vault',
              accent: true,
              expanded: naming,
              onclick: () => (naming = !naming),
            })}
            {@render storageLine()}
            {#if naming}
              <form
                use:focusOnMount
                class="flex flex-wrap items-end gap-2 px-4 pb-4 pl-[4.25rem]"
                onsubmit={(e) => {
                  e.preventDefault()
                  createInBrowser()
                }}
              >
                <Field name="vault-name" class="min-w-40 flex-1">
                  <TextControl
                    label={t.vault_name_placeholder()}
                    bind:value={newVaultName}
                    placeholder={t.vault_name_placeholder()}
                    testid="new-vault-name"
                  />
                </Field>
                <button type="submit" data-testid="create-vault" disabled={busy || !newVaultName.trim()} class={primary}>
                  {t.create_vault()}
                </button>
              </form>
            {/if}
          </li>
        {/if}
        {#if !browserBlocked}
          <li>
            {@render door({
              icon: Users,
              title: w.shared(),
              hint: w.shared_hint(),
              testid: 'join-share',
              onclick: () => (joinOpen = true),
            })}
          </li>
          <li>
            {@render door({
              icon: Laptop,
              title: w.device(),
              hint: w.device_hint(),
              testid: 'open-link-device',
              onclick: () => onLinkDevice(name),
            })}
          </li>
        {/if}
      </ul>

      <footer class="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs text-base-content/70">
        <p>
          {w.import_lead()}
          <button type="button" data-testid="open-import" onclick={() => (importOpen = true)} class={textLink}>
            {w.import_link()}
          </button>
        </p>
        <span class="flex flex-wrap items-center gap-3">
          <!-- settings-shaping ST6: Settings › AI (its Outside agents group) works with no vault open; an
               agent needs a folder on disk, so the door is the desktop app's. -->
          {#if isTauri}
            <button type="button" data-testid="manager-agents" onclick={() => onSettings('ai')} class={textLink}>
              {w.agents()}
            </button>
          {/if}
          <a href={guideHref('start')} target="_blank" rel="noreferrer" onclick={onGuide} data-testid="manager-guide" class={textLink}>
            {w.guide()}
          </a>
        </span>
      </footer>
    </main>
  </div>
{:else}
  <!-- ======================= the list (B1) ======================= -->
  <main class="mx-auto min-h-full w-full max-w-3xl px-4 py-10 text-base-content sm:px-8" data-testid="manager-list">
    <header class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-xl font-semibold">{l.title()}</h1>
      <div class="flex items-center gap-2">
        {#if canGoBack}
          <button data-testid="manager-back" onclick={onBack} class={chrome}>{t.back()}</button>
        {/if}
        <DropdownMenu placement="bottom-end" testid="manager-add-menu">
          {#snippet trigger(attrs)}
            <button
              use:melt={attrs}
              type="button"
              data-testid="manager-add"
              disabled={busy}
              class="inline-flex items-center gap-1.5 {primary}"
            >
              <span aria-hidden="true">+</span>
              {l.add()}
              <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
            </button>
          {/snippet}
          {#snippet children({ item, separator })}
            {#if isTauri}
              <MenuItem {item} testid="open-folder" onSelect={() => onOpenFolder(name)}>{l.add_folder()}</MenuItem>
            {:else if !browserBlocked}
              <MenuItem {item} testid="add-browser-vault" onSelect={() => (newVaultOpen = true)}>
                {isMobile ? l.add_phone() : l.add_browser()}
              </MenuItem>
            {/if}
            {#if !browserBlocked}
              <MenuItem {item} testid="join-share" onSelect={() => (joinOpen = true)}>{l.add_shared()}</MenuItem>
              <MenuItem {item} testid="open-link-device" onSelect={() => onLinkDevice(name)}>{l.add_device()}</MenuItem>
            {/if}
            <MenuSeparator {separator} />
            <MenuItem {item} testid="open-import" onSelect={() => (importOpen = true)}>{l.add_import()}</MenuItem>
          {/snippet}
        </DropdownMenu>
        {@render helpButton()}
        {@render settingsButton()}
      </div>
    </header>

    <div class="mt-4 flex flex-col gap-3">
      {@render topError()}
      {#if browserBlocked}
        <p role="alert" class="text-xs text-warning">{t.no_opfs()}</p>
      {/if}

      {#if storageNote}
        <section aria-labelledby="storage-note-title" data-testid="storage-note" class="{CARD} p-4">
          <h2 id="storage-note-title" class="flex items-center gap-2 {HEADING}">
            <HardDrive size={16} strokeWidth={1.75} aria-hidden="true" />
            {st.title()}
          </h2>
          {#if storageNote.outcome !== 'granted'}
            <p class="mt-1.5 text-xs text-base-content/70">{st.body()}</p>
            <p class="mt-1 text-xs text-base-content/70">{st.advice()}</p>
            <div class="mt-1 text-xs"><DesktopDownload variant="line" /></div>
          {/if}
          <p role="status" data-testid="storage-note-outcome" class="text-xs {storageNote.outcome ? 'mt-2' : ''}">
            {storageNote.outcome === 'granted'
              ? st.granted()
              : storageNote.outcome === 'refused'
                ? st.refused()
                : ''}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            {#if storageNote.canAsk}
              <button type="button" data-testid="storage-keep" onclick={onKeepStorage} class="{OUTLINE_BUTTON} px-3 py-1.5 text-xs font-medium text-base-content/80">
                {st.ask()}
              </button>
            {/if}
            <button
              type="button"
              data-testid="storage-dismiss"
              onclick={onDismissStorage}
              class="rounded px-3 py-1.5 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
            >
              {st.dismiss()}
            </button>
          </div>
        </section>
      {/if}

      <ul class="divide-y divide-base-300 {CARD}" aria-label={l.title()}>
        {#each vaults as entry (entry.room)}
          {@const Glyph = glyphOf(entry)}
          {@const f = factsOf(entry)}
          {@const failed = failure?.room === entry.room}
          <li data-testid="vault-row:{entry.room}" class={failed ? 'bg-error/10' : ''}>
            <div class="flex items-center gap-2 py-1 pr-2 pl-1">
              <button
                data-testid="open-vault:{entry.room}"
                disabled={busy}
                aria-current={canGoBack && entry.room === currentRoom ? 'true' : undefined}
                onclick={() => onOpenVault(entry)}
                class="flex min-w-0 flex-1 items-center gap-3 rounded px-2 py-1.5 text-left leading-5 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
              >
                <Glyph
                  size={18}
                  strokeWidth={1.75}
                  aria-hidden="true"
                  class="shrink-0 {failed ? 'text-error' : 'text-base-content/70'}"
                />
                <span class="min-w-0 flex-1">
                  <span class="flex items-center gap-1.5">
                    <span class="truncate text-sm font-medium">{entry.name}</span>
                    {#if canGoBack && entry.room === currentRoom}
                      <span data-testid="open-now:{entry.room}" class={chip}>{l.open_now()}</span>
                    {/if}
                  </span>
                  <span class="block truncate font-ed-mono text-xs text-base-content/70">{sub(entry)}</span>
                </span>
              </button>
              <span class="hidden shrink-0 flex-wrap justify-end gap-1 sm:flex" data-testid="vault-facts:{entry.room}">
                {#if entry.relay}
                  <span class={chip}>{t.linked_badge()}</span>
                {/if}
                {#if f === null}
                  <span class={chip} role="img" aria-label={l.facts_unknown()}>—</span>
                {:else if f}
                  {#if f.sharedByYou > 0}
                    <span class={chip}>{l.shared_by_you({ count: f.sharedByYou })}</span>
                  {/if}
                  {#if f.sharedWithYou > 0}
                    <span class={chip}>{l.shared_with_you({ count: f.sharedWithYou })}</span>
                  {/if}
                  {#if f.sharedByYou === 0 && f.sharedWithYou === 0 && !entry.relay}
                    <span class={chip}>{l.nothing_shared()}</span>
                  {/if}
                {/if}
              </span>
              <DropdownMenu placement="bottom-end" testid="vault-menu:{entry.room}">
                {#snippet trigger(attrs)}
                  <button
                    use:melt={attrs}
                    type="button"
                    aria-label={t.row_menu({ name: entry.name })}
                    data-testid="vault-more:{entry.room}"
                    class="shrink-0 rounded p-1.5 text-base-content/70 hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                {/snippet}
                {#snippet children({ item, separator })}
                  <MenuItem {item} testid="vault-open:{entry.room}" onSelect={() => onOpenVault(entry)}>
                    {l.open()}
                  </MenuItem>
                  {#if onRenameVault}
                    <MenuItem
                      {item}
                      testid="rename-vault:{entry.room}"
                      onSelect={() => {
                        renameValue = entry.name
                        renaming = entry
                      }}
                    >
                      {l.rename()}
                    </MenuItem>
                  {/if}
                  <MenuSeparator {separator} />
                  <MenuItem {item} testid="remove-vault:{entry.room}" danger onSelect={() => (confirmRemove = entry.room)}>
                    {t.remove_item()}
                  </MenuItem>
                {/snippet}
              </DropdownMenu>
            </div>
            {#if failed && failure}
              <div class="px-3 pb-2 pl-11">
                <p role="alert" data-testid="vault-error:{entry.room}" class="text-xs text-error">
                  {failure.access ? failure.message : t.vault_error({ message: failure.message })}
                </p>
                <div class="mt-1.5 flex flex-wrap gap-2">
                  {#if failure.access}
                    <!-- Refused by the fs scope (DEL-89): trying again would be refused
                         again, so the way on is re-granting the folder. -->
                    <button
                      type="button"
                      data-testid="allow-access:{entry.room}"
                      disabled={busy}
                      onclick={() => onAllowAccess(entry.room)}
                      class="{OUTLINE_BUTTON} px-2.5 py-1 text-xs font-medium text-base-content/80 disabled:opacity-50"
                    >
                      {t.allow_access()}
                    </button>
                  {:else}
                    <button
                      type="button"
                      data-testid="retry-vault:{entry.room}"
                      disabled={busy}
                      onclick={() => onOpenVault(entry)}
                      class="{OUTLINE_BUTTON} px-2.5 py-1 text-xs font-medium text-base-content/80 disabled:opacity-50"
                    >
                      {l.try_again()}
                    </button>
                  {/if}
                  <button
                    type="button"
                    data-testid="remove-failed:{entry.room}"
                    onclick={() => (confirmRemove = entry.room)}
                    class="rounded px-2.5 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {t.remove_item()}
                  </button>
                </div>
              </div>
            {/if}
            {#if confirmRemove === entry.room}
              <!-- Named as a group so the two verbs below carry the vault
                   they act on without repeating it in their own labels. -->
              <div
                role="group"
                aria-label={t.remove({ name: entry.name })}
                class="mx-3 mb-3 rounded border border-base-300 bg-base-100 px-3 py-2"
              >
                <p data-testid="remove-note:{entry.room}" class="text-xs text-base-content/70">
                  {entry.vault.kind === 'opfs' ? t.remove_note_opfs() : t.remove_note_disk()}
                </p>
                <div class="mt-2 flex gap-2">
                  <button
                    data-testid="remove-confirm:{entry.room}"
                    disabled={busy}
                    onclick={() => {
                      confirmRemove = null
                      onRemoveVault(entry.room)
                    }}
                    class="rounded bg-error px-2.5 py-1 text-xs font-medium text-error-content hover:bg-error/90 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  >
                    {t.remove_confirm()}
                  </button>
                  <button
                    data-testid="remove-cancel:{entry.room}"
                    onclick={() => (confirmRemove = null)}
                    class="rounded px-2.5 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
                  >
                    {$LL.common.cancel()}
                  </button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      <footer class="mt-1 flex flex-wrap items-center justify-between gap-3 px-1 text-xs text-base-content/70">
        <p data-testid="manager-identity">
          {l.identity({ name: name || t.anonymous() })}
          ·
          <button type="button" data-testid="manager-identity-change" onclick={() => onSettings()} class={textLink}>
            {l.identity_change()}
          </button>
        </p>
        {#if shares.length > 0}
          <button
            type="button"
            data-testid="manager-remembered"
            aria-haspopup="dialog"
            aria-expanded={rememberedAnchor !== null}
            onclick={(e) => (rememberedAnchor = e.currentTarget)}
            class={textLink}
          >
            {l.remembered({ count: shares.length })}
          </button>
        {/if}
      </footer>
    </div>
  </main>
{/if}

{#if rememberedAnchor}
  <Popover
    anchor={rememberedAnchor}
    placement="top-end"
    title={l.remembered_title()}
    testid="manager-remembered-list"
    onClose={() => (rememberedAnchor = null)}
  >
    <div class="w-72 p-3">
      <h2 class={HEADING}>{l.remembered_title()}</h2>
      <p class="mt-1 text-xs text-base-content/70">{l.remembered_hint()}</p>
      <ul class="mt-2">
        {#each shares as share (share.room)}
          <li class="flex items-center gap-1">
            <button
              data-testid="remembered-share:{share.room}"
              onclick={() => {
                rememberedAnchor = null
                void onJoin(name, share.link)
              }}
              disabled={busy}
              class="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-sm leading-5 text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {share.label || share.room}
            </button>
            {#if onForgetShare}
              <IconButton
                label={l.forget_share({ label: share.label || share.room })}
                icon={X}
                testid="remembered-forget:{share.room}"
                onclick={() => {
                  onForgetShare(share.room)
                  if (shares.length <= 1) rememberedAnchor = null
                }}
              />
            {/if}
          </li>
        {/each}
      </ul>
    </div>
  </Popover>
{/if}

{#if joinOpen}
  <AddSharedFolderDialog
    vaultName={joinInto?.vaultName ?? null}
    dirs={joinInto?.dirs ?? []}
    initialLink={prefillLink}
    initialWhere="own"
    {isTauri}
    onJoinIntoVault={joinInto?.join ?? null}
    onJoinAsVault={joinAsVault}
    onClose={() => (joinOpen = false)}
    {probe}
  />
{/if}

{#if importOpen}
  <ImportDialog {isTauri} {busy} onOpenFolder={() => onOpenFolder(name)} onClose={() => (importOpen = false)} />
{/if}

{#if newVaultOpen}
  <Dialog title={isMobile ? l.new_phone_title() : l.new_browser_title()} width="sm" testid="new-vault-dialog" onClose={() => (newVaultOpen = false)}>
    <form
      onsubmit={(e) => {
        e.preventDefault()
        createInBrowser()
      }}
    >
      <p class="text-xs text-base-content/70">{isMobile ? w.phone_hint() : w.browser_hint()}</p>
      <Field name="vault-name" class="mt-3">
        <TextControl
          label={t.vault_name_placeholder()}
          bind:value={newVaultName}
          placeholder={t.vault_name_placeholder()}
          testid="new-vault-name"
        />
      </Field>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" onclick={() => (newVaultOpen = false)} class={outline}>{$LL.common.cancel()}</button>
        <button type="submit" data-testid="create-vault" disabled={busy || !newVaultName.trim()} class={primary}>
          {t.create_vault()}
        </button>
      </div>
    </form>
  </Dialog>
{/if}

{#if renaming}
  {@const target = renaming}
  <Dialog title={l.rename_title({ name: target.name })} width="sm" testid="rename-vault-dialog" onClose={() => (renaming = null)}>
    <form
      onsubmit={(e) => {
        e.preventDefault()
        if (!renameValue.trim()) return
        onRenameVault?.(target.room, renameValue)
        renaming = null
      }}
    >
      <Field name="vault-rename">
        <TextControl label={l.rename_label()} bind:value={renameValue} testid="rename-vault-input" />
        <Description>{l.rename_hint()}</Description>
      </Field>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" onclick={() => (renaming = null)} class={outline}>{$LL.common.cancel()}</button>
        <button type="submit" data-testid="rename-vault-save" disabled={!renameValue.trim()} class={primary}>
          {l.rename_save()}
        </button>
      </div>
    </form>
  </Dialog>
{/if}
