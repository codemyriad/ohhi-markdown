<script lang="ts">
  import MarkdownEditor from '@editor/editor/src/MarkdownEditor.svelte'
  import FileTree from './lib/components/FileTree.svelte'
  import ReviewModal from './lib/components/ReviewModal.svelte'
  import SyncPill from './lib/components/SyncPill.svelte'
  import { parseAppConfig } from './lib/params.js'
  import { pillStatus, worstStatus } from './lib/sync-record.svelte.js'
  import { setupWorkspace, type Workspace } from './lib/workspace.svelte.js'

  const config = parseAppConfig(new URLSearchParams(location.search))

  let workspace = $state.raw<Workspace | null>(null)
  let bootError = $state('')

  // config comes from the URL and never changes, so boot once at init —
  // no $effect needed (the workspace lives as long as the page).
  if (config.kind === 'memory') {
    setupWorkspace(config)
      .then((ws) => {
        workspace = ws
      })
      .catch((err: unknown) => {
        bootError = err instanceof Error ? err.message : String(err)
      })
  }

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

{#if config.kind === 'landing'}
  <main class="mx-auto max-w-xl px-6 py-16 text-gray-800">
    <h1 class="text-2xl font-semibold">Editor — V1 dev shell</h1>
    <p class="mt-3 text-sm text-gray-600">
      Collaborative markdown over a vault. This shell is driven by URL params; the Tauri mode (real
      folders on disk) lands separately.
    </p>
    <h2 class="mt-8 text-sm font-semibold text-gray-900">Modes</h2>
    <dl class="mt-2 space-y-4 text-sm">
      <div>
        <dt class="font-mono text-xs text-gray-900">
          ?mode=memory&amp;role=seed&amp;relay=ws://localhost:PORT&amp;room=FOLDERGUID&amp;token=TOK&amp;user=Alice
        </dt>
        <dd class="mt-1 text-gray-600">
          In-memory vault pre-populated with demo notes, enrolled as the seeder, synced through the
          relay at <span class="font-mono">relay</span>.
        </dd>
      </div>
      <div>
        <dt class="font-mono text-xs text-gray-900">…&amp;role=join</dt>
        <dd class="mt-1 text-gray-600">
          Empty in-memory vault that pulls the room's state from the relay and materializes the
          files locally (single-seeder rule).
        </dd>
      </div>
    </dl>
  </main>
{:else if config.kind === 'error' || bootError}
  <main class="mx-auto max-w-xl px-6 py-16">
    <h1 class="text-xl font-semibold text-red-700">Cannot start</h1>
    <p class="mt-2 font-mono text-sm text-gray-700" data-testid="boot-error">
      {config.kind === 'error' ? config.message : bootError}
    </p>
  </main>
{:else if !workspace}
  <main class="flex h-screen items-center justify-center text-sm text-gray-500" data-testid="connecting">
    connecting…
  </main>
{:else}
  <div class="flex h-screen flex-col bg-gray-50 text-gray-900">
    <header class="flex items-center gap-4 border-b border-gray-200 bg-white px-4 py-2">
      <h1 class="text-sm font-semibold">Editor</h1>
      <span class="text-xs text-gray-400">{workspace.role === 'seed' ? 'seeder' : 'joiner'}</span>
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
