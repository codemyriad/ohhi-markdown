<script lang="ts">
  import MarkdownEditor from '@editor/editor/src/MarkdownEditor.svelte'
  import BreakerDialog from './lib/components/BreakerDialog.svelte'
  import FileTree from './lib/components/FileTree.svelte'
  import ReviewModal from './lib/components/ReviewModal.svelte'
  import TreeOpDialog from './lib/components/TreeOpDialog.svelte'
  import SettingsPanel from './lib/components/SettingsPanel.svelte'
  import ShareDialog from './lib/components/ShareDialog.svelte'
  import SyncPill from './lib/components/SyncPill.svelte'
  import VaultManager from './lib/components/VaultManager.svelte'
  import VaultSwitcher from './lib/components/VaultSwitcher.svelte'
  import { configForMemory, configForSession, newFolderGuid } from './lib/boot.js'
  import {
    addShare,
    defaultRelay,
    deriveVaultName,
    getVault,
    lastVault,
    listVaults,
    loadShares,
    loadUser,
    removeVault,
    saveUser,
    setVaultRelay,
    touchVault,
    upsertVault,
    type VaultEntry,
  } from './lib/config.js'
  import { parseAppConfig } from './lib/params.js'
  import { hasOpfs, isTauri } from './lib/platform.js'
  import { dirPaths, type TreeOp } from './lib/tree-model.js'
  import { decodeShareLink } from './lib/share-link.js'
  import { pillStatus, worstStatus } from './lib/sync-record.svelte.js'
  import { setupWorkspace, type Workspace } from './lib/workspace.svelte.js'

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
  const prefillLink = url.get('share') ?? ''

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
    try {
      const ws = await setupWorkspace(await configForSession(entry, userName()))
      if (gen !== bootGen) {
        ws.dispose() // cancelled or superseded while awaiting
        return
      }
      workspace?.dispose()
      workspace = ws
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
    try {
      const ws = await setupWorkspace(await configForMemory(cfg))
      if (gen !== bootGen) {
        ws.dispose()
        return
      }
      workspace = ws
      view = 'workspace'
    } catch (err) {
      if (gen !== bootGen) return
      failure = { room: null, message: err instanceof Error ? err.message : String(err) }
      view = 'manager'
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

  function removeVaultEntry(room: string): void {
    removeVault(room)
    if (failure?.room === room) failure = null
    refreshLists()
  }

  // ---- in-workspace sharing ----
  function shareFolder(relay: string, token: string): void {
    if (!workspace) return
    try {
      const { link } = workspace.enableSharing({ url: relay, token })
      setVaultRelay(workspace.room, { url: relay, token })
      const label = getVault(workspace.room)?.name ?? 'This vault'
      addShare({ link, room: workspace.room, label })
      refreshLists()
    } catch (err) {
      workspace.ui.error = err instanceof Error ? err.message : String(err)
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
    treeOp = op
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
      await workspace.renamePath(op.path, value ? `${value}/${base}` : base)
    } else if (op.type === 'delete') {
      await workspace.deletePath(op.path)
    }
  }

  /** Narrowed props for the dialog (new-file never opens one). */
  const treeOpDialog = $derived.by(() => {
    if (!treeOp || treeOp.type === 'new-file') return null
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
    class="flex h-screen flex-col items-center justify-center gap-4 text-sm text-gray-500"
    data-testid="connecting"
  >
    <span>connecting…</span>
    {#if memConfig.kind !== 'memory'}
      <button
        data-testid="boot-cancel"
        onclick={cancelBoot}
        class="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-100"
      >
        Cancel
      </button>
    {/if}
  </main>
{:else}
  <div class="flex h-screen flex-col bg-gray-50 text-gray-900">
    <header class="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
      <VaultSwitcher
        current={{ room: workspace.room, name: currentVaultName }}
        {vaults}
        onSwitch={(entry) => void bootVault(entry)}
        onManage={() => {
          refreshLists()
          view = 'manager'
        }}
      />
      <span class="text-xs text-gray-400">{workspace.ui.shared ? 'shared' : 'local'}</span>
      <div data-testid="presence" class="flex items-center gap-2 text-xs text-gray-600">
        {#each workspace.ui.presence as name (name)}
          <span class="rounded-full bg-gray-100 px-2 py-0.5">{name}</span>
        {/each}
      </div>
      <div class="ml-auto flex items-center gap-3">
        {#if workspace.ui.error}
          <span class="max-w-sm truncate text-xs text-red-600" data-testid="workspace-error">
            {workspace.ui.error}
          </span>
        {/if}
        <ShareDialog
          shared={workspace.ui.shared}
          shareLink={workspace.ui.shareLink}
          defaultRelay={relayDefault}
          room={workspace.room}
          onShare={shareFolder}
        />
        <button
          data-testid="open-settings"
          onclick={() => (settingsOpen = true)}
          aria-label="Settings"
          class="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
        >
          ⚙
        </button>
        <SyncPill status={globalStatus} testid="sync-pill-global" label={globalStatus} />
      </div>
    </header>

    <div class="flex min-h-0 flex-1">
      <aside class="w-64 shrink-0 border-r border-gray-200 bg-white">
        <FileTree
          files={workspace.ui.files}
          records={workspace.ui.records}
          selected={selectedPath}
          onSelect={(path) => workspace?.select(path)}
          onOp={handleTreeOp}
        />
      </aside>

      <main data-testid="editor-pane" class="min-h-0 min-w-0 flex-1 bg-white">
        {#if selectedDoc && selectedPath}
          {#key selectedPath}
            <MarkdownEditor doc={selectedDoc} awareness={selectedAwareness} user={workspace.user} />
          {/key}
        {:else}
          <div class="flex h-full items-center justify-center text-sm text-gray-400">
            select a file to start editing
          </div>
        {/if}
      </main>
    </div>
  </div>

  {#if activeReview}
    {#key activeReview.guid}
      <ReviewModal
        review={activeReview}
        onResolve={(guid, mergedText) => void workspace?.resolveReview(guid, mergedText)}
      />
    {/key}
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
{/if}

{#if settingsOpen}
  <SettingsPanel
    onClose={() => {
      settingsOpen = false
      refreshLists()
    }}
  />
{/if}
