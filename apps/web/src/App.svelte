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
  import { configForMemory, configForSession, newFolderGuid } from './lib/boot.js'
  import AddLinkDialog from './lib/components/AddLinkDialog.svelte'
  import AddShareDialog from './lib/components/AddShareDialog.svelte'
  import DeviceLinkDialog from './lib/components/DeviceLinkDialog.svelte'
  import JoinProgress from './lib/components/JoinProgress.svelte'
  import LinkDeviceDialog from './lib/components/LinkDeviceDialog.svelte'
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte'
  import FolderShareDialog from './lib/components/FolderShareDialog.svelte'
  import {
    addShare,
    defaultRelay,
    deriveVaultName,
    devtoolsEnabled,
    getVault,
    hotkeys,
    lastVault,
    listVaults,
    loadShares,
    loadUser,
    mergeGrants,
    operatorSecret,
    purgeRooms,
    removeShare,
    removeVault,
    saveUser,
    setRoomToken,
    touchVault,
    upsertVault,
    type VaultEntry,
    type VaultSourceDesc,
  } from './lib/config.js'
  import { listShares, revokeShare } from './lib/relay-admin.js'
  import { buildAdapter, forgetVaultState } from './lib/vault-adapter.js'
  import { parseAppConfig } from './lib/params.js'
  import { hasOpfs, isTauri } from './lib/platform.js'
  import { containingDir, dirPaths, type TreeOp } from './lib/tree-model.js'
  import { decodeShareLink } from './lib/share-link.js'
  import { setupWorkspace, type PullProgress, type Workspace } from './lib/workspace.svelte.js'
  import LinksPanel from './lib/components/LinksPanel.svelte'
  import Palette from './lib/components/Palette.svelte'
  import { createNavigation, defaultCommands } from './lib/navigation.svelte.js'
  import { touchPath } from './lib/recent.js'
  import { themePath, installUserTheme, themeState } from './lib/theme.svelte.js'
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
  import { createPanes } from './lib/workspace-panes.svelte.js'
  import { createGroupUi } from './lib/group-ui.svelte.js'
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
  import {
    DAILY_DEFAULTS,
    dailyPath,
    dateOfPath,
    loadDailyConfig,
    neighbours,
    today,
    type DailyConfig,
  } from './lib/daily-notes.js'
  import { realClock } from './lib/real-clock.js'
  import { scopedRollup } from './lib/share-status.js'
  import { unreadCount } from './lib/notices.js'
  import { toast } from './lib/ui/toaster.js'
  import { setDevtools } from './lib/config.js'
  import { layoutPrefs, setLayoutPrefs } from './lib/config.js'
  import { TREE_WIDTH, toggleFolded } from './lib/layout.js'
  import { LL } from '@editor/i18n/i18n-svelte'

  const url = new URLSearchParams(location.search)
  const memConfig = parseAppConfig(url)

  let view = $state<'manager' | 'connecting' | 'workspace'>('connecting')
  let workspace = $state.raw<Workspace | null>(null)
  /** Boot failure surfaced on the manager — against its vault row when room is set. */
  let failure = $state<{ room: string | null; message: string } | null>(null)
  let busy = $state(false)
  let settingsOpen = $state(false)
  let vaults = $state(listVaults())
  let shares = $state(loadShares())
  let relayDefault = $state(defaultRelay())
  let opSecret = $state(operatorSecret())
  const prefillLink = url.get('share') ?? ''
  /**
   * Device linking (N2). `deviceLinkOpen` is the OWNER's dialog (Settings ›
   * Sync and the command palette both open it — never nested inside the
   * settings dialog); `linkDeviceOpen` is the NEW DEVICE's paste dialog on the
   * manager; `joining` + `pull` are the two-phase panel's whole state.
   */
  let deviceLinkOpen = $state(false)
  let linkDeviceOpen = $state(false)
  let joining = $state<{ entry: VaultEntry; destination: string } | null>(null)
  let pull = $state<PullProgress | null>(null)
  /** ?debug=1 forces the sync devtools on for this session (M6). */
  const debugForced = url.get('debug') === '1'
  let devtools = $state(debugForced || devtoolsEnabled())

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
      const notes = new Set(
        (workspace?.ui.files ?? []).filter((f) => f.kind === 'text').map((f) => f.path)
      )
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
  /** Bumped when a share dialog closes so the note section refetches its access list. */
  let shareRevision = $state(0)
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
  /** Read once per vault; `DAILY_DEFAULTS` until it answers (and if it is absent). */
  let dailyCfg = $state<DailyConfig>(DAILY_DEFAULTS)
  $effect(() => {
    const ws = workspace
    if (!ws) return
    let live = true
    void loadDailyConfig((path) => ws.readAppFile(path)).then((cfg) => {
      if (live) dailyCfg = cfg
    })
    return () => {
      live = false
    }
  })

  /**
   * The dailies either side of where we are — from the focused note's own
   * date when it is a daily, else from today. Computed fresh because the day
   * can turn over while the app is open; `dailySteps` is the memoized read,
   * so the `when` guards (which run on EVERY keypress, via registry.match)
   * never rescan the vault.
   */
  function dailyNeighbours(): { prev: string | null; next: string | null } {
    const files = workspace?.ui.files
    if (!files) return { prev: null, next: null }
    const from =
      dateOfPath(dailyCfg, workspace?.ui.selectedPath ?? null) ?? today(() => realClock.now())
    return neighbours(
      dailyCfg,
      files.filter((f) => f.kind === 'text').map((f) => f.path),
      from
    )
  }
  const dailySteps = $derived(dailyNeighbours())

  /**
   * Today's daily note, created if it is not there yet. Empty, as Obsidian
   * creates it with no template configured — Chris has none.
   */
  async function openDailyToday(): Promise<void> {
    if (!workspace) return
    const path = dailyPath(dailyCfg, today(() => realClock.now()))
    if (workspace.ui.files.some((f) => f.path === path)) {
      openPath(path)
      return
    }
    const cut = path.lastIndexOf('/')
    // createFile answers with the path and opens nothing — WHERE a new note
    // lands is the shell's call now (tab-groups B5). It adopts a file already
    // on disk rather than clobbering it, so a note Obsidian wrote today opens
    // untouched.
    const created = await workspace.createFile(
      cut === -1 ? '' : path.slice(0, cut),
      path.slice(cut + 1)
    )
    if (created) openPath(created)
  }

  /** Walk to the neighbouring daily; a no-op at either end (the guards agree). */
  function stepDaily(side: 'prev' | 'next'): void {
    const path = dailyNeighbours()[side]
    if (path) openPath(path)
  }

  nav.registry.register(
    ...defaultCommands({
      quickOpen: () => nav.open('quick-open'),
      commandPalette: () => nav.open('command'),
      search: () => nav.open('search'),
      newNote: () => void createNote(''),
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
        if (path) treeOp = { type: 'delete', path, kind: 'text' }
      },
      moveNote: () => {
        const path = workspace?.ui.selectedPath
        if (path) treeOp = { type: 'move', path, kind: 'text' }
      },
      newFolder: () => {
        if (workspace) treeOp = { type: 'new-folder', dir: containingDir(workspace.ui.selectedPath, 'text') }
      },
      addShare: () => {
        if (workspace) addShareOpen = { dir: '' }
      },
      linkDevice: () => {
        if (workspace) deviceLinkOpen = true
      },
      dailyToday: () => void openDailyToday(),
      // Fresh, not `dailySteps`: the guard's memo is for the keypress path,
      // the step itself must be right even if a day turned over since.
      dailyPrev: () => stepDaily('prev'),
      dailyNext: () => stepDaily('next'),
      hasPrevDaily: () => dailySteps.prev !== null,
      hasNextDaily: () => dailySteps.next !== null,
    })
  )
  // Every `workspace.*` and `tab.*` row of the command table (B7). Registered
  // after the defaults so a later rebind of a shared key wins, as the registry
  // documents.
  nav.registry.register(...panes.commands())
  // The `group.*` table (W2). Registered after the pane rows for the same
  // reason they come after the defaults: a later registration wins a shared key.
  nav.registry.register(...groups.commands())
  // One palette row per SAVED group (Fork 2-A). A provider rather than
  // registrations, because the ids come and go every time a group is closed
  // or reopened — and a row nobody can predict is a row nobody can bind.
  nav.registry.addProvider(() => groups.savedCommands())
  // The user's own bindings sit over those defaults (R1.3). Settings writes
  // config and re-applies them itself, so this is the boot read.
  nav.registry.setOverrides(hotkeys())

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

  /** Create an auto-named note in `dir` and open it in the focused pane. */
  async function createNote(dir: string): Promise<void> {
    const created = await workspace?.createFile(dir)
    if (created) openPath(created)
  }

  /**
   * Create the note an unresolved link points at, in the linking note's own
   * folder — matching where the link's author was working, which is what
   * Obsidian's default new-note location does in practice.
   */
  async function createFromLink(target: string): Promise<void> {
    if (!workspace) return
    const clean = target.trim().replace(/^\/+/, '')
    if (!clean) return
    const from = workspace.ui.selectedPath ?? ''
    const dir = clean.includes('/')
      ? ''
      : from.includes('/')
        ? from.slice(0, from.lastIndexOf('/'))
        : ''
    const name = clean.endsWith('.md') ? clean : `${clean}.md`
    const created = await workspace.createFile(dir, name, `# ${clean.split('/').pop()}\n\n`)
    if (created) openPath(created)
  }

  /**
   * Boot generation: bumped by Cancel and by every new boot so a stale
   * setupWorkspace settling late can neither install itself nor clobber the
   * view. A cancelled boot's workspace is disposed when it settles.
   */
  let bootGen = 0

  function refreshLists(): void {
    vaults = listVaults()
    shares = loadShares()
    relayDefault = defaultRelay()
    opSecret = operatorSecret()
  }

  function userName(): string {
    return loadUser() ?? 'Anonymous'
  }

  /**
   * Boot a registered vault; failures land on the manager, never a dead end.
   *
   * `busy` stays TRUE until this resolves (device-link N2): the join path used
   * to clear it and then await the boot, so the manager re-enabled every
   * button while a whole vault was being pulled. A first join with `joining`
   * set keeps its failure on the progress panel instead of the manager — the
   * panel offers the retry, and retrying is the right move for a stall.
   */
  async function bootVault(entry: VaultEntry): Promise<void> {
    const gen = ++bootGen
    view = 'connecting'
    failure = null
    busy = true
    pull = null
    // Drop the previous vault's index BEFORE the next one fills it.
    nav.attach(null)
    try {
      const ws = await setupWorkspace({
        ...(await configForSession(entry, userName())),
        index: nav.sink,
        // A rename must reach the tabs and their histories in the same turn
        // the file list changes, or the prune would close a tab that only
        // moved (B6, S9-Q4).
        onPathsRenamed: (moves) => panes.onRenamed(moves),
        // Reported from inside setupWorkspace, before it resolves — the whole
        // point of the panel (spike S10 Q4).
        onPull: (progress) => {
          if (gen === bootGen) pull = progress
        },
      })
      if (gen !== bootGen) {
        ws.dispose() // cancelled or superseded while awaiting
        return
      }
      workspace?.dispose()
      workspace = ws
      nav.attach(ws)
      // After `ui.files` exists, so the restored tree is pruned against the
      // vault before a single editor mounts (B6).
      panes.attach(ws, entry.room)
      void restoreCustomTheme(ws)
      touchVault(entry.room, Date.now())
      refreshLists()
      joining = null
      view = 'workspace'
    } catch (err) {
      if (gen !== bootGen) return
      failure = { room: entry.room, message: err instanceof Error ? err.message : String(err) }
      if (!joining) view = 'manager'
    } finally {
      if (gen === bootGen) busy = false
    }
  }

  /** Memory URL contract (dev / Playwright L2) — bypasses the manager entirely. */
  async function bootMemory(cfg: Extract<typeof memConfig, { kind: 'memory' }>): Promise<void> {
    const gen = ++bootGen
    view = 'connecting'
    nav.attach(null)
    try {
      const ws = await setupWorkspace({
        ...(await configForMemory(cfg)),
        index: nav.sink,
        onPathsRenamed: (moves) => panes.onRenamed(moves),
      })
      if (gen !== bootGen) {
        ws.dispose()
        return
      }
      workspace = ws
      nav.attach(ws)
      panes.attach(ws, ws.room)
      view = 'workspace'
    } catch (err) {
      if (gen !== bootGen) return
      failure = { room: null, message: err instanceof Error ? err.message : String(err) }
      view = 'manager'
    }
  }

  /**
   * The pre-paint script restores the `data-theme` attribute, but a custom
   * theme's CSS lives in the vault and cannot be read until one is open. Fetch
   * and install it as soon as it can be; a missing file leaves the attribute
   * pointing at nothing, which resolves to the contract defaults rather than
   * to a broken page.
   */
  async function restoreCustomTheme(ws: Workspace): Promise<void> {
    if (!themeState.pref.startsWith('custom:')) return
    const name = themeState.pref.slice('custom:'.length)
    try {
      const css = await ws.readAppFile(themePath(name))
      if (css) installUserTheme(css)
    } catch {
      // A vault without the theme file: the built-in defaults still apply.
    }
  }

  function cancelBoot(): void {
    bootGen++
    joining = null
    pull = null
    busy = false
    view = workspace ? 'workspace' : 'manager'
  }

  /**
   * After onboarding, drop any bootstrap query params from the address bar so a
   * reload reopens via the persisted vault (not the deep link) — and so a
   * share secret never lingers in the URL / history (R5).
   */
  function cleanUrl(): void {
    if (location.search) history.replaceState({}, '', location.pathname)
  }

  // ---- initial routing ----
  if (memConfig.kind === 'memory') {
    void bootMemory(memConfig)
  } else if (memConfig.kind === 'error') {
    failure = { room: null, message: memConfig.message }
    view = 'manager'
  } else {
    const last = lastVault()
    if (last && !prefillLink) {
      // Attempted once; a failure routes to the manager with the error shown
      // against this entry (no reload retrap — the entry is fixable there).
      void bootVault(last)
    } else {
      view = 'manager'
    }
  }

  // ---- manager actions ----
  async function openFolder(name: string): Promise<void> {
    saveUser(name)
    failure = null
    busy = true
    try {
      const { pickVaultFolder } = await import('./lib/adapters/tauri-vault-adapter.js')
      const path = await pickVaultFolder()
      if (!path) {
        busy = false
        return
      }
      // Reopening a known folder resumes its entry (same room/stores) instead
      // of minting a second identity for the same bytes.
      const existing = listVaults().find((v) => v.vault.kind === 'tauri' && v.vault.path === path)
      const entry: VaultEntry = existing ?? {
        name: deriveVaultName({ kind: 'tauri', path }),
        vault: { kind: 'tauri', path },
        room: newFolderGuid(),
      }
      upsertVault(entry)
      refreshLists()
      cleanUrl()
      await bootVault(entry)
    } catch (err) {
      failure = { room: null, message: err instanceof Error ? err.message : String(err) }
      busy = false
    }
  }

  async function createBrowserVault(name: string, vaultName: string): Promise<void> {
    saveUser(name)
    failure = null
    const entry: VaultEntry = {
      name: vaultName,
      vault: { kind: 'opfs', id: crypto.randomUUID() },
      room: newFolderGuid(),
    }
    upsertVault(entry)
    refreshLists()
    cleanUrl()
    await bootVault(entry)
  }

  async function joinShare(name: string, link: string): Promise<void> {
    saveUser(name)
    failure = null
    busy = true
    let target: ReturnType<typeof decodeShareLink>
    try {
      target = decodeShareLink(link)
    } catch {
      failure = { room: null, message: $LL.web.manager.errors.invalid_link() }
      busy = false
      return
    }
    // A device link pasted here is not a folder share — it is this vault, and
    // it wants the device path (grants merged before boot, the destination
    // checked, the token stored as a device key).
    if (target.kind === 'device') {
      try {
        await linkThisDevice(link)
      } catch (err) {
        failure = { room: null, message: err instanceof Error ? err.message : String(err) }
        busy = false
      }
      return
    }
    try {
      let entry: VaultEntry
      if (isTauri()) {
        const { pickVaultFolder } = await import('./lib/adapters/tauri-vault-adapter.js')
        const path = await pickVaultFolder()
        if (!path) {
          busy = false
          return
        }
        entry = {
          name: deriveVaultName({ kind: 'tauri', path }),
          vault: { kind: 'tauri', path },
          room: target.room,
          relay: { url: target.relay, token: target.token },
          firstJoin: true,
        }
      } else {
        entry = {
          name: 'Shared vault',
          vault: { kind: 'opfs', id: target.room },
          room: target.room,
          relay: { url: target.relay, token: target.token },
          firstJoin: true,
        }
      }
      upsertVault(entry)
      // Label the remembered share by the vault it opens as — not the joiner's
      // own name (the "Recent shares show my name" bug).
      addShare({ link, room: target.room, label: entry.name })
      refreshLists()
      cleanUrl()
      // A whole-vault pull gets the panel too: it is the same minute of
      // waiting whichever affordance started it.
      joining = { entry, destination: destinationOf(entry.vault) }
      await bootVault(entry)
    } catch (err) {
      failure = { room: null, message: err instanceof Error ? err.message : String(err) }
      busy = false
    }
  }

  /** What the progress panel calls the place the vault is being written. */
  function destinationOf(vault: VaultSourceDesc): string {
    return vault.kind === 'tauri' ? vault.path : $LL.web.manager.browser_vault()
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

  /**
   * Link THIS device (device-link-shaping A1/A4-B, slice N2): the whole vault
   * arrives here from the master copy. Rejects with the reason — the dialog
   * keeps the paste and shows it.
   *
   * Order matters: the link's grants are merged BEFORE the boot, so the root's
   * firstJoin pull and every adopt that follows find their tokens already in
   * place rather than flashing `needs-token` and repairing themselves
   * (spike S10 Q7).
   */
  async function linkThisDevice(link: string): Promise<void> {
    const target = decodeShareLink(link)
    if (target.kind !== 'device') throw new Error($LL.web.device_link.join_not_device())
    const existing = getVault(target.room)
    if (existing) throw new Error($LL.web.device_link.already_linked({ name: existing.name }))
    let vault: VaultSourceDesc
    if (isTauri()) {
      const { pickVaultFolder } = await import('./lib/adapters/tauri-vault-adapter.js')
      const path = await pickVaultFolder()
      if (!path) return // the picker was cancelled; nothing has happened yet
      if (!(await folderIsEmpty(path))) {
        throw new Error($LL.web.device_link.not_empty({ path }))
      }
      vault = { kind: 'tauri', path }
    } else {
      // A fresh private vault, not one keyed by the room: linking twice into
      // the same browser must not land in a half-written directory.
      vault = { kind: 'opfs', id: crypto.randomUUID() }
    }
    if (target.grants.length > 0) mergeGrants(target.grants)
    setRoomToken(target.room, target.token, target.relay, 'device')
    const entry: VaultEntry = {
      name: deriveVaultName(vault),
      vault,
      room: target.room,
      relay: { url: target.relay, token: target.token },
      firstJoin: true,
    }
    upsertVault(entry)
    refreshLists()
    cleanUrl()
    linkDeviceOpen = false
    joining = { entry, destination: destinationOf(vault) }
    await bootVault(entry)
  }

  async function removeVaultEntry(room: string): Promise<void> {
    const entry = getVault(room)
    // Removing the vault that is OPEN right now: dispose the workspace first
    // so its debounced flushes can't write into a half-wiped namespace. Any
    // flush already in flight may still land after the wipe — the remnant is
    // inert, since a reopen mints a new room and never reads the old one.
    if (workspace?.room === room) {
      ++bootGen // supersede any in-flight boot of this vault
      nav.attach(null)
      panes.attach(null, '')
      workspace.dispose()
      workspace = null
    }
    // Config entry goes first and unconditionally (never strand the registry
    // on a store-wipe failure — leftover stores are inert for the same
    // new-room reason).
    removeVault(room)
    if (failure?.room === room) failure = null
    refreshLists()
    if (entry) {
      try {
        purgeRooms(await forgetVaultState(entry))
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        failure = { room: null, message: $LL.web.manager.errors.forget_partial({ message: msg }) }
      }
      refreshLists()
    }
  }

  // ---- in-workspace sharing (M4: minted in-app, zero terminal) ----
  //
  // The FOLDER is the unit of sharing (dogfood-shaping R3), reached from the
  // tree's context menu. Promoting the whole vault from the UI was removed on
  // 2026-09-07: it made every folder share silently impossible afterwards (the
  // V1 no-nested-shares guard, spike S8 "The mount model") with no visible
  // rule. Vaults that are ALREADY root-shared — joined from a whole-vault link,
  // or relay-attached by the memory URL contract — still boot, sync and read
  // "shared"; they simply have no share-management UI, and the tree says why
  // their folders cannot be shared.

  /** Folder being shared/managed via the tree's share action, else null. */
  let folderSharePath = $state<string | null>(null)
  const folderShareMount = $derived(
    folderSharePath && workspace
      ? (workspace.ui.mounts.find((m) => m.path === folderSharePath) ?? null)
      : null
  )

  async function carveFolderShare(): Promise<string> {
    if (!workspace || !folderSharePath) throw new Error('no folder selected')
    const path = folderSharePath
    const link = await workspace.carveFolder(path)
    const room = workspace.ui.mounts.find((m) => m.path === path)?.room
    if (room) {
      addShare({ link, room, label: `${getVault(workspace.room)?.name ?? 'vault'}/${path}` })
    }
    refreshLists()
    return link
  }

  /**
   * Mint a device link and promote the root mount (device-link N2, A1). The
   * shim does the work; this only refreshes what the manager and settings
   * show, because a linked vault now carries a relay in its registry entry.
   */
  async function createDeviceLink(label: string): Promise<string> {
    if (!workspace) throw new Error($LL.web.device_link.needs_vault())
    const link = await workspace.linkDevice(label)
    refreshLists()
    shareRevision++
    return link
  }

  // ---- M5: add-share, unshare/unmount, cross-mount move confirms ----
  /** Join-a-share dialog, with the folder it was asked from ('' = vault root). */
  let addShareOpen = $state<{ dir: string } | null>(null)
  /**
   * Add-link dialog for a `needs-token` mount (device-link N1): the mount is
   * already here, only its key is missing.
   */
  let addLinkPath = $state<string | null>(null)
  const addLinkMount = $derived(
    addLinkPath && workspace
      ? (workspace.ui.mounts.find((m) => m.path === addLinkPath) ?? null)
      : null
  )

  /**
   * Activate a needs-token mount in place. The failure is reported twice on
   * purpose: as a notice (so it is in Activity, like every other workspace
   * error, chrome U5) and rethrown so the dialog keeps the paste and shows the
   * reason where the user is looking.
   */
  async function addMountLink(path: string, link: string): Promise<void> {
    if (!workspace) return
    try {
      await workspace.addMountLink(path, link)
      refreshLists()
    } catch (err) {
      workspace.notify({ level: 'error', text: err instanceof Error ? err.message : String(err), path })
      throw err
    }
  }
  let unshareConfirm = $state<{ path: string; provenance: string } | null>(null)
  let unmountConfirm = $state<string | null>(null)
  let moveConfirm = $state<{ from: string; to: string; leavingShared: boolean } | null>(null)

  async function confirmUnshare(revokeTokens: boolean): Promise<void> {
    const target = unshareConfirm
    unshareConfirm = null
    if (!target || !workspace) return
    const room = workspace.ui.mounts.find((m) => m.path === target.path)?.room
    try {
      await workspace.unshare(target.path)
      if (room) {
        removeShare(room)
        setRoomToken(room, '')
        if (revokeTokens && operatorSecret()) {
          for (const share of await listShares(defaultRelay(), operatorSecret(), room)) {
            await revokeShare(defaultRelay(), operatorSecret(), share.token)
          }
        }
      }
      refreshLists()
    } catch (err) {
      workspace?.notify({ level: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  async function confirmUnmount(): Promise<void> {
    const path = unmountConfirm
    unmountConfirm = null
    if (!path || !workspace) return
    // The folder leaves the vault: its tabs go with it, now rather than when
    // the file list settles (B6).
    panes.closeUnder(path)
    const room = workspace.ui.mounts.find((m) => m.path === path)?.room
    try {
      await workspace.unmount(path)
      if (room) {
        removeShare(room)
        setRoomToken(room, '')
      }
      refreshLists()
    } catch (err) {
      workspace?.notify({ level: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  async function confirmCrossMove(): Promise<void> {
    const mv = moveConfirm
    moveConfirm = null
    if (!mv || !workspace) return
    try {
      await workspace.movePath(mv.from, mv.to)
    } catch (err) {
      workspace?.notify({ level: 'error', text: err instanceof Error ? err.message : String(err) })
    }
  }

  // ---- tree operations (M3): the tree requests, App owns the dialogs ----
  let treeOp = $state<TreeOp | null>(null)

  function handleTreeOp(op: TreeOp): void {
    if (!workspace) return
    if (op.type === 'new-file') {
      void createNote(op.dir) // auto-named untitled-N; rename after
      return
    }
    if (op.type === 'share-folder') {
      folderSharePath = op.path
      return
    }
    if (op.type === 'add-share') {
      addShareOpen = { dir: op.dir }
      return
    }
    if (op.type === 'add-link') {
      addLinkPath = op.path
      return
    }
    if (op.type === 'history') {
      // The section reads the FOCUSED note, so History… focuses this one and
      // then makes sure the rail is showing that section.
      openPath(op.path)
      railOpen = true
      railFolded = toggleFolded(railFolded, 'history', false)
      return
    }
    if (op.type === 'unshare') {
      const provenance =
        workspace.ui.mounts.find((m) => m.path === op.path)?.provenance ?? 'carved'
      unshareConfirm = { path: op.path, provenance }
      return
    }
    if (op.type === 'unmount') {
      unmountConfirm = op.path
      return
    }
    if (op.type === 'move-to') {
      // Drag-and-drop already resolved the destination; the boundary rules are
      // identical to the Move… dialog's, so both land in one place.
      void performMove(op.from, op.to)
      return
    }
    treeOp = op
  }

  /**
   * Move `from` to `to`, asking first when it crosses a share boundary —
   * that changes who can see the content, so it is never silent (spike S8 Q5).
   */
  async function performMove(from: string, to: string): Promise<void> {
    if (!workspace) return
    if (workspace.isCrossMount(from, to)) {
      const leavingShared = workspace.ui.mounts.some(
        (m) => from === m.path || from.startsWith(`${m.path}/`)
      )
      moveConfirm = { from, to, leavingShared }
    } else {
      await workspace.movePath(from, to)
    }
  }

  async function confirmTreeOp(value: string): Promise<void> {
    const op = treeOp
    treeOp = null
    if (!op || !workspace) return
    if (op.type === 'new-folder') {
      await workspace.createDir(op.dir ? `${op.dir}/${value}` : value)
    } else if (op.type === 'rename') {
      const parent = op.path.includes('/') ? op.path.slice(0, op.path.lastIndexOf('/')) : ''
      await workspace.renamePath(op.path, parent ? `${parent}/${value}` : value)
    } else if (op.type === 'move') {
      const base = op.path.slice(op.path.lastIndexOf('/') + 1)
      await performMove(op.path, value ? `${value}/${base}` : base)
    } else if (op.type === 'delete') {
      await workspace.deletePath(op.path)
    }
  }

  /** Narrowed props for the dialog (ops with their own affordance never open this one). */
  const treeOpDialog = $derived.by(() => {
    if (
      !treeOp ||
      treeOp.type === 'new-file' ||
      treeOp.type === 'move-to' ||
      treeOp.type === 'share-folder' ||
      treeOp.type === 'add-share' ||
      treeOp.type === 'add-link' ||
      treeOp.type === 'unshare' ||
      treeOp.type === 'unmount' ||
      treeOp.type === 'history'
    )
      return null
    if (treeOp.type === 'new-folder')
      return { mode: 'new-folder' as const, path: treeOp.dir, kind: 'dir' as const }
    return { mode: treeOp.type, path: treeOp.path, kind: treeOp.kind }
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
          resolveLink: (target, from) => nav.resolveLink(target, from),
          createFromLink: (target) => void createFromLink(target),
          linkCandidates: () =>
            (workspace?.ui.files ?? []).filter((f) => f.kind === 'text').map((f) => f.path),
          reveal: nav.pending.reveal,
          groupChip,
          tabMenuGroupItems,
          moreMenuItems,
        }
      : null
  )
  /** The group the manage popover is on, or null — it may have been closed. */
  const managed = $derived(groups.manage ? panes.findGroup(groups.manage.groupId) : null)
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
    {vaults}
    {shares}
    {prefillLink}
    {failure}
    {busy}
    canGoBack={workspace !== null}
    onOpenVault={(entry) => void bootVault(entry)}
    onRemoveVault={removeVaultEntry}
    onOpenFolder={openFolder}
    onCreateBrowserVault={createBrowserVault}
    onJoin={joinShare}
    onLinkDevice={(name) => {
      saveUser(name)
      failure = null
      linkDeviceOpen = true
    }}
    onBack={() => (view = 'workspace')}
    onSettings={() => (settingsOpen = true)}
  />
{:else if view === 'connecting' || !workspace}
  {#if joining}
    <!-- A whole vault is arriving: two determinate phases, no editor surface
         until the boot resolves (the tree is empty and the folder is
         half-written until then). -->
    <JoinProgress
      vaultName={joining.entry.name}
      destination={joining.destination}
      progress={pull}
      error={failure?.message ?? null}
      onRetry={() => {
        if (joining) void bootVault(joining.entry)
      }}
      onCancel={cancelBoot}
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
          onclick={cancelBoot}
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
      <div class="ml-auto flex min-w-0 items-center gap-3">
        {#if globalStatus}
          <SyncPill status={globalStatus} testid="sync-pill-global" label={globalStatus} />
        {:else}
          <span data-testid="sync-summary" class="text-xs text-base-content/70">{$LL.web.shell.nothing_shared()}</span>
        {/if}
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
              onOp={handleTreeOp}
              onNotice={(level, text, path) => workspace?.notify({ level, text, path })}
            />
          </div>
          <div class="flex items-center gap-1 border-t border-base-300 px-2 py-1">
            <VaultSwitcher
              current={{ room: workspace.room, name: currentVaultName }}
              {vaults}
              onSwitch={(entry) => void bootVault(entry)}
              onManage={() => {
                refreshLists()
                view = 'manager'
              }}
            />
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
      >
        {#snippet children(id)}
          {#if id === 'links'}
            <LinksPanel
              backlinks={nav.links.backlinks}
              outgoing={nav.links.outgoing}
              path={selectedPath}
              onOpen={openPath}
              onCreate={(target) => void createFromLink(target)}
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
              relayUrl={relayDefault}
              secret={opSecret}
              revision={shareRevision}
              onManage={(mountPath) => (folderSharePath = mountPath)}
              onShareFolder={(dir) => (folderSharePath = dir)}
              onAddShare={(dir) => (addShareOpen = { dir })}
              onAddLink={(mountPath) => (addLinkPath = mountPath)}
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

  {#if addShareOpen}
    <AddShareDialog
      dirs={dirPaths(workspace.ui.files)}
      initialDest={addShareOpen.dir ? `${addShareOpen.dir}/` : ''}
      onJoin={(link, dest) => workspace!.addShareMount(link, dest)}
      onClose={() => (addShareOpen = null)}
    />
  {/if}

  {#if addLinkPath}
    <AddLinkDialog
      path={addLinkPath}
      room={addLinkMount?.room ?? ''}
      onAdd={(link) => addMountLink(addLinkPath!, link)}
      onClose={() => (addLinkPath = null)}
    />
  {/if}

  {#if unshareConfirm}
    <ConfirmDialog
      title={$LL.web.share.unshare.title({ path: unshareConfirm.path })}
      body={$LL.web.share.unshare.body()}
      confirmLabel={$LL.web.share.unshare.confirm()}
      checkboxLabel={opSecret ? $LL.web.share.unshare.revoke() : undefined}
      testid="unshare-confirm"
      onConfirm={(revoke) => void confirmUnshare(revoke)}
      onCancel={() => (unshareConfirm = null)}
    />
  {/if}

  {#if unmountConfirm}
    <ConfirmDialog
      title={$LL.web.share.unmount.title({ path: unmountConfirm })}
      body={$LL.web.share.unmount.body()}
      confirmLabel={$LL.web.share.unmount.confirm()}
      testid="unmount-confirm"
      onConfirm={() => void confirmUnmount()}
      onCancel={() => (unmountConfirm = null)}
    />
  {/if}

  {#if moveConfirm}
    <ConfirmDialog
      title={$LL.web.share.cross_move.title()}
      body={moveConfirm.leavingShared
        ? $LL.web.share.cross_move.leaving({ path: moveConfirm.from })
        : $LL.web.share.cross_move.entering({ path: moveConfirm.from })}
      confirmLabel={$LL.web.share.cross_move.confirm()}
      danger={moveConfirm.leavingShared}
      testid="cross-move-confirm"
      onConfirm={() => void confirmCrossMove()}
      onCancel={() => (moveConfirm = null)}
    />
  {/if}

  {#if treeOpDialog}
    <TreeOpDialog
      mode={treeOpDialog.mode}
      path={treeOpDialog.path}
      kind={treeOpDialog.kind}
      dirs={dirPaths(workspace.ui.files)}
      onConfirm={(v) => void confirmTreeOp(v)}
      onCancel={() => (treeOp = null)}
    />
  {/if}

  {#if workspace.ui.breaker}
    <BreakerDialog
      paths={workspace.ui.breaker.paths}
      onConfirm={() => void workspace?.confirmBreaker()}
      onDismiss={() => workspace?.dismissBreaker()}
    />
  {/if}

  {#if folderSharePath}
    <FolderShareDialog
      path={folderSharePath}
      mount={folderShareMount}
      relayUrl={relayDefault}
      secret={opSecret}
      onShare={carveFolderShare}
      onClose={() => {
        folderSharePath = null
        shareRevision++
      }}
    />
  {/if}
  {#if deviceLinkOpen}
    <DeviceLinkDialog
      vaultName={currentVaultName}
      room={workspace.room}
      relayUrl={relayDefault}
      secret={opSecret}
      onCreate={createDeviceLink}
      onClose={() => {
        deviceLinkOpen = false
        refreshLists()
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
        name: confirmingGroup.name || $LL.web.groups.untitled(),
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

{#if linkDeviceOpen}
  <LinkDeviceDialog
    isTauri={isTauri()}
    initialLink={prefillLink}
    onLink={linkThisDevice}
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
          refreshLists()
          settingsOpen = false
          deviceLinkOpen = true
        }
      : undefined}
    onClose={() => {
      settingsOpen = false
      refreshLists()
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
