<script lang="ts">
  /**
   * The vault manager inside Nextcloud (nextcloud-build decisions 2–4): what
   * `App.svelte` renders instead of `VaultManager` when the host is
   * Nextcloud. Your own vaults and the ones you opened before, from `GET
   * /api/vaults`; *Open* asks the server for a short-lived token and joins
   * the vault's room; *Open a folder from Files* enrols a folder by its
   * Nextcloud file id; *Remove from Oh Hi* (your own vaults only, after a
   * confirm) unenrols one. Nothing here mints share links, names a relay or
   * holds a secret — Nextcloud's own sharing and sign-in do that.
   *
   * State and verbs are `nextcloud/vaults.svelte.ts`; this only renders them.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { parseFileId, type NcMe, type NcVaultRow } from '../nextcloud/api.js'
  import { vaultName, type NcVaults } from '../nextcloud/vaults.svelte.js'
  import type { BootFailure } from '../session.svelte.js'
  import Description from '../ui/Description.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import { CARD, HEADING, OUTLINE_BUTTON } from '../ui/styles.js'
  import TextControl from '../ui/TextControl.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'

  interface Props {
    nc: NcVaults
    me: NcMe | null
    /** `/api/me` failed, in words. */
    meError?: string | null
    failure: BootFailure | null
    busy: boolean
    /** A vault is open behind this page: offer the way back. */
    canGoBack: boolean
    onBack: () => void
  }

  let { nc, me, meError = null, failure, busy, canGoBack, onBack }: Props = $props()

  const t = $derived($LL.web.nextcloud.manager)

  let fileIdText = $state('')
  let fileIdError = $state('')

  function submitFileId(): void {
    const id = parseFileId(fileIdText)
    if (id === null) {
      fileIdError = t.file_id_invalid()
      return
    }
    fileIdError = ''
    void nc.enrolAndOpen(id)
  }

  const button = `${OUTLINE_BUTTON} px-3 py-1.5 text-xs font-medium text-base-content disabled:opacity-60`
  const primary =
    'rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60'
</script>

{#snippet row(v: NcVaultRow, mine: boolean)}
  {@const name = vaultName(v)}
  <li class="flex items-center gap-3 px-3 py-2" data-testid="nc-vault:{v.id}">
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-base-content">{name}</p>
      <p class="truncate text-xs text-base-content/70">
        {mine ? v.ownerPath : t.owner({ owner: v.ownerUid })}
      </p>
    </div>
    {#if v.status !== 'active'}
      <span class="rounded border border-base-300 px-1.5 py-0.5 text-[11px] text-warning" data-testid="nc-vault-status:{v.id}">
        {v.reason === 'folder-gone' ? t.reasons['folder-gone']() : t.status[v.status]()}
      </span>
    {/if}
    {#if mine}
      <button
        type="button"
        class={button}
        disabled={busy}
        aria-label={t.remove_named({ name })}
        data-testid="nc-remove:{v.id}"
        onclick={() => nc.askRemove(v)}
      >
        {t.remove()}
      </button>
    {/if}
    <button
      type="button"
      class={button}
      disabled={busy}
      aria-label={t.open_named({ name })}
      data-testid="nc-open:{v.id}"
      onclick={() => void nc.open(v)}
    >
      {t.open()}
    </button>
  </li>
{/snippet}

<main class="min-h-screen bg-base-100 font-ed-ui text-base-content" data-testid="nc-vaults">
  <div class="mx-auto max-w-2xl space-y-6 px-4 py-8">
    <header class="flex items-start justify-between gap-4">
      <div>
        <h1 class="text-lg font-semibold">{t.heading()}</h1>
        {#if me}
          <p class="mt-1 text-xs text-base-content/70" data-testid="nc-me">{t.signed_in_as({ name: me.displayName })}</p>
        {/if}
      </div>
      {#if canGoBack}
        <button type="button" class={button} data-testid="manager-back" onclick={onBack}>{$LL.web.manager.back()}</button>
      {/if}
    </header>

    {#if meError}
      <p role="alert" class="text-sm text-error" data-testid="nc-me-error">
        {$LL.web.nextcloud.host.me_failed({ message: meError })}
      </p>
    {/if}
    {#if failure}
      <p role="alert" class="text-sm text-error" data-testid="nc-failure">{failure.message}</p>
    {/if}
    {#if nc.removeError}
      <p role="alert" class="text-sm text-error" data-testid="nc-remove-error">{t.remove_failed({ message: nc.removeError })}</p>
    {/if}

    <section aria-labelledby="nc-own-heading" class="space-y-2">
      <h2 id="nc-own-heading" class={HEADING}>{t.own()}</h2>
      {#if nc.loading}
        <p class="text-xs text-base-content/70" role="status">{t.loading()}</p>
      {:else if nc.listError}
        <p class="text-xs text-error" role="alert" data-testid="nc-list-error">{nc.listError}</p>
      {:else if nc.own.length === 0}
        <p class="text-xs text-base-content/70" data-testid="nc-own-empty">{t.empty_own()}</p>
      {:else}
        <ul class="{CARD} divide-y divide-base-300" data-testid="nc-own">
          {#each nc.own as v (v.id)}{@render row(v, true)}{/each}
        </ul>
      {/if}
    </section>

    <section aria-labelledby="nc-recent-heading" class="space-y-2">
      <h2 id="nc-recent-heading" class={HEADING}>{t.recent()}</h2>
      {#if !nc.loading && !nc.listError}
        {#if nc.recent.length === 0}
          <p class="text-xs text-base-content/70">{t.empty_recent()}</p>
        {:else}
          <ul class="{CARD} divide-y divide-base-300" data-testid="nc-recent">
            {#each nc.recent as v (v.id)}{@render row(v, false)}{/each}
          </ul>
        {/if}
      {/if}
    </section>

    <section aria-labelledby="nc-files-heading" class="space-y-2">
      <h2 id="nc-files-heading" class={HEADING}>{t.open_from_files()}</h2>
      <form
        class="flex items-start gap-2"
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          submitFileId()
        }}
      >
        <Field name="fileId" errors={fileIdError ? [fileIdError] : []} class="min-w-0 flex-1">
          <TextControl
            label={t.file_id_label()}
            bind:value={fileIdText}
            oninput={() => (fileIdError = '')}
            inputmode="numeric"
            mono
            testid="nc-file-id"
          />
          <Description>{t.file_id_hint()}</Description>
          <FieldErrors />
        </Field>
        <button type="submit" class="mt-5 {primary}" disabled={busy} data-testid="nc-open-from-files">
          {busy ? t.opening() : t.open_from_files()}
        </button>
      </form>
    </section>
  </div>
</main>

{#if nc.confirmFileId !== null}
  <ConfirmDialog
    title={t.enrol_title()}
    body={t.enrol_body()}
    confirmLabel={t.enrol_confirm()}
    testid="nc-enrol-confirm"
    onConfirm={() => void nc.confirmEnrol()}
    onCancel={() => nc.cancelEnrol()}
  />
{/if}

{#if nc.confirmRemove !== null}
  <ConfirmDialog
    title={t.remove_title({ name: vaultName(nc.confirmRemove) })}
    body={t.remove_body()}
    confirmLabel={t.remove_confirm()}
    danger
    testid="nc-remove-confirm"
    onConfirm={() => void nc.confirmRemoval()}
    onCancel={() => nc.cancelRemove()}
  />
{/if}
