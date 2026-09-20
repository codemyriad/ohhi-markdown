<script lang="ts">
  import DevtoolsPanel from './lib/components/DevtoolsPanel.svelte'
  import SettingsPanel from './lib/components/SettingsPanel.svelte'
  import VaultManager from './lib/components/VaultManager.svelte'
  import { configForMemory, configForSession } from './lib/boot.js'
  import DeviceLinkDialog from './lib/components/DeviceLinkDialog.svelte'
  import JoinProgress from './lib/components/JoinProgress.svelte'
  import LinkDeviceDialog from './lib/components/LinkDeviceDialog.svelte'
  import {
    defaultRelay,
    devtoolsEnabled,
    getVault,
    hotkeys,
    lastVault,
    loadUser,
    operatorSecret,
    saveUser,
  } from './lib/config.js'
  import { listShares, revokeShare } from './lib/relay-admin.js'
  import { buildAdapter, forgetVaultState } from './lib/vault-adapter.js'
  import { parseAppConfig } from './lib/params.js'
  import { hasOpfs, isTauri } from './lib/platform.js'
  import {
    askToKeepStorage,
    initStorage,
    setStorageReminder,
    storageState,
    storageWarning,
  } from './lib/storage.svelte.js'
  import { setupWorkspace, textPaths, type Workspace } from './lib/workspace.svelte.js'
  import Palette from './lib/components/Palette.svelte'
  import { createNavigation } from './lib/navigation.svelte.js'
  import Toaster from './lib/ui/Toaster.svelte'
  import IconButton from './lib/ui/IconButton.svelte'
  import Breadcrumb from './lib/components/Breadcrumb.svelte'
  import DropZones from './lib/components/DropZones.svelte'
  import { createPanes, keyboardClaimed } from './lib/workspace-panes.svelte.js'
  import { createGroupUi } from './lib/group-ui.svelte.js'
  import { PanelLeft, PanelRight } from '@lucide/svelte'
  import { touchPath } from './lib/recent.js'
  import Navigator from './lib/components/Navigator.svelte'
  import EditorArea from './lib/components/EditorArea.svelte'
  import Rail from './lib/components/Rail.svelte'
  import WorkspaceDialogs from './lib/components/WorkspaceDialogs.svelte'
  import GroupOverlays from './lib/components/GroupOverlays.svelte'
  import { createDaily } from './lib/daily.svelte.js'
  import { createSession } from './lib/session.svelte.js'
  import { createManager } from './lib/manager.svelte.js'
  import { createShareActions } from './lib/share-actions.svelte.js'
  import { createFileActions } from './lib/file-actions.svelte.js'
  import { createShellLayout } from './lib/shell-layout.svelte.js'
  import { installShellCommands } from './lib/shell-commands.js'
  import { realClock } from './lib/real-clock.js'
  import { setDevtools } from './lib/config.js'
  import { LL } from '@ohhi/i18n/i18n-svelte'

  const url = new URLSearchParams(location.search)
  const memConfig = parseAppConfig(url)

  let settingsOpen = $state(false)
  const prefillLink = url.get('share') ?? ''
  /**
   * Device linking (N2). `deviceLinkOpen` is the OWNER's dialog (Settings ›
   * Sync and the command palette both open it — never nested inside the
   * settings dialog); `linkDeviceOpen` is the NEW DEVICE's paste dialog on the
   * manager. The two-phase panel's state (`joining`, `pull`) is the session's.
   */
  let deviceLinkOpen = $state(false)
  let linkDeviceOpen = $state(false)
  /** ?debug=1 forces the sync devtools on for this session (M6). */
  const debugForced = url.get('debug') === '1'
  let devtools = $state(debugForced || devtoolsEnabled())

  // ---- browser storage (lib/storage-persistence.ts) ----
  const storageReady = initStorage() // the launch check-then-ask; a no-op under Tauri
  /** The manager note's own ask was granted: the note stays up to say so. */
  let storageGranted = $state(false)
  // On the manager a browser vault is always at stake: creating, joining and
  // linking a device all make one.
  const storageNote = $derived.by(() => {
    if (storageGranted) return { canAsk: false, outcome: 'granted' as const }
    if (!storageWarning(hasOpfs())) return null
    return {
      canAsk: storageState.state === 'best-effort',
      outcome: storageState.refused ? ('refused' as const) : null,
    }
  })

  function keepStorage(): void {
    // Straight from the click, so persist() carries the gesture (Firefox).
    void askToKeepStorage().then(() => {
      if (storageState.state === 'persisted') storageGranted = true
    })
  }

  function dismissStorage(): void {
    if (storageGranted) storageGranted = false
    else setStorageReminder(false)
  }

  // One reminder per session, on whichever surface comes first: the manager's
  // note, or a single notice when the app reopens straight into a browser vault.
  let storageReminded = false
  $effect(() => {
    if (view === 'manager' && storageNote) storageReminded = true
  })

  async function remindAboutStorage(ws: Workspace): Promise<void> {
    await storageReady
    if (storageReminded || workspace !== ws || !storageWarning(true)) return
    storageReminded = true
    ws.notify({ level: 'warn', text: $LL.web.storage.notice() })
  }

  // ---- V2b/V2c: index, commands, palette, link panels ----
  const nav = createNavigation()
  /**
   * The pane tree (tab-groups W1). It owns where a note opens, which paths
   * have a live editor and what `ui.selectedPath` is — so every "open this"
   * in the shell goes through `openPath` below and nothing calls the
   * workspace's single-selection entry point any more.
   */
  const panes = createPanes(realClock, nav.registry)
  nav.setOpener((path, opts) => openPath(path, opts))
  /**
   * Tab groups (W2). Everything a group needs from outside the pane tree —
   * the index's ambiguity verdict and its outgoing links (R6), the notice log
   * and the clipboard — is handed over here rather than reached for inside,
   * so `group-ui` stays a module a test can drive.
   */
  const groups = createGroupUi(panes, {
    ambiguousName: (name) => nav.ambiguousName(name),
    outgoingPaths: async (path) => {
      const guid = workspace?.ui.files.find((f) => f.path === path)?.guid
      if (!guid) return []
      const links = await nav.index.outgoing(guid, { limit: 200 })
      const notes = new Set(textPaths(workspace?.ui.files ?? []))
      const out: string[] = []
      for (const ref of links.items) {
        // An unresolved link is a note not written yet, and an embed of an
        // image is not a note at all — neither is something to open.
        const target = nav.resolveLink(ref.target, path)
        if (target && notes.has(target) && target !== path && !out.includes(target)) {
          out.push(target)
        }
      }
      return out
    },
    notify: (input) => workspace?.notify(input),
    write: (text) => navigator.clipboard.writeText(text),
  })

  // ---- the session (which vault is open) and the manager over the registry ----
  const session = createSession({
    index: nav.sink,
    attachIndex: (ws) => nav.attach(ws),
    attachPanes: (ws, room) => panes.attach(ws, room),
    onRenamed: (moves) => panes.onRenamed(moves),
    userName: () => loadUser() ?? 'Anonymous',
    lastVault,
    onOpened: (ws, entry) => {
      manager.refresh()
      if (entry.vault.kind === 'opfs') void remindAboutStorage(ws)
    },
    setup: setupWorkspace,
    configForSession,
    configForMemory,
  })
  const manager = createManager(session, {
    isTauri,
    pickFolder: async () => (await import('./lib/adapters/tauri-vault-adapter.js')).pickVaultFolder(),
    folderIsEmpty,
    forgetVaultState,
    cleanUrl,
    onDeviceLinked: () => (linkDeviceOpen = false),
  })
  /** The two things the whole shell reads, aliased so the reads stay short. */
  const workspace = $derived(session.workspace)
  const view = $derived(session.view)

  // ---- layout (chrome U2) + notices (chrome U5) ----
  const layout = createShellLayout({
    inWorkspace: () => view === 'workspace',
    notices: () => workspace?.ui.notices ?? null,
    now: () => realClock.now(),
  })
  nav.setLinksVisible(() => layout.linksVisible)

  // ---- daily notes (W3): Obsidian's own daily-notes.json drives all three ----
  const daily = createDaily({
    workspace: () => workspace,
    open: (path) => openPath(path),
    now: () => realClock.now(),
  })

  /**
   * Every "open this note" in the shell (Fork 1-B): the tree, the links
   * panel, quick-open, search, Activity, daily notes. `background` is
   * Mod+click / Mod+Enter — a tab, but stay where you are.
   */
  function openPath(path: string, opts: { background?: boolean } = {}): void {
    if (!workspace) return
    panes.open(path, opts)
    touchPath(workspace.room, path)
  }

  /**
   * After onboarding, drop any bootstrap query params from the address bar so a
   * reload reopens via the persisted vault (not the deep link) — and so a
   * share secret never lingers in the URL / history (R5).
   */
  function cleanUrl(): void {
    if (location.search) history.replaceState({}, '', location.pathname)
  }

  /**
   * Empty AS THE VAULT ADAPTER SEES IT — every adapter ignores `.git` and
   * `.obsidian`, so a folder holding only those reads as empty here. That is
   * the same view enrollment has, which is the view that matters: nothing
   * Editor can see would be silently mixed with an arriving vault.
   */
  async function folderIsEmpty(path: string): Promise<boolean> {
    const adapter = await buildAdapter({ kind: 'tauri', path })
    const [files, dirs] = await Promise.all([adapter.list(), adapter.listDirs()])
    return files.length === 0 && dirs.length === 0
  }

  // ---- in-workspace sharing (M4/M5/N1/N2) and file operations (M3) ----
  const sharing = createShareActions({
    workspace: () => workspace,
    refresh: () => manager.refresh(),
    closeUnder: (path) => panes.closeUnder(path),
    revokeRoom: async (room) => {
      const secret = operatorSecret()
      if (!secret) return
      for (const share of await listShares(defaultRelay(), secret, room)) {
        await revokeShare(defaultRelay(), secret, share.token)
      }
    },
  })
  const fileOps = createFileActions({
    workspace: () => workspace,
    open: (path) => openPath(path),
    share: sharing,
    showHistory: () => layout.showSection('history'),
    reveal: (path) => (layout.revealDir = { path }),
  })

  // ---- the command table (B7/W2/X2/R1.3) and the global keyboard entry ----
  const commands = installShellCommands({
    registry: nav.registry,
    openPalette: (mode) => nav.open(mode),
    panes,
    groups,
    daily,
    fileOps,
    sharing,
    layout,
    selectedPath: () => workspace?.ui.selectedPath ?? null,
    hasWorkspace: () => workspace !== null,
    inWorkspace: () => view === 'workspace',
    claimed: keyboardClaimed,
    overrides: hotkeys,
    openSettings: () => (settingsOpen = true),
    openDeviceLink: () => (deviceLinkOpen = true),
  })

  // ---- workspace-derived view state ----
  const currentVaultName = $derived(
    (workspace ? getVault(workspace.room)?.name : undefined) ?? $LL.web.shell.unnamed_vault()
  )
  /** The focused pane's active path — what the breadcrumb follows. */
  const selectedPath = $derived(workspace?.ui.selectedPath ?? null)

  // ---- initial routing: everything above is wired, now pick a vault ----
  session.start(memConfig, prefillLink !== '')
</script>

<svelte:window onkeydowncapture={commands.onKeydown} />

{#if view === 'manager'}
  <VaultManager
    isTauri={isTauri()}
    hasOpfs={hasOpfs()}
    defaultUser={loadUser() ?? ''}
    vaults={manager.vaults}
    shares={manager.shares}
    {prefillLink}
    failure={session.failure}
    busy={session.busy}
    canGoBack={workspace !== null}
    currentRoom={workspace?.room ?? null}
    onOpenVault={(entry) => void session.boot(entry)}
    onRemoveVault={(room) => void manager.removeVault(room)}
    onOpenFolder={(name) => void manager.openFolder(name)}
    onCreateBrowserVault={(name, vaultName) => void manager.createBrowserVault(name, vaultName)}
    onJoin={(name, link) => void manager.joinShare(name, link)}
    onLinkDevice={(name) => {
      saveUser(name)
      session.failure = null
      linkDeviceOpen = true
    }}
    onBack={() => session.showWorkspace()}
    onSettings={() => (settingsOpen = true)}
    {storageNote}
    onKeepStorage={keepStorage}
    onDismissStorage={dismissStorage}
  />
{:else if view === 'connecting' || !workspace}
  {#if session.joining}
    <!-- A whole vault is arriving: two determinate phases, no editor surface
         until the boot resolves (the tree is empty and the folder is
         half-written until then). -->
    <JoinProgress
      vaultName={session.joining.entry.name}
      destination={session.joining.destination}
      progress={session.pull}
      error={session.failure?.message ?? null}
      onRetry={() => {
        if (session.joining) void session.boot(session.joining.entry)
      }}
      onCancel={() => session.cancel()}
    />
  {:else}
    <main
      class="flex h-screen flex-col items-center justify-center gap-4 text-sm text-base-content/70"
      data-testid="connecting"
    >
      <span>{$LL.web.shell.connecting()}</span>
      {#if memConfig.kind !== 'memory'}
        <button
          data-testid="boot-cancel"
          onclick={() => session.cancel()}
          class="rounded border border-base-300 px-3 py-1 text-xs text-base-content/70 hover:bg-base-200"
        >
          {$LL.common.cancel()}
        </button>
      {/if}
    </main>
  {/if}
{:else}
  <div class="flex h-screen flex-col bg-base-100 text-base-content">
    <header class="flex items-center gap-2 border-b border-base-300 bg-base-100 px-2 py-1">
      <!-- The page's one h1: the vault. -->
      <h1 class="sr-only">{currentVaultName}</h1>
      <IconButton
        label={layout.treeOpen ? $LL.web.shell.hide_navigator() : $LL.web.shell.show_navigator()}
        icon={PanelLeft}
        pressed={layout.treeOpen}
        testid="toggle-tree"
        onclick={() => (layout.treeOpen = !layout.treeOpen)}
      />
      <Breadcrumb path={selectedPath} onReveal={(dir) => layout.revealInTree(dir)} />
      <!-- The vault rollup moved to the navigator, beside the vault it is
           about (P3); the header keeps the breadcrumb and the two toggles. -->
      <div class="ml-auto flex min-w-0 items-center gap-3">
        <IconButton
          label={layout.railOpen ? $LL.web.shell.hide_sidebar() : $LL.web.shell.show_sidebar()}
          icon={PanelRight}
          pressed={layout.railOpen}
          testid="toggle-rail"
          onclick={() => (layout.railOpen = !layout.railOpen)}
        />
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      {#if layout.treeOpen}
        <Navigator
          {workspace}
          {nav}
          {layout}
          vaults={manager.vaults}
          vaultName={currentVaultName}
          onOpen={openPath}
          onOp={fileOps.handle}
          onSwitch={(entry) => void session.boot(entry)}
          onManage={() => {
            manager.refresh()
            session.showManager()
          }}
          onSettings={() => (settingsOpen = true)}
        />
      {/if}

      <EditorArea
        {workspace}
        {panes}
        {groups}
        {nav}
        now={() => realClock.now()}
        onCreateFromLink={(target) => void fileOps.createFromLink(target)}
      />

      <Rail
        {workspace}
        {nav}
        {layout}
        {sharing}
        vaultName={currentVaultName}
        relayUrl={manager.relayDefault}
        secret={manager.opSecret}
        {devtools}
        now={() => realClock.now()}
        onOpen={openPath}
        onCreateFromLink={(target) => void fileOps.createFromLink(target)}
        onDevtools={(on) => {
          setDevtools(on)
          devtools = debugForced || on
        }}
      />
    </div>
  </div>

  <WorkspaceDialogs
    {workspace}
    {sharing}
    {fileOps}
    relayUrl={manager.relayDefault}
    secret={manager.opSecret}
  />

  {#if nav.palette.mode}
    <Palette
      placeholder={nav.meta.placeholder}
      testid={nav.meta.testid}
      empty={nav.meta.empty}
      rows={nav.palette.rows}
      query={nav.palette.query}
      width={nav.palette.mode === 'search' ? 'lg' : 'md'}
      onQuery={(q) => nav.setQuery(q)}
      onPick={(row) => nav.pick(row)}
      onClose={() => nav.close()}
    />
  {/if}

  <DropZones {panes} />
  <GroupOverlays {panes} {groups} now={() => realClock.now()} />

  {#if devtools}
    <DevtoolsPanel {workspace} />
  {/if}
{/if}

<Toaster />

<!-- Outside the workspace branch (shell-polish P4): Settings can be opened
     from the vault manager, and its "Link a device" must not wait for a Back. -->
{#if deviceLinkOpen && workspace}
  <DeviceLinkDialog
    vaultName={currentVaultName}
    room={workspace.room}
    relayUrl={manager.relayDefault}
    secret={manager.opSecret}
    onCreate={(label) => sharing.createDeviceLink(label)}
    onClose={() => {
      deviceLinkOpen = false
      manager.refresh()
    }}
  />
{/if}

{#if linkDeviceOpen}
  <LinkDeviceDialog
    isTauri={isTauri()}
    initialLink={prefillLink}
    onLink={(link) => manager.linkThisDevice(link)}
    onClose={() => (linkDeviceOpen = false)}
  />
{/if}

{#if settingsOpen}
  <SettingsPanel
    registry={nav.registry}
    readAppFile={workspace ? (p) => workspace!.readAppFile(p) : undefined}
    onLinkDevice={workspace
      ? () => {
          // Settings saved its forms before calling this (see the panel), so
          // the dialog reads the operator secret the user just typed.
          manager.refresh()
          settingsOpen = false
          deviceLinkOpen = true
        }
      : undefined}
    onClose={() => {
      settingsOpen = false
      manager.refresh()
      devtools = debugForced || devtoolsEnabled()
    }}
  />
{/if}
