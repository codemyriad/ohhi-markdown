<script lang="ts">
  import type { StoredShare, VaultEntry } from '../config.js'

  interface Props {
    isTauri: boolean
    hasOpfs: boolean
    defaultUser: string
    vaults: VaultEntry[]
    shares: StoredShare[]
    prefillLink: string
    /** Boot failure to surface — attached to its vault row when room matches. */
    failure: { room: string | null; message: string } | null
    busy: boolean
    /** Shown when a workspace is open behind the manager (switcher route). */
    canGoBack: boolean
    onOpenVault: (entry: VaultEntry) => void
    onRemoveVault: (room: string) => void
    onOpenFolder: (name: string) => void
    onCreateBrowserVault: (name: string, vaultName: string) => void
    onJoin: (name: string, link: string) => void
    onBack: () => void
    onSettings: () => void
  }

  let {
    isTauri,
    hasOpfs,
    defaultUser,
    vaults,
    shares,
    prefillLink,
    failure,
    busy,
    canGoBack,
    onOpenVault,
    onRemoveVault,
    onOpenFolder,
    onCreateBrowserVault,
    onJoin,
    onBack,
    onSettings,
  }: Props = $props()

  // Seeded once from the initial prop values; these fields are then user-owned.
  // svelte-ignore state_referenced_locally
  let name = $state(defaultUser || '')
  // svelte-ignore state_referenced_locally
  let link = $state(prefillLink || '')
  let newVaultName = $state('')
  /** Room armed for remove confirmation (two-click). */
  let confirmRemove = $state<string | null>(null)

  const displayName = $derived(name.trim() || 'Anonymous')
  const browserBlocked = $derived(!isTauri && !hasOpfs)

  function sub(entry: VaultEntry): string {
    if (entry.vault.kind === 'tauri') return entry.vault.path
    if (entry.vault.kind === 'opfs') return 'browser vault'
    return 'memory'
  }

  function remove(room: string): void {
    if (confirmRemove === room) {
      confirmRemove = null
      onRemoveVault(room)
    } else {
      confirmRemove = room
    }
  }
</script>

<main class="mx-auto max-w-xl px-6 py-16 text-base-content">
  <div class="flex items-center justify-between">
    <h1 class="text-2xl font-semibold">Editor</h1>
    <div class="flex items-center gap-2">
      {#if canGoBack}
        <button
          data-testid="manager-back"
          onclick={onBack}
          class="rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
        >
          ← Back
        </button>
      {/if}
      <button
        data-testid="manager-settings"
        onclick={onSettings}
        class="rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
      >
        Settings
      </button>
    </div>
  </div>
  <p class="mt-2 text-sm text-base-content/70">
    Collaborative markdown over a plain-text vault. Files on disk stay the source of truth.
  </p>

  {#if failure && !failure.room}
    <p role="alert" data-testid="manager-error" class="mt-4 rounded bg-error/10 px-3 py-2 text-sm text-error">
      {failure.message}
    </p>
  {/if}

  <label class="mt-6 block">
    <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">Your name</span>
    <input
      data-testid="manager-name"
      bind:value={name}
      placeholder="Anonymous"
      class="mt-1 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
    />
  </label>

  {#if vaults.length > 0}
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-base-content">Your vaults</h2>
      <ul class="mt-2 space-y-1">
        {#each vaults as entry (entry.room)}
          <li>
            <div
              class="flex items-center gap-2 rounded border px-3 py-2 {failure?.room === entry.room
                ? 'border-error/30 bg-error/10'
                : 'border-base-300 hover:bg-base-200'}"
            >
              <button
                data-testid="open-vault:{entry.room}"
                disabled={busy}
                onclick={() => onOpenVault(entry)}
                class="min-w-0 flex-1 text-left disabled:opacity-50"
              >
                <span class="block truncate text-sm font-medium text-base-content">
                  {entry.name}
                  {#if entry.relay}<span class="ml-1 text-xs font-normal text-primary">shared</span>{/if}
                </span>
                <span class="block truncate font-mono text-xs text-base-content/70">{sub(entry)}</span>
              </button>
              <button
                data-testid="remove-vault:{entry.room}"
                disabled={busy}
                onclick={() => remove(entry.room)}
                aria-label="Remove {entry.name} from this list"
                class="shrink-0 rounded px-2 py-1 text-xs {confirmRemove === entry.room
                  ? 'bg-error text-error-content hover:bg-error/90'
                  : 'text-base-content/70 hover:bg-base-200 hover:text-base-content/80'}"
              >
                {confirmRemove === entry.room ? 'Remove?' : '✕'}
              </button>
            </div>
            {#if confirmRemove === entry.room}
              <p data-testid="remove-note:{entry.room}" class="mt-1 px-3 text-xs text-base-content/70">
                {#if entry.vault.kind === 'opfs'}
                  This browser vault's notes live only in this browser — removing it deletes
                  the notes AND all sync state, shares, and tokens.
                {:else}
                  Files on disk are never touched. Sync state, shares, and tokens for this
                  vault are deleted — reopening the folder starts fresh with new share links.
                {/if}
              </p>
            {/if}
            {#if failure?.room === entry.room}
              <p role="alert" data-testid="vault-error:{entry.room}" class="mt-1 px-3 text-xs text-error">
                {failure.message} — fix the folder, or remove this entry (files are untouched).
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="mt-8">
    <h2 class="text-sm font-semibold text-base-content">Add a vault</h2>
    {#if isTauri}
      <p class="mt-1 text-xs text-base-content/70">
        Pick a folder on disk (use the dialog's New Folder to create a fresh vault).
      </p>
      <button
        data-testid="open-folder"
        disabled={busy}
        onclick={() => onOpenFolder(displayName)}
        class="mt-3 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        Open folder as vault…
      </button>
    {:else if browserBlocked}
      <p role="alert" class="mt-1 text-xs text-warning">
        This browser doesn't support the private file storage (OPFS) Editor needs — try a recent
        Chrome, Edge, or Firefox.
      </p>
    {:else}
      <p class="mt-1 text-xs text-base-content/70">A new vault stored privately in this browser.</p>
      <div class="mt-3 flex gap-2">
        <input
          data-testid="new-vault-name"
          bind:value={newVaultName}
          placeholder="Vault name"
          class="w-48 rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <button
          data-testid="create-vault"
          disabled={busy || !newVaultName.trim()}
          onclick={() => {
            onCreateBrowserVault(displayName, newVaultName.trim())
            newVaultName = ''
          }}
          class="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
        >
          Create vault
        </button>
      </div>
    {/if}
  </section>

  {#if !browserBlocked}
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-base-content">Join a share</h2>
      <p class="mt-1 text-xs text-base-content/70">
        Paste a share link someone sent you — it opens as a new vault.
      </p>
      <textarea
        data-testid="join-link"
        bind:value={link}
        rows="2"
        placeholder="editor1:…"
        class="mt-2 w-full rounded border border-base-300 px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
      ></textarea>
      <button
        data-testid="join-share"
        disabled={busy || !link.trim()}
        onclick={() => onJoin(displayName, link.trim())}
        class="mt-2 rounded bg-neutral px-4 py-2 text-sm font-medium text-neutral-content hover:bg-neutral/90 disabled:opacity-50"
      >
        Join
      </button>

      {#if shares.length > 0}
        <h3 class="mt-4 text-xs font-semibold tracking-wide text-base-content/70 uppercase">Recent shares</h3>
        <ul class="mt-1 space-y-1">
          {#each shares as share (share.room)}
            <li>
              <button
                onclick={() => onJoin(displayName, share.link)}
                disabled={busy}
                class="w-full truncate rounded px-3 py-1.5 text-left text-sm text-base-content/80 hover:bg-base-200 disabled:opacity-50"
              >
                {share.label || share.room}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</main>
