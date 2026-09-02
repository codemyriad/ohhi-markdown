<script lang="ts">
  import TokenManager from './TokenManager.svelte'

  interface Props {
    shared: boolean
    shareLink: string | null
    /** The root room — token management scope once shared. */
    room: string
    relayUrl: string
    /** Operator secret from Settings ('' = minting unavailable). */
    secret: string
    /** One-click share: mints a token in-app and attaches the relay. */
    onCreate: () => Promise<void>
  }

  let { shared, shareLink, room, relayUrl, secret, onCreate }: Props = $props()

  let open = $state(false)
  let busy = $state(false)
  let error = $state('')
  let copied = $state(false)
  let manage = $state(false)

  async function create(): Promise<void> {
    busy = true
    error = ''
    try {
      await onCreate()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function copy(): Promise<void> {
    if (!shareLink) return
    try {
      await navigator.clipboard.writeText(shareLink)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch {
      /* clipboard blocked — the field is selectable as a fallback */
    }
  }
</script>

<div class="relative">
  {#if shared && shareLink}
    <span class="inline-flex items-center gap-1">
      <button
        data-testid="copy-share-link"
        onclick={copy}
        class="rounded bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-200"
        title={shareLink}
      >
        {copied ? 'Copied!' : 'Copy share link'}
      </button>
      {#if secret}
        <button
          data-testid="manage-tokens"
          onclick={() => (manage = !manage)}
          aria-expanded={manage}
          class="rounded px-1.5 py-1 text-xs text-gray-500 hover:bg-gray-100"
          title="Manage tokens"
        >
          ⋯
        </button>
      {/if}
    </span>
  {:else}
    <button
      data-testid="share-folder"
      onclick={() => (open = !open)}
      class="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
    >
      Share this vault
    </button>
  {/if}

  {#if open && !shared}
    <div
      class="absolute top-8 right-0 z-10 w-80 rounded border border-gray-200 bg-white p-3 text-gray-800 shadow-lg"
    >
      <p class="text-xs text-gray-600">
        Share the whole vault: everything in it syncs through
        <span class="font-mono">{relayUrl}</span> to anyone holding the link.
        To share just one folder, use the tree's <em>share</em> action instead.
      </p>
      {#if !secret}
        <p class="mt-2 text-xs text-amber-700" data-testid="share-needs-secret">
          Set the relay operator secret in Settings to create shares in-app.
        </p>
      {/if}
      {#if error}
        <p class="mt-2 text-xs text-red-600" data-testid="share-error">{error}</p>
      {/if}
      <button
        data-testid="create-share-link"
        disabled={!secret || busy}
        onclick={() => void create()}
        class="mt-3 w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create share link'}
      </button>
    </div>
  {/if}

  {#if manage && shared && secret}
    <div
      class="absolute top-8 right-0 z-10 w-80 rounded border border-gray-200 bg-white p-3 text-gray-800 shadow-lg"
    >
      <TokenManager {relayUrl} {secret} {room} />
    </div>
  {/if}
</div>
