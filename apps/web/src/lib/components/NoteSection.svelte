<script lang="ts">
  /**
   * The rail's "This note" section (chrome-shaping Fork 2, shape C): where
   * the open note lives, whether that place is shared and by whom, who is
   * online THERE, and who holds access — stated as what the system knows.
   * There is no user identity until device-key tokens (parent D4): access is
   * links and the labels you gave them, never people, and the copy says so.
   */
  import { listShares, type RelayShare } from '../relay-admin.js'
  import { onlineIn, relayHost, shareStateFor, type MountLike } from '../share-status.js'
  import { decodeShareLink } from '../share-link.js'

  interface Props {
    /** The open note, or null. */
    path: string | null
    vaultName: string
    mounts: MountLike[]
    rootShared: boolean
    rootRoom: string
    presenceByRoom: Record<string, string[]>
    /** Everyone online anywhere in the workspace. */
    presenceAll: string[]
    /** The default relay (where carved shares were minted). */
    relayUrl: string
    /** Operator secret; '' means the access list cannot be fetched. */
    secret: string
    /** Bumped by the host when a share dialog closes, so the access list refreshes. */
    revision: number
    onManage: (mountPath: string) => void
    onShareFolder: (dir: string) => void
    onAddShare: (dir: string) => void
  }

  let {
    path,
    vaultName,
    mounts,
    rootShared,
    rootRoom,
    presenceByRoom,
    presenceAll,
    relayUrl,
    secret,
    revision,
    onManage,
    onShareFolder,
    onAddShare,
  }: Props = $props()

  const dir = $derived(path && path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
  const share = $derived(shareStateFor(path ?? '', mounts, rootShared, rootRoom))
  const host = $derived.by(() => {
    if (share.kind !== 'shared') return null
    if (share.link) {
      try {
        return relayHost(decodeShareLink(share.link).relay)
      } catch {
        /* an unreadable link: fall through to the default relay */
      }
    }
    return relayHost(relayUrl)
  })
  const online = $derived(share.kind === 'shared' ? onlineIn(presenceByRoom, share.room) : [])
  /** Sharing a folder needs a folder, an unshared vault, and no mount around it. */
  const canShareHere = $derived(
    share.kind === 'local' && dir !== '' && !rootShared
  )

  // ---- access list (carved mounts only: our relay, our secret) ----
  let tokens = $state<RelayShare[] | null>(null)
  let tokensError = $state('')
  const canListAccess = $derived(share.kind === 'shared' && share.provenance === 'carved' && secret !== '')

  $effect(() => {
    void revision
    const s = share
    if (!(s.kind === 'shared' && s.provenance === 'carved') || !secret) {
      tokens = null
      tokensError = ''
      return
    }
    let live = true
    tokens = null
    tokensError = ''
    listShares(relayUrl, secret, s.room).then(
      (list) => {
        if (live) tokens = list
      },
      (err: unknown) => {
        if (live) tokensError = err instanceof Error ? err.message : String(err)
      }
    )
    return () => {
      live = false
    }
  })
</script>

<div data-testid="note-section" class="flex flex-col gap-3 px-3 py-2 text-xs text-base-content/80">
  {#if !path}
    <p class="text-base-content/70">No note open.</p>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Vault</dt>
      <dd class="truncate">{vaultName}</dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Sharing</dt>
      <dd data-testid="share-state">
        {#if rootShared}Shared as a whole{:else if mounts.some((m) => m.provenance !== 'local')}
          {mounts.filter((m) => m.provenance !== 'local').length} shared
          {mounts.filter((m) => m.provenance !== 'local').length === 1 ? 'folder' : 'folders'}
        {:else}Local vault — nothing shared{/if}
      </dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Online</dt>
      <dd data-testid="presence">
        {#if presenceAll.length === 0}Only you{:else}{presenceAll.join(', ')}{/if}
      </dd>
    </dl>
  {:else}
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Folder</dt>
      <dd class="truncate font-ed-mono">{dir || '(vault root)'}</dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Sharing</dt>
      <dd data-testid="share-state">
        {#if share.kind === 'local'}
          Local — only on this device
        {:else if share.provenance === 'carved'}
          Shared by you{#if host} · {host}{/if}
        {:else if share.provenance === 'joined'}
          Shared with you{#if host} · {host}{/if}
        {:else}
          Shared as a whole{#if host} · {host}{/if}
        {/if}
      </dd>
      {#if share.kind === 'shared'}
        <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Online here</dt>
        <dd data-testid="presence">
          {#if online.length === 0}Only you{:else}{online.join(', ')}{/if}
        </dd>
        <dt class="font-semibold tracking-wide text-base-content/70 uppercase">Access</dt>
        <dd data-testid="share-access">
          {#if share.provenance === 'joined'}
            Managed by whoever shared it with you.
          {:else if share.provenance === 'root'}
            The whole vault's links — see Settings.
          {:else if !secret}
            Set the relay operator secret in Settings to list the links.
          {:else if tokensError}
            <span class="text-error">{tokensError}</span>
          {:else if tokens === null}
            Loading links…
          {:else if tokens.length === 0}
            No links — nobody else can open this yet.
          {:else}
            <ul class="space-y-0.5">
              {#each tokens as t (t.token)}
                <li class="flex items-center gap-1.5">
                  <span class="truncate">{t.label ?? `${t.token.slice(0, 8)}…`}</span>
                  {#if t.readOnly}
                    <span class="rounded border border-base-300 px-1 text-[10px] text-base-content/70">read-only</span>
                  {/if}
                </li>
              {/each}
            </ul>
            <p class="mt-1 text-[10px] text-base-content/70">
              {tokens.length} {tokens.length === 1 ? 'link' : 'links'} — anyone holding one can open this folder.
              Links, not people: there are no accounts yet.
            </p>
          {/if}
        </dd>
      {/if}
    </dl>

    <div class="flex flex-wrap gap-1.5">
      {#if share.kind === 'shared' && share.provenance !== 'root'}
        <button
          type="button"
          data-testid="note-manage-sharing"
          onclick={() => onManage(share.mountPath)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {share.provenance === 'carved' ? 'Manage sharing…' : 'Details…'}
        </button>
      {/if}
      {#if canShareHere}
        <button
          type="button"
          data-testid="note-share-folder"
          onclick={() => onShareFolder(dir)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          Share this folder…
        </button>
      {/if}
      {#if share.kind === 'local' && !rootShared}
        <button
          type="button"
          data-testid="note-add-share"
          onclick={() => onAddShare(dir)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          Add a shared folder here…
        </button>
      {/if}
    </div>
  {/if}
</div>
