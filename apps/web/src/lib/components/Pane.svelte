<script lang="ts">
  /**
   * One pane: strip, body, status bar (tab-groups B1–B3).
   *
   * The rule the whole memory story rests on lives here — **only the active
   * tab of a pane on screen gets a `MarkdownEditor`** (R2.1). A background
   * tab is a path and a resume point; a folded group's tabs are the same
   * thing; a zoomed-away pane renders nothing at all. So the live editor
   * count equals the pane count, never the tab count.
   *
   * The resume point (B2) is captured on `onhandle(null)` — the moment before
   * CM6 is destroyed, while the handle is still live — and restored on the
   * next mount, so switching tabs and coming back lands the caret where it
   * was. Undo survives too, because the `Y.UndoManager` belongs to the doc
   * (the facade owns it), not to the view.
   */
  import MarkdownEditor from '@editor/editor/src/MarkdownEditor.svelte'
  import type { MarkdownEditorHandle } from '@editor/editor'
  import { wikiLinkHost, type WikiLinkHost } from '@editor/editor-lang'
  import { LL } from '@editor/i18n/i18n-svelte'
  import { untrack, type Snippet } from 'svelte'
  import { activeTab, type Group, type Pane, type Tab } from '../panes.js'
  import { pillStatus } from '../sync-record.svelte.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import EmptyTab, { type PickerRow } from './EmptyTab.svelte'
  import StatusBar from './StatusBar.svelte'
  import TabStrip from './TabStrip.svelte'

  interface Props {
    pane: Pane
    focused: boolean
    panes: PaneShell
    workspace: Workspace
    dark: boolean
    /** The note's word count, re-read when the note's text changes. */
    wordsOf: (path: string) => number
    search: (query: string) => Promise<PickerRow[]>
    resolveLink: (target: string, from: string | undefined) => string | null
    createFromLink: (target: string) => void
    linkCandidates: () => string[]
    /** A caret reveal for the FOCUSED pane (a search result's Enter). */
    reveal: { offset: number } | null
    groupChip?: Snippet<[Group, Pane]>
    tabMenuGroupItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Tab]>
    moreMenuItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Pane]>
  }

  let {
    pane,
    focused,
    panes,
    workspace,
    dark,
    wordsOf,
    search,
    resolveLink,
    createFromLink,
    linkCandidates,
    reveal,
    groupChip,
    tabMenuGroupItems,
    moreMenuItems,
  }: Props = $props()

  const uid = $props.id()
  const index = $derived(panes.paneIndex(pane.id))
  const tab = $derived(activeTab(pane))
  const path = $derived(tab?.path ?? null)
  const doc = $derived(path ? workspace.docForPath(path) : null)
  const awareness = $derived(path ? workspace.awarenessForPath(path) : null)
  const undoManager = $derived(path ? workspace.undoManagerFor(path) : null)
  const zoomed = $derived(panes.layout.zoom === pane.id)

  /**
   * A wikilink resolves against THIS pane's note, not the app's one selection
   * — two panes on two notes must not resolve each other's relative links.
   *
   * Every read in here is UNTRACKED, and that is load-bearing. CM6 calls
   * `resolve` while it builds decorations, which happens inside the effect
   * that creates the view: a tracked read of `path` (or of the file list
   * behind `resolveLink`) would make the view's own lifecycle depend on the
   * pane tree, so any layout change would destroy and rebuild the editor —
   * and the resume point captured on the way out would commit another layout
   * change, which is an infinite loop. The facet keeps host behaviour out of
   * the props for the same reason; this keeps it out of the dependencies.
   */
  const linkHost: WikiLinkHost = {
    resolve: (target) => untrack(() => resolveLink(target, path ?? undefined)),
    // Following a link is the ONE in-place navigation (B5): it stays in this
    // tab and pushes that tab's history, which is what back/forward is for.
    open: (target) => untrack(() => panes.navigate(target, tab?.id)),
    create: (target) => createFromLink(target),
    candidates: () => untrack(() => linkCandidates()),
  }
  const extensions = [wikiLinkHost.of(linkHost)]

  const status = $derived.by(() => {
    if (!path) return null
    const guid = workspace.ui.files.find((f) => f.path === path)?.guid
    const record = guid ? workspace.ui.records[guid] : undefined
    return record ? pillStatus(record) : null
  })

  const wordCount = $derived(path ? wordsOf(path) : 0)

  const lead = $derived(
    `${$LL.web.panes.label({ n: index })} · ${$LL.web.panes.tab_count({ count: pane.tabs.length })}`
  )

  /**
   * The pane's box, registered with the shell: `neighbour` (which pane is
   * left of which) and the drag hit test are geometric, and the tree has no
   * idea how wide anything is.
   */
  let host = $state<HTMLElement>()
  $effect(() => {
    if (!host) return
    const id = pane.id
    panes.registerPane(id, host)
    return () => panes.registerPane(id, null)
  })

  /** The live handle, kept so `onhandle(null)` can still capture from it. */
  let handle: MarkdownEditorHandle | null = null

  /**
   * The same handle, offered to the shell on demand: a view reports its
   * resume point on teardown, which is one beat after `closeGroup` and
   * `closePane` have read the tab it belongs to.
   */
  $effect(() => {
    const id = pane.id
    panes.registerCapture(id, () => handle?.capture() ?? null)
    return () => panes.registerCapture(id, null)
  })

  /**
   * The view's lifecycle, from inside `MarkdownEditor`'s own creation effect —
   * so every read in here is UNTRACKED. A tracked read of `pane` would make
   * that effect depend on the pane tree: the view would be destroyed and
   * rebuilt on every layout change, and the resume point captured on the way
   * out would commit another one. (`restore` on the way in, `capture` on the
   * way out, while the handle is still live — tab-groups B2.)
   */
  function onHandle(tabId: string, next: MarkdownEditorHandle | null): void {
    untrack(() => {
      if (next) {
        handle = next
        const resume = pane.tabs.find((t) => t.id === tabId)
        if (resume?.cursor) next.restore({ cursor: resume.cursor, scroll: resume.scroll })
        return
      }
      if (handle) panes.setResume(tabId, handle.capture())
      handle = null
    })
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -- clicking
     anywhere in a pane focuses it, which is what every multiplexer does; the
     keyboard equivalent is the whole `workspace.focus-*` family -->
<section
  bind:this={host}
  data-pane-id={pane.id}
  data-testid="pane:{index}"
  aria-label={$LL.web.panes.label({ n: index })}
  onpointerdowncapture={() => panes.focusPane(pane.id)}
  class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ed-surface
    {focused && panes.mode ? 'outline-1 -outline-offset-1 outline-accent' : ''}"
>
  <TabStrip
    {pane}
    {focused}
    {panes}
    {uid}
    {groupChip}
    {tabMenuGroupItems}
    {moreMenuItems}
  />

  {#if tab}
    <div
      role="tabpanel"
      id="{uid}-panel-{tab.id}"
      aria-labelledby="{uid}-tab-{tab.id}"
      data-testid={focused ? 'editor-pane' : `editor-pane:${pane.id}`}
      class="min-h-0 flex-1 overflow-hidden bg-ed-surface"
    >
      {#if doc && path}
        {#key `${pane.id}:${path}`}
          {@const held = tab.id}
          <MarkdownEditor
            {doc}
            {awareness}
            {undoManager}
            user={workspace.user}
            {dark}
            {extensions}
            reveal={focused ? reveal : null}
            onhandle={(h) => onHandle(held, h)}
          />
        {/key}
      {:else}
        <EmptyTab
          {search}
          testid="empty-tab:{pane.id}"
          onPick={(picked) => panes.navigate(picked, tab.id)}
        />
      {/if}
    </div>
  {/if}

  <StatusBar
    hasNote={path !== null}
    {wordCount}
    noteStatus={status}
    {lead}
    {zoomed}
    testid={focused ? 'status-bar' : `pane-status:${pane.id}`}
    pillTestid={focused ? 'sync-pill-note' : `sync-pill-pane:${pane.id}`}
  />
</section>
