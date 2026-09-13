<script lang="ts">
  /**
   * "Link a device" (device-link-shaping A1, slice N2) — the OWNER's side.
   *
   * Deliberately not a mode of `FolderShareDialog`: a folder share is a thing
   * you give to other people, one folder at a time, and it can be read-only.
   * A device link is a full-access key to the whole vault for one person's own
   * devices (R5), so the R5 sentence sits beside the copy button, and there is
   * no read-only checkbox to suggest otherwise.
   *
   * Creating the link is also what PROMOTES the root mount to the relay — the
   * one place that happens (`Workspace.linkDevice`). Everything else here is
   * reading: which device links exist on the relay, and revoking one.
   */
  import { z } from 'zod'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { listShares, revokeShare, type RelayShare } from '../relay-admin.js'
  import { createForm } from '../ui/form.svelte.js'
  import Description from '../ui/Description.svelte'
  import Dialog from '../ui/Dialog.svelte'
  import Field from '../ui/Field.svelte'
  import FieldErrors from '../ui/FieldErrors.svelte'
  import TextControl from '../ui/TextControl.svelte'

  interface Props {
    vaultName: string
    /** The vault's ROOT room: device links belong to it and nothing else. */
    room: string
    relayUrl: string
    /** Operator secret from Settings ('' = the relay will not mint for us). */
    secret: string
    /** Mints the token, attaches the root, resolves to the copyable link. */
    onCreate: (label: string) => Promise<string>
    onClose: () => void
  }

  let { vaultName, room, relayUrl, secret, onCreate, onClose }: Props = $props()

  const t = $derived($LL.web.device_link)

  const form = createForm(z.object({ label: z.string().trim() }), { label: '' })

  let link = $state<string | null>(null)
  let copied = $state(false)
  let tokens = $state<RelayShare[] | null>(null)
  let tokensError = $state('')
  let revoking = $state(false)

  async function refresh(): Promise<void> {
    if (!secret) return
    tokensError = ''
    try {
      // The relay lists every token for the room; only the device-kind ones
      // are this dialog's business (a folder token for the ROOT room cannot
      // exist today, but filtering says what we mean).
      tokens = (await listShares(relayUrl, secret, room)).filter((s) => s.kind === 'device')
    } catch (err) {
      tokensError = err instanceof Error ? err.message : String(err)
    }
  }

  async function create(): Promise<void> {
    await form.submit(async ({ label }) => {
      link = await onCreate(label)
      copied = false
      await refresh()
    })
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

  async function revoke(token: string): Promise<void> {
    revoking = true
    try {
      await revokeShare(relayUrl, secret, token)
      await refresh()
    } catch (err) {
      tokensError = err instanceof Error ? err.message : String(err)
    } finally {
      revoking = false
    }
  }

  void refresh()
</script>

<Dialog title={t.title()} description={t.description()} testid="device-link-dialog" {onClose}>
  <div class="space-y-3">
    <p class="text-xs text-base-content/70">{vaultName}</p>

    {#if !secret}
      <p role="alert" data-testid="device-link-needs-secret" class="text-xs text-warning">
        {t.needs_secret()}
      </p>
    {:else}
      <form
        class="space-y-3"
        novalidate
        onsubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <Field name="label" errors={form.errorsFor('label')}>
          <TextControl
            label={t.label()}
            bind:value={form.data.label}
            onblur={() => form.touch('label')}
            placeholder={t.label_placeholder()}
            testid="device-link-label"
          />
          <Description>{t.section_help()}</Description>
          <FieldErrors />
        </Field>

        {#if form.formError}
          <p class="text-xs text-error" role="alert" data-testid="device-link-error">{form.formError}</p>
        {/if}

        <button
          type="submit"
          data-testid="create-device-link"
          disabled={form.busy}
          class="w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
        >
          {form.busy ? t.creating() : t.create()}
        </button>
      </form>
    {/if}

    {#if link}
      <div class="space-y-1.5 rounded border border-warning/40 bg-warning/10 px-3 py-2">
        <div class="flex items-center gap-1">
          <input
            readonly
            value={link}
            aria-label={t.link()}
            data-testid="device-link-value"
            class="min-w-0 flex-1 rounded border border-base-300 bg-base-100 px-2 py-1 font-ed-mono text-[11px] select-all"
          />
          <button
            type="button"
            data-testid="copy-device-link"
            onclick={() => void copy()}
            class="shrink-0 rounded bg-base-200 px-2 py-1 text-xs font-medium text-base-content hover:bg-base-300"
          >
            {copied ? t.copied() : t.copy()}
          </button>
        </div>
        <!-- R5, at the point of copying: this is a key to everything. -->
        <p data-testid="device-link-warning" class="text-xs text-base-content">
          {t.full_access_warning()}
        </p>
        <p class="text-xs text-base-content/70">{t.next_step()}</p>
      </div>
    {/if}

    {#if secret}
      <section class="border-t border-base-300 pt-2">
        <h3 class="text-[10px] font-semibold tracking-wide text-base-content/70 uppercase">
          {t.links_title()}
        </h3>
        {#if tokensError}
          <p role="alert" data-testid="device-link-list-error" class="mt-1 text-xs text-error">{tokensError}</p>
        {:else if tokens === null}
          <p class="mt-1 text-xs text-base-content/70">{t.links_loading()}</p>
        {:else if tokens.length === 0}
          <p class="mt-1 text-xs text-base-content/70">{t.links_none()}</p>
        {:else}
          <ul class="mt-1 space-y-1" data-testid="device-link-list">
            {#each tokens as tok (tok.token)}
              <li class="flex items-center gap-2 text-xs">
                <span class="min-w-0 flex-1 truncate text-base-content/80">
                  {tok.label ?? t.unnamed()}
                </span>
                <button
                  type="button"
                  data-testid="revoke-device-link:{tok.token.slice(0, 8)}"
                  aria-label={t.revoke_device({ label: tok.label ?? t.unnamed() })}
                  disabled={revoking}
                  onclick={() => void revoke(tok.token)}
                  class="rounded px-1.5 py-0.5 text-error hover:bg-error/10 disabled:opacity-50"
                >
                  {t.revoke()}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
        <p class="mt-1 text-[10px] text-base-content/70">{t.revoke_hint()}</p>
      </section>
    {/if}

    <button
      type="button"
      data-testid="close-device-link"
      onclick={onClose}
      class="w-full rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
    >
      {$LL.common.close()}
    </button>
  </div>
</Dialog>
