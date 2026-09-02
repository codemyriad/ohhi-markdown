<script lang="ts">
  import type { MountInfo } from '../workspace.svelte.js'
  import TokenManager from './TokenManager.svelte'

  interface Props {
    path: string
    /** Non-null when the folder is already a shared mount. */
    mount: MountInfo | null
    relayUrl: string
    /** Operator secret from Settings ('' = minting unavailable). */
    secret: string
    /** Runs the carve; resolves to the copyable link. */
    onShare: () => Promise<string>
    onClose: () => void
  }

  let { path, mount, relayUrl, secret, onShare, onClose }: Props = $props()

  let busy = $state(false)
  let error = $state('')
  let carvedLink = $state<string | null>(null)
  let copied = $state(false)
  /** The mount prop updates reactively after a carve; local state bridges the gap. */
  const link = $derived(carvedLink ?? mount?.link ?? null)

  async function share(): Promise<void> {
    busy = true
    error = ''
    try {
      carvedLink = await onShare()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function copy(): Promise<void> {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      /* clipboard blocked — the field is selectable as a fallback */
    }
  }
</script>

<div
  role="dialog"
  aria-modal="true"
  aria-label="Share folder"
  data-testid="folder-share-dialog"
  class="fixed inset-0 z-20 flex items-center justify-center bg-black/30"
>
  <div class="w-96 rounded border border-gray-200 bg-white p-4 text-gray-800 shadow-xl">
    <h2 class="text-sm font-semibold">
      Share <span class="font-mono text-blue-900">{path}</span>
    </h2>

    {#if link || mount}
      <p class="mt-2 text-xs text-gray-600">
        This folder is shared — everything inside it syncs to anyone holding the link. The rest
        of the vault stays local.
      </p>
      {#if link}
        <div class="mt-2 flex items-center gap-1">
          <input
            readonly
            value={link}
            data-testid="folder-share-link"
            class="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 font-mono text-[11px] select-all"
          />
          <button
            data-testid="copy-folder-link"
            onclick={copy}
            class="rounded bg-green-100 px-2 py-1 text-xs font-medium text-green-800 hover:bg-green-200"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      {/if}
      {#if secret && mount}
        <TokenManager {relayUrl} {secret} room={mount.room} />
      {/if}
    {:else}
      <p class="mt-2 text-xs text-gray-600">
        Sharing carves this folder into its own synced space on
        <span class="font-mono">{relayUrl}</span>: everything inside syncs to anyone holding the
        link; everything outside stays local to this vault. No files are moved or changed.
      </p>
      {#if !secret}
        <p class="mt-2 text-xs text-amber-700" data-testid="folder-share-needs-secret">
          Set the relay operator secret in Settings to create shares in-app.
        </p>
      {/if}
      {#if error}
        <p class="mt-2 text-xs text-red-600" data-testid="folder-share-error">{error}</p>
      {/if}
      <button
        data-testid="confirm-share-folder"
        disabled={!secret || busy}
        onclick={() => void share()}
        class="mt-3 w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Sharing…' : 'Share this folder'}
      </button>
    {/if}

    <button
      data-testid="close-folder-share"
      onclick={onClose}
      class="mt-3 w-full rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100"
    >
      Close
    </button>
  </div>
</div>
