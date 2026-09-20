<script lang="ts">
  /**
   * The right rail and its four sections (chrome U2, U4, U5, W3). A section
   * is data, not markup: the `RailSection` rows below are what the rail
   * renders as icons and headers, and `children(id)` fills each body. Fold
   * state is `shell-layout`'s.
   */
  import { Bell, History, Link2, Users } from '@lucide/svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { Navigation } from '../navigation.svelte.js'
  import type { ShareActions } from '../share-actions.svelte.js'
  import type { ShellLayout } from '../shell-layout.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import ActivitySection from './ActivitySection.svelte'
  import HistorySection from './HistorySection.svelte'
  import LinksPanel from './LinksPanel.svelte'
  import NoteSection from './NoteSection.svelte'
  import RightRail, { type RailSection } from './RightRail.svelte'

  interface Props {
    workspace: Workspace
    nav: Navigation
    layout: ShellLayout
    sharing: ShareActions
    vaultName: string
    /** The relay new shares are minted on, and the operator secret if the user has one. */
    relayUrl: string
    secret: string
    devtools: boolean
    now: () => number
    onOpen: (path: string, opts?: { background?: boolean }) => void
    onCreateFromLink: (target: string) => void
    onDevtools: (on: boolean) => void
  }

  let {
    workspace,
    nav,
    layout,
    sharing,
    vaultName,
    relayUrl,
    secret,
    devtools,
    now,
    onOpen,
    onCreateFromLink,
    onDevtools,
  }: Props = $props()

  /** The focused pane's active path — what every section follows. */
  const selectedPath = $derived(workspace.ui.selectedPath ?? null)
  /** The open note's own sync record — History reads it. */
  const noteRecord = $derived.by(() => {
    if (!selectedPath) return null
    const guid = workspace.ui.files.find((f) => f.path === selectedPath)?.guid
    return (guid ? workspace.ui.records[guid] : undefined) ?? null
  })

  const sections = $derived<RailSection[]>([
    { id: 'links', label: $LL.web.rail.sections.links(), icon: Link2 },
    // The one place the presence union survives: as a count on the icon.
    { id: 'note', label: $LL.web.rail.sections.note(), icon: Users, badge: workspace.ui.presence.length || undefined },
    { id: 'activity', label: $LL.web.rail.sections.activity(), icon: Bell, badge: layout.unread || undefined },
    { id: 'history', label: $LL.web.rail.sections.history(), icon: History },
  ])
</script>

<RightRail
  {sections}
  open={layout.railOpen}
  folded={layout.railFolded}
  onOpenChange={(o) => (layout.railOpen = o)}
  onFoldChange={(id, f) => layout.foldSection(id, f)}
  onShowOnly={(id) => layout.showOnlySection(id)}
  onCollapse={() => (layout.railOpen = false)}
>
  {#snippet children(id)}
    {#if id === 'links'}
      <LinksPanel
        backlinks={nav.links.backlinks}
        outgoing={nav.links.outgoing}
        path={selectedPath}
        {onOpen}
        onCreate={onCreateFromLink}
      />
    {:else if id === 'note'}
      <NoteSection
        path={selectedPath}
        {vaultName}
        mounts={workspace.ui.mounts}
        rootLinked={workspace.ui.linked}
        rootRoom={workspace.room}
        presenceByRoom={workspace.ui.presenceByRoom}
        presenceAll={workspace.ui.presence}
        {relayUrl}
        {secret}
        revision={sharing.revision}
        onManage={(mountPath) => (sharing.folderSharePath = mountPath)}
        onShareFolder={(dir) => (sharing.folderSharePath = dir)}
        onAddShare={(dir) => (sharing.addShareOpen = { dir })}
        onAddLink={(mountPath) => (sharing.addLinkPath = mountPath)}
      />
    {:else if id === 'history'}
      <HistorySection
        path={selectedPath}
        load={(p) => workspace.fileHistory(p)}
        restore={(p, seq) => workspace.restorePreImage(p, seq)}
        written={noteRecord?.diskMatchesCrdt ?? true}
        {now}
      />
    {:else if id === 'activity'}
      <ActivitySection
        notices={workspace.ui.notices}
        {devtools}
        onOpenPath={onOpen}
        onClear={() => (workspace.ui.notices = [])}
        {onDevtools}
      />
    {/if}
  {/snippet}
</RightRail>
