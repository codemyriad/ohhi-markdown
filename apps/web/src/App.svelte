<script lang="ts">
  import BreakerDialog from './lib/components/BreakerDialog.svelte'
  import DevtoolsPanel from './lib/components/DevtoolsPanel.svelte'
  import FileTree from './lib/components/FileTree.svelte'
  import ReviewModal from './lib/components/ReviewModal.svelte'
  import TreeOpDialog from './lib/components/TreeOpDialog.svelte'
  import SettingsPanel from './lib/components/SettingsPanel.svelte'
  import SyncPill from './lib/components/SyncPill.svelte'
  import VaultManager from './lib/components/VaultManager.svelte'
  import VaultSwitcher from './lib/components/VaultSwitcher.svelte'
  import { configForMemory, configForSession } from './lib/boot.js'
  import AddLinkDialog from './lib/components/AddLinkDialog.svelte'
  import AddShareDialog from './lib/components/AddShareDialog.svelte'
  import DeviceLinkDialog from './lib/components/DeviceLinkDialog.svelte'
  import JoinProgress from './lib/components/JoinProgress.svelte'
  import LinkDeviceDialog from './lib/components/LinkDeviceDialog.svelte'
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte'
  import FolderShareDialog from './lib/components/FolderShareDialog.svelte'
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
  import { tagQuery } from './lib/read.svelte.js'
  import {
    askToKeepStorage,
    initStorage,
    setStorageReminder,
    storageState,
    storageWarning,
  } from './lib/storage.svelte.js'
  import { containingDir, dirPaths } from './lib/tree-model.js'
  import { setupWorkspace, textPaths, type Workspace } from './lib/workspace.svelte.js'
  import LinksPanel from './lib/components/LinksPanel.svelte'
  import Palette from './lib/components/Palette.svelte'
  import { createNavigation, defaultCommands } from './lib/navigation.svelte.js'
  import { recentPaths, touchPath } from './lib/recent.js'
  import { themeState } from './lib/theme.svelte.js'
  import Toaster from './lib/ui/Toaster.svelte'
  import IconButton from './lib/ui/IconButton.svelte'
  import ResizeHandle from './lib/ui/ResizeHandle.svelte'
  import ActionsCluster from './lib/components/ActionsCluster.svelte'
  import Breadcrumb from './lib/components/Breadcrumb.svelte'
  import RightRail, { type RailSection } from './lib/components/RightRail.svelte'
  import DropZones from './lib/components/DropZones.svelte'
  import ModeBar from './lib/components/ModeBar.svelte'
  import PaneTree, { type PaneRender } from './lib/components/PaneTree.svelte'
  import GroupChip from './lib/components/GroupChip.svelte'
  import ManageGroupPopover from './lib/components/ManageGroupPopover.svelte'
  import ShowAllGroupsDialog from './lib/components/ShowAllGroupsDialog.svelte'
  import StripGroupsMenu from './lib/components/StripGroupsMenu.svelte'
  import TabGroupMenuItems from './lib/components/TabGroupMenuItems.svelte'
  import { createPanes, keyboardClaimed } from './lib/workspace-panes.svelte.js'
  import { createGroupUi, groupLabel } from './lib/group-ui.svelte.js'
  import {
    findPane,
    type Group,
    type Pane as PaneNode,
    type Tab as PaneTab,
  } from './lib/panes.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from './lib/ui/DropdownMenu.svelte'
  import { Bell, History, Link2, PanelLeft, PanelRight, Settings, Users } from '@lucide/svelte'
  import ActivitySection from './lib/components/ActivitySection.svelte'
  import HistorySection from './lib/components/HistorySection.svelte'
  import NoteSection from './lib/components/NoteSection.svelte'
  import { createDaily } from './lib/daily.svelte.js'
  import { createSession } from './lib/session.svelte.js'
  import { createManager } from './lib/manager.svelte.js'
  import { createShareActions } from './lib/share-actions.svelte.js'
  import { createFileActions } from './lib/file-actions.svelte.js'
  import { realClock } from './lib/real-clock.js'
  import { vaultLabel, vaultTitle } from './lib/pill-status.js'
  import { scopedRollup } from './lib/share-status.js'
  import { unreadCount } from './lib/notices.js'
  import { toast } from './lib/ui/toaster.js'
  import { setDevtools } from './lib/config.js'
  import { layoutPrefs, setLayoutPrefs } from './lib/config.js'
  import { RAIL_SECTIONS, TREE_WIDTH, showOnly, toggleFolded } from './lib/layout.js'
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

  // ---- layout (chrome U2): device-level, persisted like the theme ----
  const savedLayout = layoutPrefs()
  let treeOpen = $state(savedLayout.treeOpen)
  let treeWidth = $state(savedLayout.treeWidth)
  let railOpen = $state(savedLayout.railOpen)
  let railFolded = $state<string[]>(savedLayout.railFolded)
  // ---- notices (chrome U5): every new one toasts; all of them stay in Activity ----
  /** When the Activity section was last in view; what arrived since is "unread". */
  let noticesSeenAt = $state(0)
  let toastedId: string | null = null
  const activityVisible = $derived(view === 'workspace' && railOpen && !railFolded.includes('activity'))
  const unread = $derived(workspace ? unreadCount(workspace.ui.notices, noticesSeenAt) : 0)
  $effect(() => {
    const newest = workspace?.ui.notices[0]
    if (!newest || newest.id === toastedId) return
    toastedId = newest.id
    toast({
      level: newest.level,
      title: $LL.web.notices.toast_title[newest.level](),
      description: newest.text,
    })
  })
  $effect(() => {
    // Looking at the log reads it — including anything that arrives while it is open.
    workspace?.ui.notices.length
    if (activityVisible) noticesSeenAt = Date.now()
  })

  const railSections = $derived<RailSection[]>([
    { id: 'links', label: $LL.web.rail.sections.links(), icon: Link2 },
    // The one place the presence union survives: as a count on the icon.
    { id: 'note', label: $LL.web.rail.sections.note(), icon: Users, badge: workspace?.ui.presence.length || undefined },
    { id: 'activity', label: $LL.web.rail.sections.activity(), icon: Bell, badge: unread || undefined },
    { id: 'history', label: $LL.web.rail.sections.history(), icon: History },
  ])
  const linksVisible = $derived(railOpen && !railFolded.includes('links'))
  /** A folder the breadcrumb asked the navigator to show (new object per click). */
  let revealDir = $state<{ path: string } | null>(null)

  // The booleans persist as they change; the width persists when a resize
  // gesture ENDS (ResizeHandle's onCommit), not on every pointer move.
  $effect(() => {
    setLayoutPrefs({ treeOpen, railOpen, railFolded: $state.snapshot(railFolded) })
  })

  function revealInTree(dir: string): void {
    treeOpen = true
    revealDir = { path: dir }
  }

  nav.setLinksVisible(() => linksVisible)

  // ---- daily notes (W3): Obsidian's own daily-notes.json drives all three ----
  const daily = createDaily({
    workspace: () => workspace,
    open: (path) => openPath(path),
    now: () => realClock.now(),
  })

  nav.registry.register(
    ...defaultCommands({
      quickOpen: () => nav.open('quick-open'),
      commandPalette: () => nav.open('command'),
      search: () => nav.open('search'),
      newNote: () => void fileOps.createNote(''),
      toggleSidebar: () => (treeOpen = !treeOpen),
      toggleRail: () => (railOpen = !railOpen),
      settings: () => (settingsOpen = true),
      // Fork 4: back/forward walk the FOCUSED TAB's own trail, not one
      // workspace-wide list — with four panes, "back" jumping panes is a
      // surprise, and a tab replaced in place is exactly what has a trail.
      back: () => panes.travel(-1),
      forward: () => panes.travel(1),
      hasNote: () => workspace?.ui.selectedPath != null,
      deleteNote: () => {
        const path = workspace?.ui.selectedPath
        if (path) fileOps.op = { type: 'delete', path, kind: 'text' }
      },
      moveNote: () => {
        const path = workspace?.ui.selectedPath
        if (path) fileOps.op = { type: 'move', path, kind: 'text' }
      },
      newFolder: () => {
        if (workspace) fileOps.op = { type: 'new-folder', dir: containingDir(workspace.ui.selectedPath, 'text') }
      },
      addShare: () => {
        if (workspace) sharing.addShareOpen = { dir: '' }
      },
      linkDevice: () => {
        if (workspace) deviceLinkOpen = true
      },
      dailyToday: () => void daily.openToday(),
      dailyPrev: () => daily.step('prev'),
      dailyNext: () => daily.step('next'),
      hasPrevDaily: () => daily.steps.prev !== null,
      hasNextDaily: () => daily.steps.next !== null,
    })
  )
  // Every `workspace.*` and `tab.*` row of the command table (B7). Registered
  // after the defaults so a later rebind of a shared key wins, as the registry
  // documents.
  nav.registry.register(...panes.commands())
  // The `group.*` table (W2). Registered after the pane rows for the same
  // reason they come after the defaults: a later registration wins a shared key.
  nav.registry.register(...groups.commands())
  // The `view.*` + `edit.toggle-checkbox` table (read X2). Same order rule:
  // registered after the defaults so a rebind of a shared key wins.
  nav.registry.register(...panes.readCommands())
  // One palette row per SAVED group (Fork 2-A). A provider rather than
  // registrations, because the ids come and go every time a group is closed
  // or reopened — and a row nobody can predict is a row nobody can bind.
  nav.registry.addProvider(() => groups.savedCommands())
  // The user's own bindings sit over those defaults (R1.3). Settings writes
  // config and re-applies them itself, so this is the boot read.
  nav.registry.setOverrides(hotkeys())

  /** Commands that act on the pane tree behind whatever is on top (M4). */
  const WORKSPACE_COMMANDS = /^(?:workspace|tab|group)\./

  /**
   * Global hotkeys, in the CAPTURE phase.
   *
   * Capture matters: several of Chris's own bindings collide with CodeMirror's
   * defaults — `Mod+ArrowLeft`/`Mod+ArrowRight` are his Obsidian sidebar
   * toggles AND `standardKeymap`'s word/line motion. CM6 calls preventDefault
   * but not stopPropagation, so a bubble-phase handler would run the command
   * *and* move the caret. Capturing lets an app command claim the key first
   * and stop it, which is the precedence Obsidian itself has.
   */
  function onGlobalKeydown(e: KeyboardEvent): void {
    if (view !== 'workspace') return
    // A live pane mode owns the keyboard: its letters are commands, not text,
    // and this handler is in the capture phase so CodeMirror never sees them.
    if (panes.handleKey(e)) return
    const command = nav.registry.match(e)
    if (!command) return
    // …but a command that acts on the workspace must not fire from inside a
    // dialog or a text field: capture phase means `Mod+W` typed into Settings'
    // relay-URL box used to close a tab behind it (M4). Navigation and the
    // overlays themselves still answer — they are how you get out.
    //
    // Swallowed rather than let through: these are the browser's own chords
    // (`Mod+W` closes the window, `Mod+P` prints), and handing them back would
    // be a worse surprise than the command they stand in for.
    if (WORKSPACE_COMMANDS.test(command.id) && keyboardClaimed()) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    void command.run()
  }

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

  // ---- initial routing ----
  session.start(memConfig, prefillLink !== '')

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
    showHistory: () => {
      railOpen = true
      railFolded = toggleFolded(railFolded, 'history', false)
    },
    reveal: (path) => (revealDir = { path }),
  })

  // ---- workspace-derived view state ----
  const currentVaultName = $derived(
    (workspace ? getVault(workspace.room)?.name : undefined) ?? $LL.web.shell.unnamed_vault()
  )
  /**
   * The header rollup, fed only by docs that have a relay to be in sync WITH
   * (chrome U4). Null = nothing is shared, and the header says so in words:
   * a pill for an absence would read as a problem.
   */
  const globalStatus = $derived(
    workspace
      ? scopedRollup(workspace.ui.files, workspace.ui.records, workspace.ui.mounts, workspace.ui.linked)
      : null
  )
  /** The focused pane's active path — what the rail, breadcrumb and index follow. */
  const selectedPath = $derived(workspace?.ui.selectedPath ?? null)
  /**
   * Everything a pane needs that is the same for all of them. The reveal goes
   * to the focused pane only: a search result lands where you were looking.
   */
  const paneCtx = $derived<PaneRender | null>(
    workspace
      ? {
          panes,
          workspace,
          dark: themeState.dark,
          /**
           * Selection-aware word count — `word-count` is the one Obsidian
           * status item Chris keeps. Read through a function so only the
           * status bar that shows it re-derives when the text changes.
           */
          wordsOf: (path) => {
            nav.revision // any content change, from any writer
            const doc = workspace?.docForPath(path)
            return doc ? (doc.getText().match(/[\p{L}\p{N}'’-]+/gu) ?? []).length : 0
          },
          search: async (query) => {
            const page = await nav.index.quickOpen(query, { limit: 50 })
            return page.items.map((hit) => ({ path: hit.path, spans: hit.spans }))
          },
          /**
           * Recency is filtered against the file list rather than trusted: the
           * store survives renames and deletes made in another app, and a row
           * for a note that is gone opens nothing (P5).
           */
          recent: () => {
            if (!workspace) return []
            const existing = new Set(textPaths(workspace.ui.files))
            return recentPaths(workspace.room).filter((p) => existing.has(p))
          },
          /**
           * *New note* fills THIS tab (`navigate`), never a new one beside it:
           * an empty tab is a slot waiting for a note.
           */
          newNote: (tabId) => {
            void (async () => {
              const created = await workspace?.createFile('')
              if (!created || !workspace) return
              panes.navigate(created, tabId)
              touchPath(workspace.room, created)
            })()
          },
          openQuick: () => nav.open('quick-open'),
          bindings: {
            newNote: nav.registry.binding('file.new'),
            openQuick: nav.registry.binding('nav.quick-open'),
          },
          resolveLink: (target, from) => nav.resolveLink(target, from),
          createFromLink: (target) => void fileOps.createFromLink(target),
          linkCandidates: () => textPaths(workspace?.ui.files ?? []),
          searchTag: (tag) => nav.openSearch(tagQuery(tag)),
          tags: () => nav.tags(),
          reveal: nav.pending.reveal,
          groupChip,
          tabMenuGroupItems,
          moreMenuItems,
        }
      : null
  )
  /** The group the manage popover is on, or null — it may have been closed. */
  const managed = $derived(groups.manage ? panes.findGroup(groups.manage.groupId) : null)
  /**
   * What that popover hangs off (P1.3): its own chip, or — for a group whose
   * pane is zoomed away — the focused pane's `▾` button, where its list lives.
   * Null parks the popover near the top rather than dropping the surface.
   */
  const manageAnchor = $derived.by(() => {
    // The REQUEST, not the group: `openManage` mints a new object every time,
    // so this re-reads the DOM on every open. Keyed on the group it would not,
    // and re-opening over a chip since rebuilt (a move to another pane) would
    // hang off a detached node, which measures 0×0 at the viewport corner.
    const request = groups.manage
    if (!request) return null
    // Ids are minted by `nextId`, so they are safe inside the selector string.
    const at = (testid: string): HTMLElement | null =>
      document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
    return at(`group-chip:${request.groupId}`) ?? at(`tab-more:${panes.layout.focus}`)
  })
  const confirmingGroup = $derived(groups.confirming ? panes.findGroup(groups.confirming) : null)
  /** Zoom mounts one pane and nothing else — that is the whole memory story. */
  const treeRoot = $derived(
    (panes.layout.zoom ? findPane(panes.layout, panes.layout.zoom) : null) ?? panes.layout.tree
  )
  const activeReview = $derived(workspace?.ui.reviews[0] ?? null)
  /** The open note's own sync record — the pill reads it, so does History. */
  const noteRecord = $derived.by(() => {
    if (!workspace || !selectedPath) return null
    const guid = workspace.ui.files.find((f) => f.path === selectedPath)?.guid
    return (guid ? workspace.ui.records[guid] : undefined) ?? null
  })
</script>

<svelte:window onkeydowncapture={onGlobalKeydown} />

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
        label={treeOpen ? $LL.web.shell.hide_navigator() : $LL.web.shell.show_navigator()}
        icon={PanelLeft}
        pressed={treeOpen}
        testid="toggle-tree"
        onclick={() => (treeOpen = !treeOpen)}
      />
      <Breadcrumb path={selectedPath} onReveal={revealInTree} />
      <!-- The vault rollup moved to the navigator, beside the vault it is
           about (P3); the header keeps the breadcrumb and the two toggles. -->
      <div class="ml-auto flex min-w-0 items-center gap-3">
        <IconButton
          label={railOpen ? $LL.web.shell.hide_sidebar() : $LL.web.shell.show_sidebar()}
          icon={PanelRight}
          pressed={railOpen}
          testid="toggle-rail"
          onclick={() => (railOpen = !railOpen)}
        />
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      {#if treeOpen}
        <aside
          data-testid="navigator"
          aria-label={$LL.web.shell.navigator_label()}
          style="width: {treeWidth}px"
          class="relative flex shrink-0 flex-col border-r border-base-300 bg-base-100"
        >
          <ActionsCluster
            bindings={{
              quickOpen: nav.registry.binding('nav.quick-open'),
              search: nav.registry.binding('nav.search'),
              commands: nav.registry.binding('nav.command-palette'),
            }}
            onQuickOpen={() => nav.open('quick-open')}
            onSearch={() => nav.open('search')}
            onCommands={() => nav.open('command')}
          />
          <div class="min-h-0 flex-1">
            <FileTree
              files={workspace.ui.files}
              records={workspace.ui.records}
              selected={selectedPath}
              mounts={workspace.ui.mounts}
              rootShared={workspace.ui.linked}
              presenceByRoom={workspace.ui.presenceByRoom}
              reveal={revealDir}
              onSelect={(path, opts) => openPath(path, opts)}
              onOp={fileOps.handle}
              onNotice={(level, text, path) => workspace?.notify({ level, text, path })}
            />
          </div>
          <div class="flex min-w-0 items-center gap-1 border-t border-base-300 px-2 py-1">
            <VaultSwitcher
              current={{ room: workspace.room, name: currentVaultName }}
              vaults={manager.vaults}
              onSwitch={(entry) => void session.boot(entry)}
              onManage={() => {
                manager.refresh()
                session.showManager()
              }}
            />
            <!-- The vault's own rollup, beside the vault's name: a dot and a
                 word, and a title that says whose state it is (P3). -->
            {#if globalStatus}
              <SyncPill
                status={globalStatus}
                testid="sync-pill-global"
                label={vaultLabel(globalStatus)}
                title={vaultTitle(globalStatus)}
              />
            {:else}
              <span
                data-testid="sync-summary"
                class="min-w-0 truncate text-xs text-base-content/70"
              >
                {$LL.web.shell.nothing_shared()}
              </span>
            {/if}
            <div class="ml-auto">
              <IconButton
                label={$LL.web.shell.settings_with_binding({ binding: nav.registry.binding('app.settings') })}
                icon={Settings}
                placement="top"
                testid="open-settings"
                onclick={() => (settingsOpen = true)}
              />
            </div>
          </div>
          <ResizeHandle
            value={treeWidth}
            min={TREE_WIDTH.min}
            max={TREE_WIDTH.max}
            step={TREE_WIDTH.step}
            label={$LL.web.shell.resize_navigator()}
            testid="tree-resize"
            collapseBelow={TREE_WIDTH.collapseBelow}
            onCollapse={() => (treeOpen = false)}
            onChange={(px) => (treeWidth = px)}
            onCommit={() => setLayoutPrefs({ treeWidth })}
          />
        </aside>
      {/if}

      <main
        data-testid="editor-area"
        aria-label={$LL.web.panes.area()}
        class="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <div class="flex min-h-0 min-w-0 flex-1 bg-base-200">
          {#if paneCtx}
            <PaneTree node={treeRoot} ctx={paneCtx} />
          {/if}
        </div>
        <ModeBar {panes} />
      </main>

      <RightRail
        sections={railSections}
        open={railOpen}
        folded={railFolded}
        onOpenChange={(o) => (railOpen = o)}
        onFoldChange={(id, f) => (railFolded = toggleFolded(railFolded, id, f))}
        onShowOnly={(id) => (railFolded = showOnly(RAIL_SECTIONS, id))}
        onCollapse={() => (railOpen = false)}
      >
        {#snippet children(id)}
          {#if id === 'links'}
            <LinksPanel
              backlinks={nav.links.backlinks}
              outgoing={nav.links.outgoing}
              path={selectedPath}
              onOpen={openPath}
              onCreate={(target) => void fileOps.createFromLink(target)}
            />
          {:else if id === 'note' && workspace}
            <NoteSection
              path={selectedPath}
              vaultName={currentVaultName}
              mounts={workspace.ui.mounts}
              rootLinked={workspace.ui.linked}
              rootRoom={workspace.room}
              presenceByRoom={workspace.ui.presenceByRoom}
              presenceAll={workspace.ui.presence}
              relayUrl={manager.relayDefault}
              secret={manager.opSecret}
              revision={sharing.revision}
              onManage={(mountPath) => (sharing.folderSharePath = mountPath)}
              onShareFolder={(dir) => (sharing.folderSharePath = dir)}
              onAddShare={(dir) => (sharing.addShareOpen = { dir })}
              onAddLink={(mountPath) => (sharing.addLinkPath = mountPath)}
            />
          {:else if id === 'history' && workspace}
            <HistorySection
              path={selectedPath}
              load={(p) => workspace!.fileHistory(p)}
              restore={(p, seq) => workspace!.restorePreImage(p, seq)}
              written={noteRecord?.diskMatchesCrdt ?? true}
              now={() => realClock.now()}
            />
          {:else if id === 'activity' && workspace}
            <ActivitySection
              notices={workspace.ui.notices}
              {devtools}
              onOpenPath={openPath}
              onClear={() => {
                if (workspace) workspace.ui.notices = []
              }}
              onDevtools={(on) => {
                setDevtools(on)
                devtools = debugForced || on
              }}
            />
          {/if}
        {/snippet}
      </RightRail>
    </div>
  </div>

  {#if activeReview}
    {#key activeReview.guid}
      <ReviewModal
        review={activeReview}
        onResolve={(guid, mergedText) => void workspace?.resolveReview(guid, mergedText)}
        onVanished={(guid, action) => void workspace?.resolveVanished(guid, action)}
      />
    {/key}
  {/if}

  {#if sharing.addShareOpen}
    <AddShareDialog
      dirs={dirPaths(workspace.ui.files)}
      initialDest={sharing.addShareOpen.dir ? `${sharing.addShareOpen.dir}/` : ''}
      onJoin={(link, dest) => workspace!.addShareMount(link, dest)}
      onClose={() => (sharing.addShareOpen = null)}
    />
  {/if}

  {#if sharing.addLinkPath}
    <AddLinkDialog
      path={sharing.addLinkPath}
      room={sharing.addLinkMount?.room ?? ''}
      onAdd={(link) => sharing.addMountLink(sharing.addLinkPath!, link)}
      onClose={() => (sharing.addLinkPath = null)}
    />
  {/if}

  {#if sharing.unshareConfirm}
    <ConfirmDialog
      title={$LL.web.share.unshare.title({ path: sharing.unshareConfirm.path })}
      body={$LL.web.share.unshare.body()}
      confirmLabel={$LL.web.share.unshare.confirm()}
      checkboxLabel={manager.opSecret ? $LL.web.share.unshare.revoke() : undefined}
      testid="unshare-confirm"
      onConfirm={(revoke) => void sharing.confirmUnshare(revoke)}
      onCancel={() => (sharing.unshareConfirm = null)}
    />
  {/if}

  {#if sharing.unmountConfirm}
    <ConfirmDialog
      title={$LL.web.share.unmount.title({ path: sharing.unmountConfirm })}
      body={$LL.web.share.unmount.body()}
      confirmLabel={$LL.web.share.unmount.confirm()}
      testid="unmount-confirm"
      onConfirm={() => void sharing.confirmUnmount()}
      onCancel={() => (sharing.unmountConfirm = null)}
    />
  {/if}

  {#if sharing.moveConfirm}
    <ConfirmDialog
      title={$LL.web.share.cross_move.title()}
      body={sharing.moveConfirm.leavingShared
        ? $LL.web.share.cross_move.leaving({ path: sharing.moveConfirm.from })
        : $LL.web.share.cross_move.entering({ path: sharing.moveConfirm.from })}
      confirmLabel={$LL.web.share.cross_move.confirm()}
      danger={sharing.moveConfirm.leavingShared}
      testid="cross-move-confirm"
      onConfirm={() => void sharing.confirmCrossMove()}
      onCancel={() => (sharing.moveConfirm = null)}
    />
  {/if}

  {#if fileOps.dialog}
    <TreeOpDialog
      mode={fileOps.dialog.mode}
      path={fileOps.dialog.path}
      kind={fileOps.dialog.kind}
      dirs={dirPaths(workspace.ui.files)}
      onConfirm={(v) => void fileOps.confirm(v)}
      onCancel={() => fileOps.cancel()}
    />
  {/if}

  {#if workspace.ui.breaker}
    <BreakerDialog
      paths={workspace.ui.breaker.paths}
      onConfirm={() => void workspace?.confirmBreaker()}
      onDismiss={() => workspace?.dismissBreaker()}
    />
  {/if}

  {#if sharing.folderSharePath}
    <FolderShareDialog
      path={sharing.folderSharePath}
      mount={sharing.folderShareMount}
      relayUrl={manager.relayDefault}
      secret={manager.opSecret}
      onShare={() => sharing.carveFolderShare()}
      onClose={() => {
        sharing.folderSharePath = null
        sharing.touch()
      }}
    />
  {/if}
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

  <!-- The group overlays. They live here, not in the strip, because the
       popover is opened from four places (a chip, a tab's menu, the `▾` list
       and `group.new`) and a pane is only one of them. -->
  {#if groups.manage && managed}
    {#key managed.id}
      <ManageGroupPopover
        group={managed}
        {panes}
        {groups}
        anchor={manageAnchor}
        fresh={groups.manage.fresh}
        onDelete={() => groups.askDelete(managed.id)}
        onClose={() => groups.closeManage()}
      />
    {/key}
  {/if}

  {#if groups.confirming && confirmingGroup}
    <ConfirmDialog
      title={$LL.web.groups.delete_confirm.title()}
      body={$LL.web.groups.delete_confirm.body({
        name: groupLabel(confirmingGroup.name),
        count: confirmingGroup.tabIds.length,
      })}
      confirmLabel={$LL.web.groups.delete_confirm.confirm()}
      danger
      testid="group-delete-confirm"
      onConfirm={() => groups.confirmDelete()}
      onCancel={() => groups.cancelDelete()}
    />
  {/if}

  {#if groups.showAll}
    <ShowAllGroupsDialog
      paneId={panes.layout.focus}
      {groups}
      now={() => realClock.now()}
      onClose={() => groups.closeShowAll()}
    />
  {/if}

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

<!-- The strip's three W2 seams, filled once for every pane: B1 left them as
     snippet props so the group chrome could land without moving anything in
     `TabStrip`. -->
{#snippet groupChip(group: Group, pane: PaneNode)}
  <GroupChip {group} {pane} {panes} onManage={(id) => groups.openManage(id)} />
{/snippet}

{#snippet tabMenuGroupItems(
  attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs },
  tab: PaneTab
)}
  <TabGroupMenuItems {attrs} {tab} {panes} {groups} />
{/snippet}

{#snippet moreMenuItems(
  attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs },
  pane: PaneNode
)}
  <StripGroupsMenu {attrs} {pane} {panes} {groups} now={() => realClock.now()} />
{/snippet}
