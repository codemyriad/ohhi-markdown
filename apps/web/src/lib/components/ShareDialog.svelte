<script lang="ts">
  interface Props {
    shared: boolean
    shareLink: string | null
    defaultRelay: string
    /** This vault's folder GUID — needed to mint a token on the relay. */
    room: string
    onShare: (relay: string, token: string) => void
  }

  let { shared, shareLink, defaultRelay, room, onShare }: Props = $props()

  let open = $state(false)
  // Seeded once from the initial prop; then user-owned.
  // svelte-ignore state_referenced_locally
  let relay = $state(defaultRelay)
  let token = $state('')
  let copied = $state(false)

  function submit(): void {
    if (!relay.trim() || !token.trim()) return
    onShare(relay.trim(), token.trim())
    open = false
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
    <button
      data-testid="copy-share-link"
      onclick={copy}
      class="rounded bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 hover:bg-green-200"
      title={shareLink}
    >
      {copied ? 'Copied!' : 'Copy share link'}
    </button>
  {:else}
    <button
      data-testid="share-folder"
      onclick={() => (open = !open)}
      class="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
    >
      Share this folder
    </button>
  {/if}

  {#if open && !shared}
    <div
      class="absolute top-8 right-0 z-10 w-80 rounded border border-gray-200 bg-white p-3 text-gray-800 shadow-lg"
    >
      <p class="text-xs text-gray-600">
        Mint a token on the relay first:
        <code
          class="block rounded bg-gray-100 px-1.5 py-1 text-[11px] break-all select-all"
          data-testid="share-guid-cmd"
          >cd apps/relay && node --experimental-strip-types src/cli.ts share-add {room}</code
        >
        then paste the relay URL and the token it prints here.
      </p>
      <label class="mt-2 block">
        <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">Relay</span>
        <input
          data-testid="share-relay"
          bind:value={relay}
          class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
        />
      </label>
      <label class="mt-2 block">
        <span class="text-[10px] font-semibold tracking-wide text-gray-500 uppercase">Token</span>
        <input
          data-testid="share-token"
          bind:value={token}
          class="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
        />
      </label>
      <button
        data-testid="create-share-link"
        disabled={!relay.trim() || !token.trim()}
        onclick={submit}
        class="mt-3 w-full rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Create share link
      </button>
    </div>
  {/if}
</div>
