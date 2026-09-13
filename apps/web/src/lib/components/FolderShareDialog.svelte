<script lang="ts">
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { MountInfo } from '../workspace.svelte.js'
  import { escapeHtml } from '../html.js'
  import Dialog from '../ui/Dialog.svelte'
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

  const t = $derived($LL.web.share.folder)
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

<Dialog title={t.title({ path })} width="sm" testid="folder-share-dialog" {onClose}>
  <div>
    {#if link || mount}
      <p class="mt-2 text-xs text-base-content/70">{t.is_shared()}</p>
      {#if link}
        <div class="mt-2 flex items-center gap-1">
          <input
            readonly
            value={link}
            data-testid="folder-share-link"
            class="min-w-0 flex-1 rounded border border-base-300 px-2 py-1 font-mono text-[11px] select-all"
          />
          <button
            data-testid="copy-folder-link"
            onclick={copy}
            class="rounded bg-success/15 px-2 py-1 text-xs font-medium text-success hover:bg-success/25"
          >
            {copied ? t.copied() : t.copy()}
          </button>
        </div>
      {/if}
      {#if secret && mount}
        <TokenManager {relayUrl} {secret} room={mount.room} />
      {/if}
    {:else}
      <!-- The sentence carries inline markup, so it renders as html with the
           relay URL escaped and passed as an argument (the Edible pattern). -->
      <p class="mt-2 text-xs text-base-content/70">
        {@html t.carve_help({ relay: `<span class="font-mono">${escapeHtml(relayUrl)}</span>` })}
      </p>
      {#if !secret}
        <p class="mt-2 text-xs text-warning" data-testid="folder-share-needs-secret">
          {t.needs_secret()}
        </p>
      {/if}
      {#if error}
        <p class="mt-2 text-xs text-error" data-testid="folder-share-error">{error}</p>
      {/if}
      <button
        data-testid="confirm-share-folder"
        disabled={!secret || busy}
        onclick={() => void share()}
        class="mt-3 w-full rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-content hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? t.sharing() : t.share()}
      </button>
    {/if}

    <button
      data-testid="close-folder-share"
      onclick={onClose}
      class="mt-3 w-full rounded border border-base-300 px-3 py-1.5 text-xs text-base-content/70 hover:bg-base-200"
    >
      {$LL.common.close()}
    </button>
  </div>
</Dialog>
