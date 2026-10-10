<script lang="ts">
  /**
   * The vault manager (shell-polish P4): two columns under one header — the
   * vaults you already have on the left (with the identity sent to peers at
   * its foot), the three ways to get another one on the right. One accent on
   * the page: the primary button that adds a vault.
   */
  import { HardDrive, MoreHorizontal } from '@lucide/svelte'
  import { melt } from '@melt-ui/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { StoredShare, VaultEntry } from '../config.js'
  import DropdownMenu from '../ui/DropdownMenu.svelte'
  import AddSharedFolderDialog from './AddSharedFolderDialog.svelte'
  import MenuItem from '../ui/MenuItem.svelte'
  import { CARD, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'

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
    /** The room open behind the manager, marked `aria-current` in the list. */
    currentRoom: string | null
    onOpenVault: (entry: VaultEntry) => void
    onRemoveVault: (room: string) => void
    onOpenFolder: (name: string) => void
    onCreateBrowserVault: (name: string, vaultName: string) => void
    onJoin: (name: string, link: string) => void
    /**
     * The vault open behind the manager, offered by *Add a shared folder* as
     * a destination beside "as its own vault" (sharing E4); null = none open.
     */
    joinInto?: { vaultName: string; dirs: string[]; join: (link: string, dest: string) => Promise<void> } | null
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
    currentRoom,
    onOpenVault,
    onRemoveVault,
    onOpenFolder,
    onCreateBrowserVault,
    onJoin,
    joinInto = null,
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
  // A `?share=` link arrives with the dialog already open on it.
  // svelte-ignore state_referenced_locally
  let joinOpen = $state(prefillLink !== '')
  let newVaultName = $state('')
  /** Room whose inline confirm row is showing (Remove is never one click). */
  let confirmRemove = $state<string | null>(null)

  // The identity sent to peers when the field is left blank: data, not copy.
  const displayName = $derived(name.trim() || 'Anonymous')
  const browserBlocked = $derived(!isTauri && !hasOpfs)

  const card = `${CARD} p-4`
  const chrome =
    'rounded px-3 py-1.5 text-sm text-base-content/70 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary'
  /** The page's one accent, on the button that adds a vault. */
  const primary =
    'rounded bg-primary px-4 py-2 text-sm font-medium text-primary-content hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50'
  const outline = `${OUTLINE_BUTTON} px-4 py-2 text-sm font-medium text-base-content/80 disabled:opacity-50`

  function sub(entry: VaultEntry): string {
    if (entry.vault.kind === 'tauri') return entry.vault.path
    if (entry.vault.kind === 'opfs') return t.browser_vault()
    return t.memory_vault()
  }
</script>

<main class="min-h-screen text-base-content">
  <div class="mx-auto grid max-w-4xl grid-cols-1 gap-8 px-8 py-12 md:grid-cols-[18rem_1fr]">
    <header class="flex items-start justify-between gap-4 md:col-span-2">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold">{$LL.common.app_name()}</h1>
        <p class="mt-1 text-sm text-base-content/70">{t.tagline()}</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        {#if canGoBack}
          <button data-testid="manager-back" onclick={onBack} class={chrome}>{t.back()}</button>
        {/if}
        <button data-testid="manager-settings" onclick={onSettings} class={chrome}>
          {t.settings()}
        </button>
      </div>
    </header>

    <section class="flex flex-col {CARD}">
      <div class="flex-1 p-4">
        <h2 class={HEADING}>{t.your_vaults()}</h2>
        {#if vaults.length === 0}
          <p class="mt-1.5 text-sm text-base-content/70">{t.no_vaults()}</p>
        {:else}
          <ul class="mt-1.5">
            {#each vaults as entry (entry.room)}
              <li>
                <div
                  class="flex items-center gap-1 rounded px-2 {failure?.room === entry.room
                    ? 'bg-error/10'
                    : 'hover:bg-base-200'}"
                >
                  <button
                    data-testid="open-vault:{entry.room}"
                    disabled={busy}
                    aria-current={canGoBack && entry.room === currentRoom ? 'true' : undefined}
                    onclick={() => onOpenVault(entry)}
                    class="min-w-0 flex-1 py-1.5 text-left leading-5 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  >
                    <span class="flex items-center gap-1.5">
                      <span class="truncate text-sm font-medium">{entry.name}</span>
                      {#if entry.relay}
                        <span
                          class="shrink-0 rounded bg-primary px-1.5 py-px text-[10px] font-medium text-primary-content"
                        >
                          {t.linked_badge()}
                        </span>
                      {/if}
                    </span>
                    <span class="block truncate font-ed-mono text-xs text-base-content/70">
                      {sub(entry)}
                    </span>
                  </button>
                  <DropdownMenu placement="bottom-end" testid="vault-menu:{entry.room}">
                    {#snippet trigger(attrs)}
                      <button
                        use:melt={attrs}
                        type="button"
                        aria-label={t.row_menu({ name: entry.name })}
                        data-testid="vault-more:{entry.room}"
                        class="shrink-0 rounded p-1 text-base-content/70 hover:bg-base-300 hover:text-base-content focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    {/snippet}
                    {#snippet children({ item })}
                      <MenuItem
                        {item}
                        testid="remove-vault:{entry.room}"
                        danger
                        onSelect={() => (confirmRemove = entry.room)}
                      >
                        {t.remove_item()}
                      </MenuItem>
                    {/snippet}
                  </DropdownMenu>
                </div>
                {#if confirmRemove === entry.room}
                  <!-- Named as a group so the two verbs below carry the vault
                       they act on without repeating it in their own labels. -->
                  <div
                    role="group"
                    aria-label={t.remove({ name: entry.name })}
                    class="mt-1 mb-2 rounded border border-base-300 px-2 py-2"
                  >
                    <p data-testid="remove-note:{entry.room}" class="text-xs text-base-content/70">
                      {entry.vault.kind === 'opfs' ? t.remove_note_opfs() : t.remove_note_disk()}
                    </p>
                    <div class="mt-2 flex gap-2">
                      <button
                        data-testid="remove-confirm:{entry.room}"
                        disabled={busy}
                        onclick={() => {
                          confirmRemove = null
                          onRemoveVault(entry.room)
                        }}
                        class="rounded bg-error px-2.5 py-1 text-xs font-medium text-error-content hover:bg-error/90 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                      >
                        {t.remove_confirm()}
                      </button>
                      <button
                        data-testid="remove-cancel:{entry.room}"
                        onclick={() => (confirmRemove = null)}
                        class="rounded px-2.5 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        {$LL.common.cancel()}
                      </button>
                    </div>
                  </div>
                {/if}
                {#if failure?.room === entry.room}
                  <p
                    role="alert"
                    data-testid="vault-error:{entry.room}"
                    class="mt-1 mb-2 px-2 text-xs text-error"
                  >
                    {t.vault_error({ message: failure.message })}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="border-t border-base-300 p-4">
        <label class="block">
          <span class={HEADING}>{t.your_name()}</span>
          <input
            data-testid="manager-name"
            bind:value={name}
            placeholder={t.name_placeholder()}
            aria-describedby="manager-name-hint"
            class="mt-1.5 w-full rounded border border-base-300 px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
        </label>
        <p id="manager-name-hint" class="mt-1.5 text-xs text-base-content/70">{t.name_hint()}</p>
      </div>
    </section>

    <div class="flex flex-col gap-4">
      {#if failure && !failure.room}
        <p role="alert" data-testid="manager-error" class="rounded bg-error/10 px-3 py-2 text-sm text-error">
          {failure.message}
        </p>
      {/if}

      {#if storageNote}
        <!-- A note, not an alert: the browser's refusal is nobody's fault. The
             outcome line is a live region, rendered before it changes. -->
        <section aria-labelledby="storage-note-title" data-testid="storage-note" class={card}>
          <h2 id="storage-note-title" class="flex items-center gap-2 {HEADING}">
            <HardDrive size={16} strokeWidth={1.75} aria-hidden="true" />
            {st.title()}
          </h2>
          {#if storageNote.outcome !== 'granted'}
            <p class="mt-1.5 text-xs text-base-content/70">{st.body()}</p>
            <p class="mt-1 text-xs text-base-content/70">{st.advice()}</p>
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
              <button type="button" data-testid="storage-keep" onclick={onKeepStorage} class={outline}>
                {st.ask()}
              </button>
            {/if}
            <button
              type="button"
              data-testid="storage-dismiss"
              onclick={onDismissStorage}
              class="rounded px-3 py-1.5 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
            >
              {st.dismiss()}
            </button>
          </div>
        </section>
      {/if}

      <section class={card}>
        <h2 class={HEADING}>{t.add_vault()}</h2>
        {#if isTauri}
          <p class="mt-1.5 text-xs text-base-content/70">{t.pick_folder()}</p>
          <button
            data-testid="open-folder"
            disabled={busy}
            onclick={() => onOpenFolder(displayName)}
            class="mt-3 {primary}"
          >
            {t.open_folder()}
          </button>
        {:else if browserBlocked}
          <p role="alert" class="mt-1.5 text-xs text-warning">{t.no_opfs()}</p>
        {:else}
          <p class="mt-1.5 text-xs text-base-content/70">{t.browser_vault_hint()}</p>
          <div class="mt-3 flex flex-wrap gap-2">
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
              class={primary}
            >
              {t.create_vault()}
            </button>
          </div>
        {/if}
      </section>

      {#if !browserBlocked}
        <!-- Device linking, before joining a folder share: this is the one that
             brings a WHOLE vault onto this device (device-link N2, A1). -->
        <section class={card}>
          <h2 class={HEADING}>{t.link_device()}</h2>
          <p class="mt-1.5 text-xs text-base-content/70">{t.link_device_hint()}</p>
          <button
            data-testid="open-link-device"
            disabled={busy}
            onclick={() => onLinkDevice(displayName)}
            class="mt-3 {outline}"
          >
            {t.link_device_open()}
          </button>
        </section>

        <section class={card}>
          <h2 class={HEADING}>{t.join_share()}</h2>
          <p class="mt-1.5 text-xs text-base-content/70">{t.join_hint()}</p>
          <button
            data-testid="join-share"
            disabled={busy}
            onclick={() => (joinOpen = true)}
            class="mt-3 {outline}"
          >
            {t.join()}
          </button>

          {#if shares.length > 0}
            <h3 class="mt-4 {HEADING}">{t.recent_shares()}</h3>
            <ul class="mt-1.5">
              {#each shares as share (share.room)}
                <li>
                  <button
                    onclick={() => onJoin(displayName, share.link)}
                    disabled={busy}
                    class="w-full truncate rounded px-2 py-1.5 text-left text-sm leading-5 text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                  >
                    {share.label || share.room}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}
    </div>
  </div>
</main>

{#if joinOpen}
  <AddSharedFolderDialog
    vaultName={joinInto?.vaultName ?? null}
    dirs={joinInto?.dirs ?? []}
    initialLink={prefillLink}
    initialWhere="own"
    {isTauri}
    onJoinIntoVault={joinInto?.join ?? null}
    onJoinAsVault={(l) => onJoin(displayName, l)}
    onClose={() => (joinOpen = false)}
  />
{/if}
