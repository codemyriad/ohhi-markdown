<script lang="ts">
  import MarkdownEditor from '@editor/editor/src/MarkdownEditor.svelte'
  import FileTree from './lib/components/FileTree.svelte'
  import Landing from './lib/components/Landing.svelte'
  import ReviewModal from './lib/components/ReviewModal.svelte'
  import ShareDialog from './lib/components/ShareDialog.svelte'
  import SyncPill from './lib/components/SyncPill.svelte'
  import { configForMemory, configForSession, newFolderGuid } from './lib/boot.js'
  import {
    addShare,
    loadLastSession,
    loadShares,
    loadUser,
    saveLastSession,
    saveUser,
    type SessionDesc,
    type VaultSourceDesc,
  } from './lib/config.js'
  import { parseAppConfig } from './lib/params.js'
  import { isTauri } from './lib/platform.js'
  import { decodeShareLink } from './lib/share-link.js'
  import { pillStatus, worstStatus } from './lib/sync-record.svelte.js'
  import { setupWorkspace, type Workspace } from './lib/workspace.svelte.js'

  const DEFAULT_RELAY = 'ws://localhost:8787'

  const url = new URLSearchParams(location.search)
  const memConfig = parseAppConfig(url)

  let view = $state<'landing' | 'connecting' | 'workspace' | 'error'>('connecting')
  let workspace = $state.raw<Workspace | null>(null)
  let bootError = $state('')
  let landingError = $state('')
  let busy = $state(false)
  let shares = $state(loadShares())
  const prefillLink = url.get('share') ?? ''

  async function boot(configPromise: Promise<Parameters<typeof setupWorkspace>[0]>): Promise<void> {
    view = 'connecting'
    bootError = ''
    try {
      workspace = await setupWorkspace(await configPromise)
      view = 'workspace'
    } catch (err) {
      bootError = err instanceof Error ? err.message : String(err)
      view = 'error'
    }
  }

  /**
   * After onboarding, drop any bootstrap query params from the address bar so a
   * reload reopens via the persisted session (not the deep link) — and so a
   * share secret never lingers in the URL / history (R5).
   */
  function cleanUrl(): void {
    if (location.search) history.replaceState({}, '', location.pathname)
  }

  // ---- initial routing ----
  if (memConfig.kind === 'memory') {
    void boot(configForMemory(memConfig))
  } else if (memConfig.kind === 'error') {
    bootError = memConfig.message
    view = 'error'
  } else {
    const last = loadLastSession()
    if (last && !prefillLink) {
      void boot(configForSession(last, loadUser() ?? 'Anonymous'))
    } else {
      view = 'landing'
    }
  }

  // ---- landing actions ----
  async function openFolder(name: string): Promise<void> {
    saveUser(name)
    landingError = ''
    busy = true
    try {
      const { pickVaultFolder } = await import('./lib/adapters/tauri-vault-adapter.js')
      const path = await pickVaultFolder()
      if (!path) {
        busy = false
        return
      }
      const desc: SessionDesc = { vault: { kind: 'tauri', path }, room: newFolderGuid() }
      saveLastSession(desc)
      cleanUrl()
      await boot(configForSession(desc, name))
    } catch (err) {
      landingError = err instanceof Error ? err.message : String(err)
      busy = false
    }
  }

  async function joinShare(name: string, link: string): Promise<void> {
    saveUser(name)
    landingError = ''
    busy = true
    let target: ReturnType<typeof decodeShareLink>
    try {
      target = decodeShareLink(link)
    } catch {
      landingError = "That doesn't look like a valid share link."
      busy = false
      return
    }
    try {
      let vault: VaultSourceDesc
      if (isTauri()) {
        const { pickVaultFolder } = await import('./lib/adapters/tauri-vault-adapter.js')
        const path = await pickVaultFolder()
        if (!path) {
          busy = false
          return
        }
        vault = { kind: 'tauri', path }
      } else {
        vault = { kind: 'opfs', id: target.room }
      }
      const desc: SessionDesc = {
        vault,
        room: target.room,
        relay: { url: target.relay, token: target.token },
        firstJoin: true,
      }
      saveLastSession(desc)
      addShare({ link, room: target.room, label: name })
      shares = loadShares()
      cleanUrl()
      await boot(configForSession(desc, name))
    } catch (err) {
      landingError = err instanceof Error ? err.message : String(err)
      busy = false
    }
  }

  // ---- in-workspace sharing ----
  function shareFolder(relay: string, token: string): void {
    if (!workspace) return
    try {
      const { link } = workspace.enableSharing({ url: relay, token })
      const last = loadLastSession()
      if (last) saveLastSession({ ...last, relay: { url: relay, token } })
      addShare({ link, room: workspace.room, label: workspace.user.name })
      shares = loadShares()
    } catch (err) {
      workspace.ui.error = err instanceof Error ? err.message : String(err)
    }
  }

  // ---- workspace-derived view state ----
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

{#if view === 'landing'}
  <Landing
    isTauri={isTauri()}
    defaultUser={loadUser() ?? ''}
    {shares}
    {prefillLink}
    error={landingError}
    {busy}
    onOpenFolder={openFolder}
    onJoin={joinShare}
  />
{:else if view === 'error'}
  <main class="mx-auto max-w-xl px-6 py-16">
    <h1 class="text-xl font-semibold text-red-700">Cannot start</h1>
    <p class="mt-2 font-mono text-sm text-gray-700" data-testid="boot-error">{bootError}</p>
  </main>
{:else if view === 'connecting' || !workspace}
  <main
    class="flex h-screen items-center justify-center text-sm text-gray-500"
    data-testid="connecting"
  >
    connecting…
  </main>
{:else}
  <div class="flex h-screen flex-col bg-gray-50 text-gray-900">
    <header class="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
      <h1 class="text-sm font-semibold">Editor</h1>
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
          defaultRelay={DEFAULT_RELAY}
          room={workspace.room}
          onShare={shareFolder}
        />
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
          onNewFile={() => void workspace?.createFile()}
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
{/if}
