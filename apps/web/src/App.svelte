<script lang="ts">
  import MarkdownEditor from '@editor/editor/src/MarkdownEditor.svelte'
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
  import ConfirmDialog from './lib/components/ConfirmDialog.svelte'
  import FolderShareDialog from './lib/components/FolderShareDialog.svelte'
  import {
    addShare,
    defaultRelay,
    deriveVaultName,
    devtoolsEnabled,
    getVault,
    lastVault,
    listVaults,
    loadShares,
    loadUser,
    operatorSecret,
    purgeRooms,
    removeShare,
    removeVault,
    saveUser,
    setRoomToken,
    touchVault,
    upsertVault,
    type VaultEntry,
  } from './lib/config.js'
  import { listShares, revokeShare } from './lib/relay-admin.js'
  import { forgetVaultState } from './lib/vault-adapter.js'
  import { parseAppConfig } from './lib/params.js'
  import { hasOpfs, isTauri } from './lib/platform.js'
  import { containingDir, dirPaths, type TreeOp } from './lib/tree-model.js'
  import { decodeShareLink } from './lib/share-link.js'
  import { pillStatus } from './lib/sync-record.svelte.js'
  import { setupWorkspace, type Workspace } from './lib/workspace.svelte.js'
  import { wikiLinkHost, type WikiLinkHost } from '@editor/editor-lang'
  import LinksPanel from './lib/components/LinksPanel.svelte'
  import Palette from './lib/components/Palette.svelte'
  import { createNavigation, defaultCommands } from './lib/navigation.svelte.js'
  import { NavHistory } from './lib/nav-history.js'
  import { touchPath } from './lib/recent.js'
  import { themePath, installUserTheme, themeState } from './lib/theme.svelte.js'
  import Toaster from './lib/ui/Toaster.svelte'
  import IconButton from './lib/ui/IconButton.svelte'
  import ResizeHandle from './lib/ui/ResizeHandle.svelte'
  import ActionsCluster from './lib/components/ActionsCluster.svelte'
  import Breadcrumb from './lib/components/Breadcrumb.svelte'
  import RightRail, { type RailSection } from './lib/components/RightRail.svelte'
  import StatusBar from './lib/components/StatusBar.svelte'
  import { Bell, Link2, PanelLeft, PanelRight, Settings, Users } from '@lucide/svelte'
  import ActivitySection from './lib/components/ActivitySection.svelte'
  import NoteSection from './lib/components/NoteSection.svelte'
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
  /** ?debug=1 forces the sync devtools on for this session (M6). */
  const debugForced = url.get('debug') === '1'
  let devtools = $state(debugForced || devtoolsEnabled())

  // ---- V2b/V2c: index, commands, palette, link panels ----
  const nav = createNavigation()
  const navHistory = new NavHistory()

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

  /** Suppresses the history push while back/forward is doing the navigating. */
  let travelling = false
  /** Selection-aware word count for the status bar. */
  let wordCount = $state(0)
  nav.setLinksVisible(() => linksVisible)

  nav.registry.register(
    ...defaultCommands({
      quickOpen: () => nav.open('quick-open'),
      commandPalette: () => nav.open('command'),
      search: () => nav.open('search'),
      newNote: () => void workspace?.createFile(''),
      toggleSidebar: () => (treeOpen = !treeOpen),
      toggleRail: () => (railOpen = !railOpen),
      settings: () => (settingsOpen = true),
      back: () => travel(navHistory.back()),
      forward: () => travel(navHistory.forward()),
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
    })
  )

  /** Open a path from the history without recording it as a new visit. */
  function travel(path: string | null): void {
    if (!path || !workspace) return
    travelling = true
    workspace.select(path)
    travelling = false
  }

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
    const command = nav.registry.match(e)
    if (!command) return
    e.preventDefault()
    e.stopPropagation()
    void command.run()
  }

  /**
   * What the editor may do with a `[[link]]`. Module-stable so reconfiguring
   * the compartment never rebuilds the view (and never rebinds the Y.Text).
   */
  const linkHost: WikiLinkHost = {
    resolve: (target) => nav.resolveLink(target, workspace?.ui.selectedPath ?? undefined),
    open: (path) => openPath(path),
    create: (target) => void createFromLink(target),
    candidates: () => (workspace?.ui.files ?? []).filter((f) => f.kind === 'text').map((f) => f.path),
  }
  const editorExtensions = [wikiLinkHost.of(linkHost)]

  function openPath(path: string): void {
    if (!workspace) return
    workspace.select(path)
    touchPath(workspace.room, path)
  }

  // Record every settled selection, wherever it came from — the tree, a
  // wikilink, quick-open, search — except the ones back/forward performed.
  $effect(() => {
    const path = workspace?.ui.selectedPath
    if (path && !travelling) navHistory.push(path)
  })

  // Keep history honest after deletes and renames.
  $effect(() => {
    const files = workspace?.ui.files
    if (files) navHistory.prune(new Set(files.map((f) => f.path)))
  })

  /**
   * Word count over the open note, selection-aware — `word-count` is enabled
   * in Chris's Obsidian while `editor-status` is disabled, so this readout
   * specifically is the one he keeps.
   */
  $effect(() => {
    nav.revision // any content change, from any writer
    const doc = selectedDoc
    wordCount = doc ? (doc.getText().match(/[\p{L}\p{N}'’-]+/gu) ?? []).length : 0
  })

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
    await workspace.createFile(dir, name, `# ${clean.split('/').pop()}\n\n`)
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

  /** Boot a registered vault; failures land on the manager, never a dead end. */
  async function bootVault(entry: VaultEntry): Promise<void> {
    const gen = ++bootGen
    view = 'connecting'
    failure = null
    busy = false
    // Drop the previous vault's index BEFORE the next one fills it.
    nav.attach(null)
    try {
      const ws = await setupWorkspace({ ...(await configForSession(entry, userName())), index: nav.sink })
      if (gen !== bootGen) {
        ws.dispose() // cancelled or superseded while awaiting
        return
      }
      workspace?.dispose()
      workspace = ws
      nav.attach(ws)
      void restoreCustomTheme(ws)
      touchVault(entry.room, Date.now())
      refreshLists()
      view = 'workspace'
    } catch (err) {
      if (gen !== bootGen) return
      failure = { room: entry.room, message: err instanceof Error ? err.message : String(err) }
      view = 'manager'
    }
  }

  /** Memory URL contract (dev / Playwright L2) — bypasses the manager entirely. */
  async function bootMemory(cfg: Extract<typeof memConfig, { kind: 'memory' }>): Promise<void> {
    const gen = ++bootGen
    view = 'connecting'
    nav.attach(null)
    try {
      const ws = await setupWorkspace({ ...(await configForMemory(cfg)), index: nav.sink })
      if (gen !== bootGen) {
        ws.dispose()
        return
      }
      workspace = ws
      nav.attach(ws)
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
      busy = false
      await bootVault(entry)
    } catch (err) {
      failure = { room: null, message: err instanceof Error ? err.message : String(err) }
      busy = false
    }
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
      void workspace.createFile(op.dir) // auto-named untitled-N; rename after
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
      treeOp.type === 'unmount'
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
      ? scopedRollup(workspace.ui.files, workspace.ui.records, workspace.ui.mounts, workspace.ui.shared)
      : null
  )
  const selectedPath = $derived(workspace?.ui.selectedPath ?? null)
  const selectedDoc = $derived(workspace && selectedPath ? workspace.docForPath(selectedPath) : null)
  const selectedAwareness = $derived(
    workspace && selectedPath ? workspace.awarenessForPath(selectedPath) : null
  )
  const activeReview = $derived(workspace?.ui.reviews[0] ?? null)
  /** The open note's own record → pill, for the status bar (pure f(record)). */
  const noteStatus = $derived.by(() => {
    if (!workspace || !selectedPath) return null
    const guid = workspace.ui.files.find((f) => f.path === selectedPath)?.guid
    const record = guid ? workspace.ui.records[guid] : undefined
    return record ? pillStatus(record) : null
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
    onBack={() => (view = 'workspace')}
    onSettings={() => (settingsOpen = true)}
  />
{:else if view === 'connecting' || !workspace}
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
              rootShared={workspace.ui.shared}
              presenceByRoom={workspace.ui.presenceByRoom}
              reveal={revealDir}
              onSelect={(path) => openPath(path)}
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

      <main data-testid="editor-pane" class="flex min-h-0 min-w-0 flex-1 flex-col">
        <div class="min-h-0 flex-1 bg-ed-surface">
          {#if selectedDoc && selectedPath}
            {#key selectedPath}
              <MarkdownEditor
                doc={selectedDoc}
                awareness={selectedAwareness}
                user={workspace.user}
                dark={themeState.dark}
                extensions={editorExtensions}
                reveal={nav.pending.reveal}
              />
            {/key}
          {:else}
            <div class="flex h-full items-center justify-center text-sm text-base-content/70">
              {$LL.web.shell.select_a_file()}
            </div>
          {/if}
        </div>
        <StatusBar hasNote={selectedPath !== null} {wordCount} {noteStatus} />
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
              rootShared={workspace.ui.shared}
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

  {#if devtools}
    <DevtoolsPanel {workspace} />
  {/if}
{/if}

<Toaster />

{#if settingsOpen}
  <SettingsPanel
    readAppFile={workspace ? (p) => workspace!.readAppFile(p) : undefined}
    onClose={() => {
      settingsOpen = false
      refreshLists()
      devtools = debugForced || devtoolsEnabled()
    }}
  />
{/if}
