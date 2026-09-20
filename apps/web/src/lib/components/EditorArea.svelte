<script lang="ts">
  /**
   * The editor area (tab-groups B1, B5, W2): the pane tree, the mode bar
   * under it, and the one `PaneRender` context every pane reads — the index
   * queries, the word count, the link resolver, the empty tab's launcher and
   * the strip's three group seams. Built here, where `PaneTree` is rendered,
   * because a snippet has to live with the markup that renders it.
   */
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import type { GroupShell } from '../group-ui.svelte.js'
  import type { Navigation } from '../navigation.svelte.js'
  import { findPane, type Group, type Pane as PaneNode, type Tab as PaneTab } from '../panes.js'
  import { tagQuery } from '../read.svelte.js'
  import { recentPaths, touchPath } from '../recent.js'
  import { themeState } from '../theme.svelte.js'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import { textPaths, type Workspace } from '../workspace.svelte.js'
  import GroupChip from './GroupChip.svelte'
  import ModeBar from './ModeBar.svelte'
  import PaneTree, { type PaneRender } from './PaneTree.svelte'
  import StripGroupsMenu from './StripGroupsMenu.svelte'
  import TabGroupMenuItems from './TabGroupMenuItems.svelte'

  interface Props {
    workspace: Workspace
    panes: PaneShell
    groups: GroupShell
    nav: Navigation
    now: () => number
    /** Create the note an unresolved wikilink points at (`file-actions`). */
    onCreateFromLink: (target: string) => void
  }

  let { workspace, panes, groups, nav, now, onCreateFromLink }: Props = $props()

  /**
   * Everything a pane needs that is the same for all of them. The reveal goes
   * to the focused pane only: a search result lands where you were looking.
   */
  const ctx = $derived<PaneRender>({
    panes,
    workspace,
    dark: themeState.dark,
    /**
     * Selection-aware word count — `word-count` is the one Obsidian
     * status item Chris keeps. Read through a function so only the
     * status bar that shows it re-derives when the text changes.
     */
    wordsOf: (path) => {
      nav.revision // any content change, from any writer
      const doc = workspace.docForPath(path)
      return doc ? (doc.getText().match(/[\p{L}\p{N}'’-]+/gu) ?? []).length : 0
    },
    search: async (query) => {
      const page = await nav.index.quickOpen(query, { limit: 50 })
      return page.items.map((hit) => ({ path: hit.path, spans: hit.spans }))
    },
    /**
     * Recency is filtered against the file list rather than trusted: the
     * store survives renames and deletes made in another app, and a row
     * for a note that is gone opens nothing (P5).
     */
    recent: () => {
      const existing = new Set(textPaths(workspace.ui.files))
      return recentPaths(workspace.room).filter((p) => existing.has(p))
    },
    /**
     * *New note* fills THIS tab (`navigate`), never a new one beside it:
     * an empty tab is a slot waiting for a note.
     */
    newNote: (tabId) => {
      void (async () => {
        const created = await workspace.createFile('')
        if (!created) return
        panes.navigate(created, tabId)
        touchPath(workspace.room, created)
      })()
    },
    openQuick: () => nav.open('quick-open'),
    bindings: {
      newNote: nav.registry.binding('file.new'),
      openQuick: nav.registry.binding('nav.quick-open'),
    },
    resolveLink: (target, from) => nav.resolveLink(target, from),
    createFromLink: onCreateFromLink,
    linkCandidates: () => textPaths(workspace.ui.files),
    searchTag: (tag) => nav.openSearch(tagQuery(tag)),
    tags: () => nav.tags(),
    reveal: nav.pending.reveal,
    groupChip,
    tabMenuGroupItems,
    moreMenuItems,
  })
  /** Zoom mounts one pane and nothing else — that is the whole memory story. */
  const treeRoot = $derived(
    (panes.layout.zoom ? findPane(panes.layout, panes.layout.zoom) : null) ?? panes.layout.tree
  )
</script>

<main data-testid="editor-area" aria-label={$LL.web.panes.area()} class="flex min-h-0 min-w-0 flex-1 flex-col">
  <div class="flex min-h-0 min-w-0 flex-1 bg-base-200">
    <PaneTree node={treeRoot} {ctx} />
  </div>
  <ModeBar {panes} />
</main>

<!-- The strip's three W2 seams, filled once for every pane: B1 left them as
     snippet props so the group chrome could land without moving anything in
     `TabStrip`. -->
{#snippet groupChip(group: Group, pane: PaneNode)}
  <GroupChip {group} {pane} {panes} onManage={(id) => groups.openManage(id)} />
{/snippet}

{#snippet tabMenuGroupItems(attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }, tab: PaneTab)}
  <TabGroupMenuItems {attrs} {tab} {panes} {groups} />
{/snippet}

{#snippet moreMenuItems(attrs: { item: MenuItemAttrs; separator: MenuSeparatorAttrs }, pane: PaneNode)}
  <StripGroupsMenu {attrs} {pane} {panes} {groups} {now} />
{/snippet}
