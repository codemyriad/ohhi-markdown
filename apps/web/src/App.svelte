<script lang="ts">
  import SettingsPage from './lib/components/SettingsPage.svelte'
  import VaultManager from './lib/components/VaultManager.svelte'
  import { configForMemory, configForSession } from './lib/boot.js'
  import DeviceLinkDialog from './lib/components/DeviceLinkDialog.svelte'
  import JoinProgress from './lib/components/JoinProgress.svelte'
  import JoinPage from './lib/components/JoinPage.svelte'
  import LinkDeviceDialog from './lib/components/LinkDeviceDialog.svelte'
  import {
    devtoolsEnabled,
    getVault,
    lastVault,
    loadUser,
    operatorSecret,
    saveUser,
  } from './lib/config.js'
  import { listShares, revokeShare } from './lib/relay-admin.js'
  import { buildAdapter, forgetVaultState } from './lib/vault-adapter.js'
  import { dropJoinLink, joinPageLink, parseAppConfig, parseAppParams, settleJoinAddress } from './lib/params.js'
  import { hasOpfs, isTauri, userResourceRoot } from './lib/platform.js'
  import { createCustomise } from './lib/customise.svelte.js'
  import { createStorageNote } from './lib/storage-note.svelte.js'
  import { startDesktopUpdates } from './lib/updater.js'
  import { collectReportFacts, help, loadVersion, runHelp, setHelpHost } from './lib/help.svelte.js'
  import ReportDialog from './lib/components/ReportDialog.svelte'
  import { setupWorkspace, textPaths, type Workspace } from './lib/workspace.svelte.js'
  import Palette from './lib/components/Palette.svelte'
  import { createNavigation } from './lib/navigation.svelte.js'
  import Toaster from './lib/ui/Toaster.svelte'
  import DropZones from './lib/components/DropZones.svelte'
  import { createPanes, keyboardClaimed } from './lib/workspace-panes.svelte.js'
  import { createGroupUi } from './lib/group-ui.svelte.js'
  import { touchPath } from './lib/recent.js'
  import { dirPaths } from './lib/tree-model.js'
  import Navigator from './lib/components/Navigator.svelte'
  import NavigatorDrawer from './lib/components/NavigatorDrawer.svelte'
  import type { ShellSpec } from './lib/layout-spec.js'
  import EditorArea from './lib/components/EditorArea.svelte'
  import ShellHeader from './lib/components/ShellHeader.svelte'
  import Rail from './lib/components/Rail.svelte'
  import { railForm } from './lib/layout.js'
  import WorkspaceDialogs from './lib/components/WorkspaceDialogs.svelte'
  import GroupOverlays from './lib/components/GroupOverlays.svelte'
  import { createDaily } from './lib/daily.svelte.js'
  import { createSession } from './lib/session.svelte.js'
  import { createManager } from './lib/manager.svelte.js'
  import { factsFromUi, readMountTable } from './lib/vault-facts.js'
  import { createShareActions } from './lib/share-actions.svelte.js'
  import { createFileActions } from './lib/file-actions.svelte.js'
  import { createShellLayout } from './lib/shell-layout.svelte.js'
  import { installShellCommands, layoutFileSource } from './lib/shell-commands.js'
  import { realClock } from './lib/real-clock.js'
  import { createSharedFeed, snapshotInput } from './lib/shared.svelte.js'
  import { sharedSnapshot } from '@ohhi/workspace'
  import { setViewShell } from './lib/views.js'
  import type { TabView } from './lib/panes.js'
  import { settingsSection, type SettingsSection } from './lib/settings.js'
  import { setSettingsHost, type SettingsHost } from './lib/settings-host.js'
  import { attachWritingHarness } from './lib/skills.svelte.js'
  import { setReadoutContext, type ReadoutContext } from './lib/readouts.js'
  import { LL } from '@ohhi/i18n/i18n-svelte'

  const url = new URLSearchParams(location.search)
  const memConfig = parseAppConfig(url)
  const appParams = parseAppParams(url)

  /**
   * Settings on the manager's page (settings-shaping ST1): the section shown,
   * or null for the vault list. In the workspace Settings is the `settings`
   * view tab instead; `openSettings` below picks the host.
   */
  let managerSettings = $state<SettingsSection | null>(null)
  /**
   * A link arriving at the manager: `?share=` today, or handed over by the
   * join page's *Add here* (the manager mounts after it, so its Add dialog
   * opens on the link).
   */
  let prefillLink = $state(url.get('share') ?? '')
  /**
   * The join page (first-run C2): `/join#editor1:…` in a BROWSER renders it
   * instead of the manager. Null on the desktop and on every other path.
   */
  let joinLink = $state(joinPageLink(location, isTauri()))
  // The token leaves the address bar and Back's history at once (R2), not
  // only when *Add here* is clicked: *Copy* and closing the tab is the
  // recommended desktop path. The tab keeps it for a reload of /join.
  // svelte-ignore state_referenced_locally -- the launch address, once
  if (joinLink !== null) settleJoinAddress(joinLink, history)
  /** A device link handed over by the join page, for *Link this device*. */
  let deviceLinkPrefill = $state('')
  /**
   * Leave the join page for the manager. The address becomes `/`, replacing
   * the entry, so the link's token is no longer in the address bar or in
   * Back's history (R2/R5).
   */
  function leaveJoinPage(): void {
    history.replaceState({}, '', '/')
    dropJoinLink()
    joinLink = null
  }
  /**
   * Device linking (N2). `deviceLinkOpen` is the OWNER's dialog (Settings ›
   * Sync & devices and the command palette both open it); `linkDeviceOpen` is the NEW DEVICE's paste dialog on the
   * manager. The two-phase panel's state (`joining`, `pull`) is the session's.
   */
  let deviceLinkOpen = $state(false)
  let linkDeviceOpen = $state(false)
  /** ?debug=1 forces the sync devtools on for this session (M6). */
  const debugForced = url.get('debug') === '1'
  let devtools = $state(debugForced || devtoolsEnabled())

  // ---- browser storage (lib/storage-persistence.ts): the manager's note, or one reminder ----
  const storage = createStorageNote({ onManager: () => view === 'manager', hasOpfs })

  // ---- desktop self-update (lib/updater.ts): check on launch and every 6 h ----
  // The last check's outcome feeds the Help menu's version line (first-run E1).
  help.clock = realClock
  if (isTauri())
    startDesktopUpdates(realClock, (status) => (help.update = status)).catch((err) =>
      console.info('[ohhi] updater unavailable', err)
    )
  void loadVersion()
  // ---- Help (first-run E1–E3): the menu's one shell-side action ----
  setHelpHost({
    openShortcuts: () => openSettings('keys'),
  })

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
    flash: (input) => workspace?.flash(input),
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
      if (entry.vault.kind === 'opfs') {
        void storage.remind(() => ws.notify({ level: 'warn', code: 'storage_evictable' }), () => workspace === ws)
      }
      // ?debug=1 used to force the drawer on; now it opens the inspector tab.
      if (debugForced) panes.openView('inspector')
    },
    setup: setupWorkspace,
    configForSession,
    configForMemory,
  })
  const manager = createManager(session, {
    isTauri,
    pickFolder: async (defaultPath) =>
      (await import('./lib/adapters/tauri-vault-adapter.js')).pickVaultFolder(defaultPath),
    folderIsEmpty,
    forgetVaultState,
    cleanUrl,
    onDeviceLinked: () => (linkDeviceOpen = false),
    readMounts: readMountTable,
  })
  /** The two things the whole shell reads, aliased so the reads stay short. */
  const workspace = $derived(session.workspace)
  const view = $derived(session.view)

  // ---- customising from files (quiet-shell F8–F11): resources, keymap, templates ----
  const userRoot = userResourceRoot()
  const customise = createCustomise({
    workspace: () => workspace,
    userRoot: () => userRoot,
    registry: nav.registry,
    setFormatBindings: (bindings) => panes.setFormatBindings(bindings),
    now: () => realClock.now(),
    notePath: () => workspace?.ui.selectedPath ?? null,
    dateFormat: () => daily.config.format,
    insertText: (text) => panes.insertText(text),
    // The keymap's reload notice (settings-shaping ST6): *Show* opens Settings › Keys.
    openSettings: (section) => openSettings(section),
  })
  const { resources, keymap, templates } = customise
  // Each row names its root (settings-shaping ST6), as the layout picker's do.
  nav.setTemplates({
    rows: () => templates.rows.map((r) => ({ ...r, root: r.entry.root })),
    insert: (name, args) => void templates.insert(name, args),
  })

  // ---- layout (chrome U2, quiet-shell F2) + notices (chrome U5) ----
  const layout = createShellLayout({
    inWorkspace: () => view === 'workspace',
    events: () => workspace?.ui.events ?? null,
    flashes: () => workspace?.ui.flashes ?? null,
    eventSource: () => workspace,
    sessionStart: () => workspace?.startedAt ?? null,
    now: () => realClock.now(),
    resolveLayout: (active, pins, overrides) => resources.resolveLayout(active, pins, overrides),
    refreshResources: () => resources.refresh(),
    layoutOverride: appParams.layout,
    onLayoutsChange: (cb) => resources.onChange('layouts', cb),
    room: () => workspace?.room ?? null,
    // The layout's reload notice and *Show problems* on a file that can't be used (settings-shaping ST6).
    notify: (input) => workspace?.notify(input),
    openSettings: (section) => openSettings(section),
  })
  nav.setLinksVisible(() => layout.linksVisible)
  nav.setLayoutFiles(layoutFileSource(resources, layout))

  // ---- daily notes (W3): Obsidian's own daily-notes.json drives all three ----
  const daily = createDaily({
    workspace: () => workspace,
    open: (path) => openPath(path),
    now: () => realClock.now(),
  })

  /**
   * Every "open this note" in the shell (Fork 1-B): the tree, the links
   * panel, quick-open, search, the Log view, daily notes. `background` is
   * Mod+click / Mod+Enter — a tab, but stay where you are.
   */
  function openPath(path: string, opts: { background?: boolean } = {}): void {
    if (!workspace) return
    // `panes.open: 'replace'` (quiet-shell F3): a foreground open navigates
    // the focused tab in place, Typora's way; Mod+click stays a new tab.
    const replace = layout.spec.panes.open === 'replace' && !opts.background
    panes.open(path, { ...opts, replace })
    touchPath(workspace.room, path)
    // The drawer has done its job once the note it opened is on the page.
    if (replace && layout.spec.regions.navigator === 'drawer') layout.treeOpen = false
  }

  /** *Pin as a column* (Round 2, P7): a device pin per side (`layout.pin`), never a file. */
  const pin = (regions: Partial<ShellSpec['regions']>): void => {
    if (regions.navigator === 'column') layout.pin('navigator')
    if (regions.rail === 'column') layout.pin('rail')
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
    // On the ROOM's relay (`MountInfo.relay`), never the current default.
    revokeRoom: async (room, relay) => {
      const secret = operatorSecret()
      if (!secret) return
      for (const share of await listShares(relay, secret, room)) {
        await revokeShare(relay, secret, share.token)
      }
    },
  })
  // ---- the Shared view (sharing E2): its ack tracker and the verbs every view tab may use ----
  const sharedFeed = createSharedFeed({ workspace: () => workspace, clock: realClock })
  /** The open vault's relays, as the Shared view rolls them up — Settings › Sync's relay card (first-run D1). */
  const settingsRelays = $derived(
    workspace ? sharedSnapshot(snapshotInput(workspace, { inSyncByRoom: sharedFeed.inSyncByRoom })).relays : []
  )
  // ---- the writing harness: sessions, runs and skills belong to the shell, not a view ----
  attachWritingHarness({
    workspace: () => workspace,
    index: nav.index,
    clock: realClock,
    openView: (id, arg) => openView(id, arg),
    flash: (input) => workspace?.flash(input),
    // The `.claude/skills/` farm: only where another app reads the disk.
    desktop: isTauri(),
  })
  setViewShell({
    clock: realClock,
    openPath: (path, opts) => openPath(path, opts),
    openView: (id, arg) => openView(id, arg),
    createFromLink: (target) => void fileOps.createFromLink(target),
    renameNote: (path, name) => fileOps.renameNote(path, name),
    pin,
    openSettings: (section) => openSettings(section),
    shareFolder: (path) => (sharing.folderSharePath = path),
    addSharedFolder: (dir = '') => (sharing.addShareOpen = { dir }),
    linkDevice: () => (deviceLinkOpen = true),
    revealFolder: (path) => layout.revealInTree(path),
    relayUrl: () => manager.relayDefault,
    secret: () => manager.opSecret,
    relayKnown: () => manager.relayKnown,
    revision: () => sharing.revision,
    inSyncByRoom: () => sharedFeed.inSyncByRoom,
  })
  // ---- the readouts' context (readouts.ts): the toolbar's, and every per-pane status bar's ----
  const readoutCtx: ReadoutContext = {
    // Read only inside the workspace branch, where it is set.
    get workspace() {
      return workspace as Workspace
    },
    panes,
    layout,
    nav,
    daily,
    groups,
    get merged() {
      return layout.spec.regions.statusbar === 'merged'
    },
    devtools: () => devtools,
  }
  setReadoutContext(readoutCtx)
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
    mounts: () => workspace?.ui.mounts ?? [],
    hasWorkspace: () => workspace !== null,
    inWorkspace: () => view === 'workspace',
    claimed: keyboardClaimed,
    openDeviceLink: () => (deviceLinkOpen = true),
    openView: (id, arg) => openView(id, arg),
    devtools: () => devtools,
    reloadResources: () => customise.reloadAll(),
    flash: (input) => workspace?.flash(input),
    templates,
    help: { run: runHelp, menuMounted: () => help.menus > 0 },
    focusMode: {
      active: () => layout.focus,
      toggle: () => layout.toggleFocus(),
      leave: () => layout.setFocus(false),
    },
  })

  // ---- workspace-derived view state ----
  const currentVaultName = $derived(
    // Through the manager's mirror, so a Rename in the manager reaches the header.
    (workspace ? (manager.vaults.find((v) => v.room === workspace!.room) ?? getVault(workspace.room))?.name : undefined) ??
      $LL.web.shell.unnamed_vault()
  )
  /**
   * *Add a shared folder* from the manager, into the vault open behind it
   * (sharing E4): the same join the tree runs, then back to that vault.
   */
  async function joinIntoOpenVault(link: string, dest: string): Promise<void> {
    if (!workspace) return
    await workspace.addShareMount(link, dest)
    session.showWorkspace()
  }
  /** What both navigators — the column and the drawer — are handed. */
  const navigatorProps = $derived({
    nav,
    layout,
    vaults: manager.vaults,
    vaultName: currentVaultName,
    onOpen: openPath,
    onOp: fileOps.handle,
    onSwitch: (entry: Parameters<typeof session.boot>[0]) => void session.boot(entry),
    onManage: () => {
      manager.refresh()
      session.showManager()
    },
    onSettings: () => openSettings(),
  })

  // ---- Settings (settings-shaping ST1): a view tab in the workspace, a page on the manager ----
  /**
   * Every door to Settings comes here: the palette's `app.settings` and any
   * `openView('settings', …)`, the navigator's gear, the Shared view's
   * *Change relay…*, Help's *Keyboard shortcuts*, the manager. With the
   * workspace on screen it is the one `settings` view tab, focused and
   * switched to `section`; otherwise the manager's page.
   */
  function openSettings(section?: string): void {
    if (view === 'workspace' && workspace) {
      panes.openView('settings', section === undefined ? undefined : settingsSection(section))
      return
    }
    managerSettings = settingsSection(section)
    if (view !== 'manager') session.showManager()
  }
  function openView(id: TabView, arg?: string): void {
    if (id === 'settings') openSettings(arg)
    else panes.openView(id, arg)
  }
  /** What Settings is handed, in both hosts — every field read live. */
  const settingsHost: SettingsHost = {
    registry: nav.registry,
    layout,
    resources,
    keymap,
    get readAppFile() {
      const ws = workspace
      return ws ? (p: string) => ws.readAppFile(p) : undefined
    },
    get vault() {
      if (!workspace) return null
      const vault = getVault(workspace.room)?.vault
      return {
        name: currentVaultName,
        kind: vault?.kind ?? 'memory',
        ...(vault?.kind === 'tauri' ? { path: vault.path } : {}),
      }
    },
    get relays() {
      return settingsRelays
    },
    get onLinkDevice() {
      return workspace
        ? () => {
            manager.refresh()
            deviceLinkOpen = true
          }
        : undefined
    },
    onManageVaults: () => {
      manager.refresh()
      managerSettings = null
      session.showManager()
    },
    onConfigChange: () => {
      manager.refresh()
      devtools = debugForced || devtoolsEnabled()
    },
  }
  setSettingsHost(settingsHost)
  // The page belongs to one visit to the manager: leaving it (a vault opens,
  // Back) means the next visit starts at the vault list.
  $effect(() => {
    if (view !== 'manager') managerSettings = null
  })

  // ---- initial routing: everything above is wired, now pick a vault ----
  // The join page counts as a deep link: the manager waits behind it rather
  // than the last vault reopening under a page about another folder.
  // svelte-ignore state_referenced_locally -- the initial values are the point: this routes the launch once
  session.start(memConfig, prefillLink !== '' || joinLink !== null)
</script>

<svelte:window onkeydowncapture={commands.onKeydown} />

{#if joinLink !== null}
  <JoinPage
    link={joinLink}
    onAddHere={(link) => {
      prefillLink = link
      leaveJoinPage()
    }}
    onLinkHere={(link) => {
      deviceLinkPrefill = link
      leaveJoinPage()
      linkDeviceOpen = true
    }}
  />
{:else if view === 'manager' && managerSettings !== null}
  <SettingsPage
    host={settingsHost}
    section={managerSettings}
    onSection={(next) => (managerSettings = next)}
    onBack={() => {
      managerSettings = null
      manager.refresh()
    }}
  />
{:else if view === 'manager'}
  <VaultManager
    isTauri={isTauri()}
    hasOpfs={hasOpfs()}
    defaultUser={manager.user}
    vaults={manager.vaults}
    shares={manager.shares}
    {prefillLink}
    failure={session.failure}
    busy={session.busy}
    canGoBack={workspace !== null}
    currentRoom={workspace?.room ?? null}
    facts={manager.facts}
    openFacts={workspace ? factsFromUi(workspace.ui.mounts) : null}
    onLoadFacts={() => void manager.loadFacts(workspace?.room ?? null)}
    onOpenVault={(entry) => void session.boot(entry)}
    onRemoveVault={(room) => void manager.removeVault(room)}
    onForgetShare={(room) => manager.forgetShare(room)}
    onRenameVault={(room, name) => manager.renameVault(room, name)}
    onAllowAccess={(room) => void manager.allowAccessAgain(room)}
    onOpenFolder={(name) => void manager.openFolder(name)}
    onCreateBrowserVault={(name, vaultName) => void manager.createBrowserVault(name, vaultName)}
    onJoin={(name, link) => manager.join(name, link)}
    joinInto={workspace
      ? { vaultName: currentVaultName, dirs: dirPaths(workspace.ui.files), join: joinIntoOpenVault }
      : null}
    onLinkDevice={(name) => {
      saveUser(name)
      session.failure = null
      linkDeviceOpen = true
    }}
    onBack={() => session.showWorkspace()}
    onSettings={(section) => openSettings(section)}
    storageNote={storage.note}
    onKeepStorage={() => storage.keep()}
    onDismissStorage={() => storage.dismiss()}
  />
{:else if view === 'connecting' || !workspace}
  {#if session.joining}
    <!-- A whole vault is arriving: two determinate phases, no editor surface
         until the boot resolves (the tree is empty and the folder is
         half-written until then). -->
    <JoinProgress
      kind={session.joining.kind}
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
    <ShellHeader placement="top" {workspace} {layout} registry={nav.registry} ctx={readoutCtx} vaultName={currentVaultName} />

    <!-- `relative`: the unpinned navigator floats against this row, between the bars. -->
    <div class="relative flex min-h-0 flex-1">
      {#if layout.treeOpen && layout.spec.regions.navigator === 'column'}
        <Navigator {workspace} {...navigatorProps} />
      {:else if layout.treeOpen && layout.spec.regions.navigator === 'drawer'}
        <!-- quiet-shell F3: the same navigator, floating over the editor's left edge (not modal). `off` renders nothing. -->
        <NavigatorDrawer
          {workspace}
          {...navigatorProps}
          onClose={() => (layout.treeOpen = false)}
          onPin={() => layout.pin('navigator')}
        />
      {/if}

      <EditorArea
        {workspace}
        {panes}
        {groups}
        {nav}
        now={() => realClock.now()}
        onCreateFromLink={(target) => void fileOps.createFromLink(target)}
        chrome={layout.paneChrome}
        editor={layout.spec.editor}
        {layout}
      />

      <!-- Round 2 P4: pinned, the dock is this column; otherwise it floats
           over the editor area (`EditorArea` hosts that form). -->
      {#if railForm(layout.spec.regions) === 'column' && layout.focusKeeps('rail')}
        <Rail {workspace} {nav} {layout} />
      {/if}
    </div>
    <ShellHeader placement="bottom" {workspace} {layout} registry={nav.registry} ctx={readoutCtx} vaultName={currentVaultName} />
  </div>

  <WorkspaceDialogs
    {workspace}
    {sharing}
    {fileOps}
    relayUrl={manager.relayDefault}
    secret={manager.opSecret}
    vaultName={currentVaultName}
    onRemember={(relay, secret) => manager.rememberRelay(relay, secret)}
    relayKnown={manager.relayKnown}
    userName={manager.user}
    onSaveName={(name) => {
      // Fork 5-A: the name typed at the first share is the saved name.
      saveUser(name)
      manager.refresh()
    }}
    onJoinAsVault={async (link) => {
      // From inside a workspace the manager is not on screen: the dialog says why.
      const failed = await manager.joinShare(loadUser() ?? 'Anonymous', link)
      if (failed) throw new Error(failed)
    }}
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

{/if}

<Toaster />

<!-- Report a problem (first-run E3): from Help, in the workspace or the manager. -->
{#if help.reportOpen}
  <ReportDialog
    facts={collectReportFacts(workspace, {
      vault: workspace
        ? { name: currentVaultName, kind: getVault(workspace.room)?.vault.kind ?? 'memory' }
        : null,
      inSyncByRoom: sharedFeed.inSyncByRoom,
    })}
    now={() => realClock.now()}
    onClose={() => (help.reportOpen = false)}
  />
{/if}

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
      sharing.touch()
    }}
  />
{/if}

{#if linkDeviceOpen}
  <LinkDeviceDialog
    isTauri={isTauri()}
    initialLink={deviceLinkPrefill || prefillLink}
    onLink={(link) => manager.linkThisDevice(link)}
    onClose={() => (linkDeviceOpen = false)}
  />
{/if}
