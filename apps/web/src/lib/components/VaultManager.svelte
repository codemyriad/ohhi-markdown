<script lang="ts">
  import { HardDrive } from '@lucide/svelte'
  import { LL } from '@editor/i18n/i18n-svelte'
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
    /** Open the "Link this device…" dialog (device-link N2, A1). */
    onLinkDevice: (name: string) => void
    onBack: () => void
    onSettings: () => void
    /** The browser-storage note, decided by App; null = hidden. `outcome` is the user's own ask. */
    storageNote: { canAsk: boolean; outcome: 'refused' | 'granted' | null } | null
    /** Must call `persist()` synchronously: Firefox wants the click's gesture. */
    onKeepStorage: () => void
    onDismissStorage: () => void
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
    onLinkDevice,
    onBack,
    onSettings,
    storageNote,
    onKeepStorage,
    onDismissStorage,
  }: Props = $props()

  const t = $derived($LL.web.manager)
  const st = $derived($LL.web.storage)

  // Seeded once from the initial prop values; these fields are then user-owned.
  // svelte-ignore state_referenced_locally
  let name = $state(defaultUser || '')
  // svelte-ignore state_referenced_locally
  let link = $state(prefillLink || '')
  let newVaultName = $state('')
  /** Room armed for remove confirmation (two-click). */
  let confirmRemove = $state<string | null>(null)

  // The identity sent to peers when the field is left blank: data, not copy.
  const displayName = $derived(name.trim() || 'Anonymous')
  const browserBlocked = $derived(!isTauri && !hasOpfs)

  function sub(entry: VaultEntry): string {
    if (entry.vault.kind === 'tauri') return entry.vault.path
    if (entry.vault.kind === 'opfs') return t.browser_vault()
    return t.memory_vault()
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
    <h1 class="text-2xl font-semibold">{$LL.common.app_name()}</h1>
    <div class="flex items-center gap-2">
      {#if canGoBack}
        <button
          data-testid="manager-back"
          onclick={onBack}
          class="rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
        >
          {t.back()}
        </button>
      {/if}
      <button
        data-testid="manager-settings"
        onclick={onSettings}
        class="rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200"
      >
        {t.settings()}
      </button>
    </div>
  </div>
  <p class="mt-2 text-sm text-base-content/70">{t.tagline()}</p>

  {#if failure && !failure.room}
    <p role="alert" data-testid="manager-error" class="mt-4 rounded bg-error/10 px-3 py-2 text-sm text-error">
      {failure.message}
    </p>
  {/if}

  <label class="mt-6 block">
    <span class="text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.your_name()}</span>
    <input
      data-testid="manager-name"
      bind:value={name}
      placeholder={t.name_placeholder()}
      class="mt-1 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
    />
  </label>

  {#if vaults.length > 0}
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-base-content">{t.your_vaults()}</h2>
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
                  {#if entry.relay}<span class="ml-1 text-xs font-normal text-primary">{t.linked_badge()}</span>{/if}
                </span>
                <span class="block truncate font-mono text-xs text-base-content/70">{sub(entry)}</span>
              </button>
              <button
                data-testid="remove-vault:{entry.room}"
                disabled={busy}
                onclick={() => remove(entry.room)}
                aria-label={t.remove({ name: entry.name })}
                class="shrink-0 rounded px-2 py-1 text-xs {confirmRemove === entry.room
                  ? 'bg-error text-error-content hover:bg-error/90'
                  : 'text-base-content/70 hover:bg-base-200 hover:text-base-content/80'}"
              >
                {confirmRemove === entry.room ? t.remove_confirm() : '✕'}
              </button>
            </div>
            {#if confirmRemove === entry.room}
              <p data-testid="remove-note:{entry.room}" class="mt-1 px-3 text-xs text-base-content/70">
                {entry.vault.kind === 'opfs' ? t.remove_note_opfs() : t.remove_note_disk()}
              </p>
            {/if}
            {#if failure?.room === entry.room}
              <p role="alert" data-testid="vault-error:{entry.room}" class="mt-1 px-3 text-xs text-error">
                {t.vault_error({ message: failure.message })}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if storageNote}
    <!-- A note, not an alert: the browser's refusal is nobody's fault. The
         outcome line is a live region, rendered before it changes. -->
    <section
      aria-labelledby="storage-note-title"
      data-testid="storage-note"
      class="mt-8 rounded border border-base-300 bg-base-200 px-4 py-3 text-base-content"
    >
      <h2 id="storage-note-title" class="flex items-center gap-2 text-sm font-semibold">
        <HardDrive class="size-4 shrink-0" aria-hidden="true" />
        {st.title()}
      </h2>
      {#if storageNote.outcome !== 'granted'}
        <p class="mt-1 text-xs">{st.body()}</p>
        <p class="mt-1 text-xs">{st.advice()}</p>
      {/if}
      <p role="status" data-testid="storage-note-outcome" class="text-xs {storageNote.outcome ? 'mt-2' : ''}">
        {storageNote.outcome === 'granted'
          ? st.granted()
          : storageNote.outcome === 'refused'
            ? st.refused()
            : ''}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        {#if storageNote.canAsk}
          <button
            type="button"
            data-testid="storage-keep"
            onclick={onKeepStorage}
            class="rounded border border-base-300 bg-base-100 px-3 py-1.5 text-xs font-medium text-base-content hover:bg-base-300"
          >
            {st.ask()}
          </button>
        {/if}
        <button
          type="button"
          data-testid="storage-dismiss"
          onclick={onDismissStorage}
          class="rounded px-3 py-1.5 text-xs text-base-content hover:bg-base-300"
        >
          {st.dismiss()}
        </button>
      </div>
    </section>
  {/if}

  <section class="mt-8">
    <h2 class="text-sm font-semibold text-base-content">{t.add_vault()}</h2>
    {#if isTauri}
      <p class="mt-1 text-xs text-base-content/70">{t.pick_folder()}</p>
      <button
        data-testid="open-folder"
        disabled={busy}
        onclick={() => onOpenFolder(displayName)}
        class="mt-3 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {t.open_folder()}
      </button>
    {:else if browserBlocked}
      <p role="alert" class="mt-1 text-xs text-warning">{t.no_opfs()}</p>
    {:else}
      <p class="mt-1 text-xs text-base-content/70">{t.browser_vault_hint()}</p>
      <div class="mt-3 flex gap-2">
        <input
          data-testid="new-vault-name"
          bind:value={newVaultName}
          placeholder={t.vault_name_placeholder()}
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
          {t.create_vault()}
        </button>
      </div>
    {/if}
  </section>

  {#if !browserBlocked}
    <!-- Device linking, before joining a folder share: this is the one that
         brings a WHOLE vault onto this device (device-link N2, A1). -->
    <section class="mt-8">
      <h2 class="text-sm font-semibold text-base-content">{t.link_device()}</h2>
      <p class="mt-1 text-xs text-base-content/70">{t.link_device_hint()}</p>
      <button
        data-testid="open-link-device"
        disabled={busy}
        onclick={() => onLinkDevice(displayName)}
        class="mt-3 rounded border border-base-300 px-4 py-2 text-sm font-medium text-base-content/80 hover:bg-base-200 disabled:opacity-50"
      >
        {t.link_device_open()}
      </button>
    </section>

    <section class="mt-8">
      <h2 class="text-sm font-semibold text-base-content">{t.join_share()}</h2>
      <p class="mt-1 text-xs text-base-content/70">{t.join_hint()}</p>
      <textarea
        data-testid="join-link"
        bind:value={link}
        rows="2"
        placeholder={t.link_placeholder()}
        class="mt-2 w-full rounded border border-base-300 px-3 py-2 font-mono text-xs focus:border-primary focus:outline-none"
      ></textarea>
      <button
        data-testid="join-share"
        disabled={busy || !link.trim()}
        onclick={() => onJoin(displayName, link.trim())}
        class="mt-2 rounded bg-neutral px-4 py-2 text-sm font-medium text-neutral-content hover:bg-neutral/90 disabled:opacity-50"
      >
        {t.join()}
      </button>

      {#if shares.length > 0}
        <h3 class="mt-4 text-xs font-semibold tracking-wide text-base-content/70 uppercase">{t.recent_shares()}</h3>
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
