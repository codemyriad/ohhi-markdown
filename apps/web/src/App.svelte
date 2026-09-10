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
  import { dirPaths, type TreeOp } from './lib/tree-model.js'
  import { decodeShareLink } from './lib/share-link.js'
  import { pillStatus, worstStatus } from './lib/sync-record.svelte.js'
  import { setupWorkspace, type Workspace } from './lib/workspace.svelte.js'
  import { wikiLinkHost, type WikiLinkHost } from '@editor/editor-lang'
  import LinksPanel from './lib/components/LinksPanel.svelte'
  import Palette from './lib/components/Palette.svelte'
  import { createNavigation, defaultCommands } from './lib/navigation.svelte.js'
  import { NavHistory } from './lib/nav-history.js'
  import { touchPath } from './lib/recent.js'
  import { themePath, installUserTheme, themeState } from './lib/theme.svelte.js'
  import Toaster from './lib/ui/Toaster.svelte'

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
  let treeOpen = $state(true)
  let linksOpen = $state(true)
  /** Suppresses the history push while back/forward is doing the navigating. */
  let travelling = false
  /** Selection-aware word count for the status bar. */
  let wordCount = $state(0)
  nav.setLinksVisible(() => linksOpen)

  nav.registry.register(
    ...defaultCommands({
      quickOpen: () => nav.open('quick-open'),
      commandPalette: () => nav.open('command'),
      search: () => nav.open('search'),
      newNote: () => void workspace?.createFile(''),
      toggleSidebar: () => (treeOpen = !treeOpen),
      toggleLinks: () => (linksOpen = !linksOpen),
      settings: () => (settingsOpen = true),
      back: () => travel(navHistory.back()),
      forward: () => travel(navHistory.forward()),
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
      failure = { room: null, message: "That doesn't look like a valid share link." }
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
        failure = {
          room: null,
          message: `Vault forgotten, but some of its sync state could not be deleted (${msg}). The leftovers are inert — reopening the folder still starts fresh.`,
        }
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
  let addShareOpen = $state(false)
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
      if (workspace) workspace.ui.error = err instanceof Error ? err.message : String(err)
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
      if (workspace) workspace.ui.error = err instanceof Error ? err.message : String(err)
    }
  }

  async function confirmCrossMove(): Promise<void> {
    const mv = moveConfirm
    moveConfirm = null
    if (!mv || !workspace) return
    try {
      await workspace.movePath(mv.from, mv.to)
    } catch (err) {
      if (workspace) workspace.ui.error = err instanceof Error ? err.message : String(err)
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
    workspace ? (getVault(workspace.room)?.name ?? 'Vault') : 'Vault'
  )
  const globalStatus = $derived(
    workspace ? worstStatus(Object.values(workspace.ui.records).map(pillStatus)) : 'offline'
  )
  const selectedPath = $derived(workspace?.ui.selectedPath ?? null)
  const selectedDoc = $derived(workspace && selectedPath ? workspace.docForPath(selectedPath) : null)
  const selectedAwareness = $derived(
    workspace && selectedPath ? workspace.awarenessForPath(selectedPath) : null
  )
  const activeReview = $derived(workspace?.ui.reviews[0] ?? null)
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
    <span>connecting…</span>
    {#if memConfig.kind !== 'memory'}
      <button
        data-testid="boot-cancel"
        onclick={cancelBoot}
        class="rounded border border-base-300 px-3 py-1 text-xs text-base-content/70 hover:bg-base-200"
      >
        Cancel
      </button>
    {/if}
  </main>
{:else}
  <div class="flex h-screen flex-col bg-base-100 text-base-content">
    <header class="flex items-center gap-4 border-b border-base-300 bg-base-100 px-4 py-2">
      <!-- The page's one h1: the vault. U2's breadcrumb makes it visible. -->
      <h1 class="sr-only">{currentVaultName}</h1>
      <VaultSwitcher
        current={{ room: workspace.room, name: currentVaultName }}
        {vaults}
        onSwitch={(entry) => void bootVault(entry)}
        onManage={() => {
          refreshLists()
          view = 'manager'
        }}
      />
      <span class="text-xs text-base-content/70">{workspace.ui.shared ? 'shared' : 'local'}</span>
      <div data-testid="presence" class="flex items-center gap-2 text-xs text-base-content/70">
        {#each workspace.ui.presence as name (name)}
          <span class="rounded-full bg-base-200 px-2 py-0.5">{name}</span>
        {/each}
      </div>
      <div class="ml-auto flex items-center gap-3">
        {#if workspace.ui.error}
          <span class="max-w-sm truncate text-xs text-error" data-testid="workspace-error">
            {workspace.ui.error}
          </span>
        {/if}
        <button
          data-testid="open-quick-open"
          onclick={() => nav.open('quick-open')}
          title="Open a note ({nav.registry.binding('nav.quick-open')})"
          class="rounded bg-base-200 px-2.5 py-1 text-xs font-medium text-base-content/80 hover:bg-base-300"
        >
          Open…
        </button>
        <button
          data-testid="open-search"
          onclick={() => nav.open('search')}
          title="Search the vault ({nav.registry.binding('nav.search')})"
          class="rounded bg-base-200 px-2.5 py-1 text-xs font-medium text-base-content/80 hover:bg-base-300"
        >
          Search
        </button>
        <button
          data-testid="add-share"
          onclick={() => (addShareOpen = true)}
          class="rounded bg-base-200 px-2.5 py-1 text-xs font-medium text-base-content/80 hover:bg-base-300"
          title="Join a shared folder into this vault"
        >
          Add share
        </button>
        <button
          data-testid="open-settings"
          onclick={() => (settingsOpen = true)}
          aria-label="Settings"
          class="rounded px-2 py-1 text-sm text-base-content/70 hover:bg-base-200"
        >
          ⚙
        </button>
        {#if selectedPath}
          <span data-testid="word-count" class="text-xs tabular-nums text-base-content/70">
            {wordCount}
            {wordCount === 1 ? 'word' : 'words'}
          </span>
        {/if}
        <SyncPill status={globalStatus} testid="sync-pill-global" label={globalStatus} />
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      {#if treeOpen}
        <aside class="w-64 shrink-0 border-r border-base-300 bg-base-100">
          <FileTree
            files={workspace.ui.files}
            records={workspace.ui.records}
            selected={selectedPath}
            mounts={workspace.ui.mounts}
            rootShared={workspace.ui.shared}
            onSelect={(path) => openPath(path)}
            onOp={handleTreeOp}
          />
        </aside>
      {/if}

      <main data-testid="editor-pane" class="min-h-0 min-w-0 flex-1 bg-ed-surface">
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
            select a file to start editing
          </div>
        {/if}
      </main>

      {#if linksOpen}
        <LinksPanel
          backlinks={nav.links.backlinks}
          outgoing={nav.links.outgoing}
          path={selectedPath}
          onOpen={openPath}
          onCreate={(target) => void createFromLink(target)}
        />
      {/if}
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
      onJoin={(link, dest) => workspace!.addShareMount(link, dest)}
      onClose={() => (addShareOpen = false)}
    />
  {/if}

  {#if unshareConfirm}
    <ConfirmDialog
      title="Stop sharing '{unshareConfirm.path}'?"
      body="The folder and its files stay in this vault and become local notes. Other people keep the copies they already have, but nothing syncs anymore. Existing access tokens keep working until revoked."
      confirmLabel="Stop sharing"
      checkboxLabel={opSecret ? 'Also revoke all access tokens on the relay' : undefined}
      testid="unshare-confirm"
      onConfirm={(revoke) => void confirmUnshare(revoke)}
      onCancel={() => (unshareConfirm = null)}
    />
  {/if}

  {#if unmountConfirm}
    <ConfirmDialog
      title="Remove shared folder '{unmountConfirm}'?"
      body="This vault stops syncing the folder. Its files stay on disk and become plain local notes (delete the folder afterwards if you don't want them). Other people are unaffected."
      confirmLabel="Remove from vault"
      testid="unmount-confirm"
      onConfirm={() => void confirmUnmount()}
      onCancel={() => (unmountConfirm = null)}
    />
  {/if}

  {#if moveConfirm}
    <ConfirmDialog
      title="Move across a sharing boundary?"
      body={moveConfirm.leavingShared
        ? `Moving '${moveConfirm.from}' out of the shared folder removes it for everyone else, and it stops syncing. Its sync history starts over as a local file.`
        : `Moving '${moveConfirm.from}' into the shared folder makes it visible to everyone sharing it. Its sync history starts over in the shared space.`}
      confirmLabel="Move"
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
      onClose={() => (folderSharePath = null)}
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
