<script lang="ts">
  import type { StoredShare } from '../config.js'

  interface Props {
    isTauri: boolean
    defaultUser: string
    shares: StoredShare[]
    prefillLink: string
    error: string
    busy: boolean
    onOpenFolder: (name: string) => void
    onJoin: (name: string, link: string) => void
  }

  let { isTauri, defaultUser, shares, prefillLink, error, busy, onOpenFolder, onJoin }: Props =
    $props()

  // Seeded once from the initial prop values; these fields are then user-owned.
  // svelte-ignore state_referenced_locally
  let name = $state(defaultUser || '')
  // svelte-ignore state_referenced_locally
  let link = $state(prefillLink || '')

  const displayName = $derived(name.trim() || 'Anonymous')
</script>

<main class="mx-auto max-w-xl px-6 py-16 text-gray-800">
  <h1 class="text-2xl font-semibold">Editor</h1>
  <p class="mt-2 text-sm text-gray-600">
    Collaborative markdown over a plain-text vault.
    {#if isTauri}
      Open a folder on disk, or join a folder someone shared with you.
    {:else}
      Join a folder someone shared with you — it's stored privately in your browser.
    {/if}
  </p>

  <label class="mt-8 block">
    <span class="text-xs font-semibold tracking-wide text-gray-500 uppercase">Your name</span>
    <input
      data-testid="landing-name"
      bind:value={name}
      placeholder="Anonymous"
      class="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
    />
  </label>

  {#if isTauri}
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-gray-900">Open a folder</h2>
      <p class="mt-1 text-xs text-gray-500">
        Pick a folder on disk. Your <span class="font-mono">.md</span> files stay the source of truth.
      </p>
      <button
        data-testid="open-folder"
        disabled={busy}
        onclick={() => onOpenFolder(displayName)}
        class="mt-3 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        Open folder…
      </button>
    </section>
  {/if}

  <section class="mt-8">
    <h2 class="text-sm font-semibold text-gray-900">Join a share</h2>
    <p class="mt-1 text-xs text-gray-500">Paste a share link someone sent you.</p>
    <textarea
      data-testid="join-link"
      bind:value={link}
      rows="2"
      placeholder="editor1:…"
      class="mt-2 w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs focus:border-blue-500 focus:outline-none"
    ></textarea>
    <button
      data-testid="join-share"
      disabled={busy || !link.trim()}
      onclick={() => onJoin(displayName, link.trim())}
      class="mt-2 rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-900 disabled:opacity-50"
    >
      Join
    </button>
  </section>

  {#if shares.length > 0}
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-gray-900">Recent shares</h2>
      <ul class="mt-2 space-y-1">
        {#each shares as share (share.room)}
          <li>
            <button
              onclick={() => onJoin(displayName, share.link)}
              disabled={busy}
              class="w-full truncate rounded px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {share.label || share.room}
            </button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if error}
    <p data-testid="landing-error" class="mt-6 text-sm text-red-600">{error}</p>
  {/if}
</main>
