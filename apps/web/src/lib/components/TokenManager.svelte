<script lang="ts">
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { listShares, mintShare, revokeShare, type RelayShare } from '../relay-admin.js'

  interface Props {
    relayUrl: string
    secret: string
    room: string
  }

  let { relayUrl, secret, room }: Props = $props()

  const t = $derived($LL.web.tokens)
  let tokens = $state<RelayShare[] | null>(null)
  let error = $state('')
  let busy = $state(false)
  let newLabel = $state('')
  let newReadOnly = $state(false)

  async function refresh(): Promise<void> {
    error = ''
    try {
      tokens = await listShares(relayUrl, secret, room)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    }
  }

  async function mint(): Promise<void> {
    busy = true
    error = ''
    try {
      await mintShare(relayUrl, secret, {
        folderGuid: room,
        ...(newLabel.trim() ? { label: newLabel.trim() } : {}),
        readOnly: newReadOnly,
      })
      newLabel = ''
      newReadOnly = false
      await refresh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  async function revoke(token: string): Promise<void> {
    busy = true
    error = ''
    try {
      await revokeShare(relayUrl, secret, token)
      await refresh()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      busy = false
    }
  }

  void refresh()
</script>

<div data-testid="token-manager" class="mt-2 border-t border-base-300 pt-2">
  <h3 class="text-[10px] font-semibold tracking-wide text-base-content/70 uppercase">{t.title()}</h3>
  {#if error}
    <p class="mt-1 text-xs text-error" data-testid="token-error">{error}</p>
  {/if}
  {#if tokens === null}
    <p class="mt-1 text-xs text-base-content/70">{t.loading()}</p>
  {:else if tokens.length === 0}
    <p class="mt-1 text-xs text-base-content/70">{t.none()}</p>
  {:else}
    <ul class="mt-1 space-y-1">
      {#each tokens as tok (tok.token)}
        <li class="flex items-center gap-2 text-xs" data-testid="token-row:{tok.label ?? tok.token.slice(0, 8)}">
          <span class="min-w-0 flex-1 truncate text-base-content/80" title={tok.token}>
            {tok.label ?? `${tok.token.slice(0, 8)}…`}
          </span>
          {#if tok.readOnly}
            <span class="rounded border border-base-300 px-1 text-[10px] text-base-content/70">{t.read_only()}</span>
          {/if}
          <button
            data-testid="revoke-token:{tok.label ?? tok.token.slice(0, 8)}"
            disabled={busy}
            onclick={() => void revoke(tok.token)}
            class="rounded px-1.5 py-0.5 text-error hover:bg-error/10 disabled:opacity-50"
          >
            {t.revoke()}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="mt-2 flex items-center gap-1">
    <input
      data-testid="new-token-label"
      bind:value={newLabel}
      placeholder={t.label_placeholder()}
      class="min-w-0 flex-1 rounded border border-base-300 px-2 py-1 text-xs focus:border-primary focus:outline-none"
    />
    <label class="flex items-center gap-1 text-[10px] text-base-content/70">
      <input type="checkbox" bind:checked={newReadOnly} data-testid="new-token-readonly" />
      {t.read_only()}
    </label>
    <button
      data-testid="mint-token"
      disabled={busy}
      onclick={() => void mint()}
      class="rounded bg-base-200 px-2 py-1 text-xs font-medium text-base-content/80 hover:bg-base-300 disabled:opacity-50"
    >
      {t.mint()}
    </button>
  </div>
  <p class="mt-1 text-[10px] text-base-content/70">{t.revoke_hint()}</p>
</div>
