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
        class="rounded bg-success/15 px-2.5 py-1 text-xs font-medium text-success hover:bg-success/25"
        title={shareLink}
      >
        {copied ? 'Copied!' : 'Copy share link'}
      </button>
      {#if secret}
        <button
          data-testid="manage-tokens"
          onclick={() => (manage = !manage)}
          aria-expanded={manage}
          class="rounded px-1.5 py-1 text-xs text-base-content/60 hover:bg-base-200"
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
      class="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-content hover:bg-primary/90"
    >
      Share this vault
    </button>
  {/if}

  {#if open && !shared}
    <div
      class="absolute top-8 right-0 z-10 w-80 rounded border border-base-300 bg-base-100 p-3 text-base-content shadow-lg"
    >
      <p class="text-xs text-base-content/70">
        Share the whole vault: everything in it syncs through
        <span class="font-mono">{relayUrl}</span> to anyone holding the link.
        To share just one folder, use the tree's <em>share</em> action instead.
      </p>
      {#if !secret}
        <p class="mt-2 text-xs text-warning" data-testid="share-needs-secret">
          Set the relay operator secret in Settings to create shares in-app.
        </p>
      {/if}
      {#if error}
        <p class="mt-2 text-xs text-error" data-testid="share-error">{error}</p>
      {/if}
      <button
        data-testid="create-share-link"
        disabled={!secret || busy}
        onclick={() => void create()}
        class="mt-3 w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? 'Creating…' : 'Create share link'}
      </button>
    </div>
  {/if}

  {#if manage && shared && secret}
    <div
      class="absolute top-8 right-0 z-10 w-80 rounded border border-base-300 bg-base-100 p-3 text-base-content shadow-lg"
    >
      <TokenManager {relayUrl} {secret} {room} />
    </div>
  {/if}
</div>
