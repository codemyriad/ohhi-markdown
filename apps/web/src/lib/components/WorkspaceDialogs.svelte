<script lang="ts">
  /**
   * Everything that pops up over an open vault for files and sharing (M3,
   * M4, M5, N1): the review modal, the share dialogs, the three confirms, the
   * tree-op dialog and the breaker. `share-actions` and `file-actions` own
   * which one is open and what its answer does; this only renders them.
   *
   * The device-link dialogs are NOT here: Settings opens them from the
   * manager too (shell-polish P4), so they sit outside the workspace branch.
   */
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { FileActions } from '../file-actions.svelte.js'
  import { isTauri } from '../platform.js'
  import type { Probe } from '../relay-check.js'
  import type { ShareActions } from '../share-actions.svelte.js'
  import { dirPaths } from '../tree-model.js'
  import type { Workspace } from '../workspace.svelte.js'
  import AddLinkDialog from './AddLinkDialog.svelte'
  import AddSharedFolderDialog from './AddSharedFolderDialog.svelte'
  import BreakerDialog from './BreakerDialog.svelte'
  import ConfirmDialog from './ConfirmDialog.svelte'
  import ReviewModal from './ReviewModal.svelte'
  import ShareSheet from './ShareSheet.svelte'
  import TreeOpDialog from './TreeOpDialog.svelte'

  interface Props {
    workspace: Workspace
    sharing: ShareActions
    fileOps: FileActions
    /** The relay new shares are minted on, and the operator secret if the user has one. */
    relayUrl: string
    secret: string
    /** The open vault's name, as *Add a shared folder* offers it as a destination. */
    vaultName: string
    /** The share sheet's first run: remember the relay and secret in Settings › Sync. */
    onRemember: (relay: string, secret: string) => void
    /** A relay is known (`relayKnown()`); false → the share sheet's relay card says none. */
    relayKnown?: boolean
    /** The saved display name, prefilling the share sheet's "Your name, shown to them" (Fork 5-A). */
    userName?: string
    /** Remember the name typed in the share sheet. */
    onSaveName?: (name: string) => void
    /** *Add a shared folder* → as its own vault: the manager's join. Rejects with the reason. */
    onJoinAsVault: (link: string) => Promise<void>
    /** *Add a shared folder*'s relay health check; tests hand in a fake (default: the network). */
    probe?: Probe
  }

  let {
    workspace,
    sharing,
    fileOps,
    relayUrl,
    secret,
    vaultName,
    onRemember,
    relayKnown = true,
    userName = '',
    onSaveName,
    onJoinAsVault,
    probe,
  }: Props = $props()

  const activeReview = $derived(workspace.ui.reviews[0] ?? null)
</script>

{#if activeReview}
  {#key activeReview.guid}
    <ReviewModal
      review={activeReview}
      onResolve={(guid, mergedText) => void workspace.resolveReview(guid, mergedText)}
      onVanished={(guid, action) => void workspace.resolveVanished(guid, action)}
    />
  {/key}
{/if}

{#if sharing.addShareOpen}
  <AddSharedFolderDialog
    {vaultName}
    dirs={dirPaths(workspace.ui.files)}
    initialLink={sharing.addShareOpen.link ?? ''}
    initialDest={sharing.addShareOpen.dest ?? (sharing.addShareOpen.dir ? `${sharing.addShareOpen.dir}/` : '')}
    initialError={sharing.addShareOpen.error ?? ''}
    onJoinIntoVault={(link, dest) => workspace.addShareMount(link, dest)}
    {onJoinAsVault}
    isTauri={isTauri()}
    onClose={() => (sharing.addShareOpen = null)}
    {probe}
  />
{/if}

{#if sharing.addLinkPath}
  <AddLinkDialog
    path={sharing.addLinkPath}
    room={sharing.addLinkMount?.room ?? ''}
    onAdd={(link) => sharing.addMountLink(sharing.addLinkPath!, link)}
    onClose={() => (sharing.addLinkPath = null)}
  />
{/if}

{#if sharing.unshareConfirm}
  <ConfirmDialog
    title={$LL.web.share.unshare.title({ path: sharing.unshareConfirm.path })}
    body={$LL.web.share.unshare.body()}
    confirmLabel={$LL.web.share.unshare.confirm()}
    checkboxLabel={secret ? $LL.web.share.unshare.revoke() : undefined}
    testid="unshare-confirm"
    onConfirm={(revoke) => void sharing.confirmUnshare(revoke)}
    onCancel={() => (sharing.unshareConfirm = null)}
  />
{/if}

{#if sharing.unmountConfirm}
  <ConfirmDialog
    title={$LL.web.share.unmount.title({ path: sharing.unmountConfirm })}
    body={$LL.web.share.unmount.body()}
    confirmLabel={$LL.web.share.unmount.confirm()}
    testid="unmount-confirm"
    onConfirm={() => void sharing.confirmUnmount()}
    onCancel={() => (sharing.unmountConfirm = null)}
  />
{/if}

{#if sharing.moveConfirm}
  <ConfirmDialog
    title={$LL.web.share.cross_move.title()}
    body={sharing.moveConfirm.leavingShared
      ? $LL.web.share.cross_move.leaving({ path: sharing.moveConfirm.from })
      : $LL.web.share.cross_move.entering({ path: sharing.moveConfirm.from })}
    confirmLabel={$LL.web.share.cross_move.confirm()}
    danger={sharing.moveConfirm.leavingShared}
    testid="cross-move-confirm"
    onConfirm={() => void sharing.confirmCrossMove()}
    onCancel={() => (sharing.moveConfirm = null)}
  />
{/if}

{#if fileOps.linksConfirm}
  <ConfirmDialog
    title={$LL.web.link_follow.confirm.title({ count: fileOps.linksConfirm.notes })}
    body={fileOps.linksConfirm.kind === 'rename'
      ? $LL.web.link_follow.confirm.rename_body({ name: fileOps.linksConfirm.name, count: fileOps.linksConfirm.notes })
      : $LL.web.link_follow.confirm.move_body({ name: fileOps.linksConfirm.name, count: fileOps.linksConfirm.notes })}
    confirmLabel={fileOps.linksConfirm.kind === 'rename'
      ? $LL.web.link_follow.confirm.rename()
      : $LL.web.link_follow.confirm.move()}
    testid="links-confirm"
    onConfirm={() => fileOps.confirmLinks()}
    onCancel={() => fileOps.cancelLinks()}
  />
{/if}

{#if fileOps.dialog}
  <TreeOpDialog
    mode={fileOps.dialog.mode}
    path={fileOps.dialog.path}
    kind={fileOps.dialog.kind}
    dirs={dirPaths(workspace.ui.files)}
    onConfirm={(v) => void fileOps.confirm(v)}
    onCancel={() => fileOps.cancel()}
  />
{/if}

{#if workspace.ui.breaker}
  <BreakerDialog
    paths={workspace.ui.breaker.paths}
    onConfirm={() => void workspace.confirmBreaker()}
    onDismiss={() => workspace.dismissBreaker()}
  />
{/if}

{#if sharing.folderSharePath}
  <ShareSheet
    path={sharing.folderSharePath}
    mount={sharing.folderShareMount}
    {relayUrl}
    {relayKnown}
    {secret}
    {userName}
    {onSaveName}
    onShare={() => sharing.carveFolderShare()}
    {onRemember}
    onStopSharing={() => {
      const path = sharing.folderSharePath
      sharing.folderSharePath = null
      sharing.touch()
      if (path) sharing.askUnshare(path)
    }}
    onClose={() => {
      sharing.folderSharePath = null
      sharing.touch()
    }}
  />
{/if}
