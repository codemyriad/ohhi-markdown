<script lang="ts">
  /**
   * The rail's "This note" section (chrome-shaping Fork 2, shape C): where
   * the open note lives, whether that place is shared and by whom, who is
   * online THERE, and who holds access — stated as what the system knows.
   * There is no user identity until device-key tokens (parent D4): access is
   * links and the labels you gave them, never people, and the copy says so.
   */
  import { LL } from '@editor/i18n/i18n-svelte'
  import { listShares, type RelayShare } from '../relay-admin.js'
  import { mountTone, onlineIn, relayHost, shareStateFor, type MountLike } from '../share-status.js'
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
    /** Paste the link for a `needs-token` mount (device-link N1). */
    onAddLink: (mountPath: string) => void
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
    onAddLink,
  }: Props = $props()

  const t = $derived($LL.web.note)
  const mnt = $derived($LL.web.mounts)
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
  const sharedMountCount = $derived(mounts.filter((m) => m.provenance !== 'local').length)
  /** Only a mount with a relay has presence, access or anything to be in sync with. */
  const connected = $derived(share.kind === 'shared' && share.status === 'active')
  /**
   * "Shared by you · relay.example.com" — the state, with the host when known.
   *
   * A `needs-token` mount reads "Shared folder — link needed" and NEVER
   * "offline": it is not disconnected, it is unkeyed, and the files are all
   * here (spike S10 Q2). The transient adopt/absorb states say what they are
   * doing. An `adopted` mount is a share of this vault that arrived from
   * another of your devices, so it reads like a carve.
   */
  const shareLine = $derived.by(() => {
    if (share.kind === 'local') return t.local_device()
    if (share.status === 'needs-token') return mnt.rail_link_needed()
    if (share.status === 'adopting') return mnt.attaching()
    if (share.status === 'absorbing') return mnt.folding_back()
    const state =
      share.provenance === 'root'
        ? t.shared_whole()
        : mountTone(share.provenance) === 'yours'
          ? t.shared_by_you()
          : t.shared_with_you()
    return host ? t.with_host({ state, host }) : state
  })

  // ---- access list (carved mounts only: our relay, our secret) ----
  let tokens = $state<RelayShare[] | null>(null)
  let tokensError = $state('')
  /** Ours to manage: a carve, or a carve of ours adopted from another device. */
  const ownShare = $derived(
    share.kind === 'shared' && share.status === 'active' && mountTone(share.provenance) === 'yours' && share.provenance !== 'root'
  )

  $effect(() => {
    void revision
    const s = share
    if (!ownShare || s.kind !== 'shared' || !secret) {
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
    <p class="text-base-content/70">{t.no_note()}</p>
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.vault()}</dt>
      <dd class="truncate">{vaultName}</dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.sharing()}</dt>
      <dd data-testid="share-state">
        {#if rootShared}{t.shared_whole()}{:else if sharedMountCount > 0}
          {t.shared_folders({ count: sharedMountCount })}
        {:else}{t.local_nothing_shared()}{/if}
      </dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.online()}</dt>
      <dd data-testid="presence">
        {#if presenceAll.length === 0}{t.only_you()}{:else}{presenceAll.join(', ')}{/if}
      </dd>
    </dl>
  {:else}
    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.folder()}</dt>
      <dd class="truncate font-ed-mono">{dir || t.vault_root()}</dd>
      <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.sharing()}</dt>
      <dd data-testid="share-state">{shareLine}</dd>
      {#if share.kind === 'shared' && connected}
        <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.online_here()}</dt>
        <dd data-testid="presence">
          {#if online.length === 0}{t.only_you()}{:else}{online.join(', ')}{/if}
        </dd>
        <dt class="font-semibold tracking-wide text-base-content/70 uppercase">{t.access()}</dt>
        <dd data-testid="share-access">
          {#if !ownShare && share.provenance !== 'root'}
            {t.access_joined()}
          {:else if share.provenance === 'root'}
            {t.access_root()}
          {:else if !secret}
            {t.access_needs_secret()}
          {:else if tokensError}
            <span class="text-error">{tokensError}</span>
          {:else if tokens === null}
            {t.access_loading()}
          {:else if tokens.length === 0}
            {t.access_none()}
          {:else}
            <ul class="space-y-0.5">
              {#each tokens as tok (tok.token)}
                <li class="flex items-center gap-1.5">
                  <span class="truncate">{tok.label ?? `${tok.token.slice(0, 8)}…`}</span>
                  {#if tok.readOnly}
                    <span class="rounded border border-base-300 px-1 text-[10px] text-base-content/70">{t.read_only()}</span>
                  {/if}
                </li>
              {/each}
            </ul>
            <p class="mt-1 text-[10px] text-base-content/70">
              {t.access_count({ count: tokens.length })}
            </p>
          {/if}
        </dd>
      {/if}
    </dl>

    <div class="flex flex-wrap gap-1.5">
      {#if share.kind === 'shared' && share.status === 'needs-token'}
        <button
          type="button"
          data-testid="note-add-link"
          onclick={() => onAddLink(share.mountPath)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {mnt.add_link()}
        </button>
      {/if}
      {#if connected && share.kind === 'shared' && share.provenance !== 'root'}
        <button
          type="button"
          data-testid="note-manage-sharing"
          onclick={() => onManage(share.mountPath)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {ownShare ? t.manage_sharing() : t.details()}
        </button>
      {/if}
      {#if canShareHere}
        <button
          type="button"
          data-testid="note-share-folder"
          onclick={() => onShareFolder(dir)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t.share_folder()}
        </button>
      {/if}
      {#if share.kind === 'local' && !rootShared}
        <button
          type="button"
          data-testid="note-add-share"
          onclick={() => onAddShare(dir)}
          class="rounded border border-base-300 px-2 py-1 text-xs text-base-content/80 hover:bg-base-200 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {t.add_share_here()}
        </button>
      {/if}
    </div>
  {/if}
</div>
