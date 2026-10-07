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
  import MarkdownEditor from '@ohhi/editor/src/MarkdownEditor.svelte'
  import { runFormat, type MarkdownEditorHandle } from '@ohhi/editor'
  import { readHost, toggleTask, wikiLinkHost, type WikiLinkHost } from '@ohhi/editor-lang'
  import { parseFrontmatter } from '@ohhi/frontmatter'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { mount, tick, unmount, untrack, type Snippet } from 'svelte'
  import { activeTab, panes as panesOf, type Group, type Pane, type Tab, type ViewMode } from '../panes.js'
  import { DENSE_CHROME, showsFocusEdge, showsStrip, showsSyncDot, type PaneChrome } from '../pane-chrome.js'
  import { pillTitle } from '../pill-status.js'
  import { openExternal, readLabels } from '../read.svelte.js'
  import { noteStatus } from '../readout-state.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import EmptyTab, { type PickerRow } from './EmptyTab.svelte'
  import { getViewShell, viewDef } from '../views.js'
  import InlineTitle from './InlineTitle.svelte'
  import StatusBar from './StatusBar.svelte'
  import SyncPill from './SyncPill.svelte'
  import TabStrip from './TabStrip.svelte'

  interface Props {
    pane: Pane
    focused: boolean
    panes: PaneShell
    workspace: Workspace
    dark: boolean
    /** The layout's `editor.typewriter`: keep the caret line centred while typing. */
    typewriter?: boolean
    /** The layout's `editor.inlineTitle` (P3): the note's name as an editable heading above its text. */
    inlineTitle?: boolean
    search: (query: string) => Promise<PickerRow[]>
    /** The empty tab's launcher: its *Recent* list and its two verbs (P5). */
    recent: () => string[]
    newNote: (tabId: string) => void
    openQuick: () => void
    bindings?: { newNote: string; openQuick: string }
    resolveLink: (target: string, from: string | undefined) => string | null
    createFromLink: (target: string) => void
    linkCandidates: () => string[]
    /** Read X4: a tag chip's click opens vault search on `tag:#x`. */
    searchTag: (tag: string) => void
    /** Read X4: the `#` completion source, from the index (sync snapshot). */
    tags: () => string[]
    /** A caret reveal for the FOCUSED pane (a search result's Enter). */
    reveal: { offset: number } | null
    groupChip?: Snippet<[Group, Pane]>
    tabMenuGroupItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Tab]>
    moreMenuItems?: Snippet<[{ item: MenuItemAttrs; separator: MenuSeparatorAttrs }, Pane]>
    /** Which chrome the layout gives this pane (spike S21); absent → today's. */
    chrome?: PaneChrome
  }

  let {
    pane,
    focused,
    panes,
    workspace,
    dark,
    search,
    recent,
    newNote,
    openQuick,
    bindings,
    resolveLink,
    createFromLink,
    linkCandidates,
    searchTag,
    tags,
    reveal,
    groupChip,
    tabMenuGroupItems,
    moreMenuItems,
    chrome = DENSE_CHROME,
    typewriter = false,
    inlineTitle = true,
  }: Props = $props()

  const uid = $props.id()
  const index = $derived(panes.paneIndex(pane.id))
  const tab = $derived(activeTab(pane))
  const path = $derived(tab?.path ?? null)
  const doc = $derived(path ? workspace.docForPath(path) : null)
  const awareness = $derived(path ? workspace.awarenessForPath(path) : null)
  const undoManager = $derived(path ? workspace.undoManagerFor(path) : null)
  /** This tab's view mode, or the Settings default when it has none (B3). */
  const mode = $derived<ViewMode>(panes.modeOf(tab))

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
  /**
   * What a RENDERED note can ask the shell for (read-shaping B2.2/B2.3/B5).
   * Untracked for the same reason `linkHost` is — CM6 calls these while it
   * builds decorations, inside the effect that creates the view, so a tracked
   * read here would put the view's lifecycle on the pane tree.
   */
  const noteHost = {
    readAttachment: (name: string) => untrack(() => workspace.readAttachment(name, path)),
    openExternal,
    searchTag: (tag: string) => untrack(() => searchTag(tag)),
    tags: () => untrack(() => tags()),
    // A getter, not a value: the copy is read when a decoration is built, so a
    // locale switch reaches the widgets (see `readLabels`).
    get labels() {
      return untrack(readLabels)
    },
    // The strip's reader: the same parser the index and the CLI use, so the
    // chips at the top of a note agree with `tag:#x` search by construction.
    frontmatter: parseFrontmatter,
  }
  // ONE stable array, built once: both facets are reconfigured through the
  // host compartment, never re-created, so the Y.Text binding survives.
  const extensions = [wikiLinkHost.of(linkHost), readHost.of(noteHost)]

  const status = $derived(noteStatus(workspace.ui.files, workspace.ui.records, path))

  // ---- the chrome the layout gives this pane (spike S21) ----
  /** No strip for a lone tab under `tabs: 'auto'` — and then no tablist ARIA either. */
  const strip = $derived(showsStrip(chrome, pane))
  /** Zoom mounts one pane, so one is on screen whatever the tree holds. */
  const onScreen = $derived(panes.layout.zoom ? 1 : panesOf(panes.layout.tree).length)
  const edge = $derived(showsFocusEdge(chrome, focused, onScreen))
  /** Golden rule 4 with the status bars merged: this pane says it is off green itself. */
  const dot = $derived(showsSyncDot(chrome, focused, status) ? status : null)

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

  /**
   * The live handle. A signal, because `Mod+L` has to reach whichever pane
   * holds the focus and that means re-registering when the view changes; every
   * OTHER read of it is untracked, so the view's own lifecycle never comes to
   * depend on the pane tree. (The MODE is a prop — `MarkdownEditor` applies it
   * by reconfigure — so there is no second path that could disagree with it.)
   */
  let handle = $state.raw<MarkdownEditorHandle | null>(null)

  /**
   * `Mod+L` acts on whichever pane has the focus, so the command reaches the
   * view through the shell rather than the other way round (the registry is
   * global; the view is not).
   */
  $effect(() => {
    const id = pane.id
    const view = handle
    panes.registerEditor(
      id,
      view
        ? {
            toggleTask: () => toggleTask(view.view),
            // A palette row or a toolbar button took the focus to run this;
            // the caret belongs back in the text it just formatted.
            format: (fid) => {
              const done = runFormat(view.view, fid)
              view.view.focus()
              return done
            },
            // A template (quiet-shell F11): one dispatch at the caret, the
            // path typing takes, so undo and the peers see one edit.
            insertText: (text) => {
              if (view.view.state.readOnly) return false
              view.view.dispatch(view.view.state.replaceSelection(text), { scrollIntoView: true })
              view.view.focus()
              return true
            },
            // The resolved keymap's format chords (F10): a cleared binding
            // is cleared in CodeMirror too, not only in the shell.
            setFormatBindings: (bindings) => view.setFormatBindings(bindings),
          }
        : null
    )
    return () => panes.registerEditor(id, null)
  })

  /**
   * The same handle, offered to the shell on demand: a view reports its
   * resume point on teardown, which is one beat after `closeGroup` and
   * `closePane` have read the tab it belongs to.
   */
  $effect(() => {
    const id = pane.id
    panes.registerCapture(id, () => untrack(() => handle?.capture() ?? null))
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

  /**
   * The inline title (P3): mounted INTO the view's scroller, just before
   * `.cm-content`, so it scrolls with the note while staying outside the
   * document — CM6 listens on its content element only, so the title's keys,
   * clicks and selection never reach the editor, and the resume point (the
   * scroller's `scrollTop`) still means the same place. It is mounted
   * imperatively rather than rendered and moved: a Svelte block whose nodes
   * were moved into CM6's DOM would tear down by walking CM6's siblings.
   * Only a note gets one — a view tab and the empty tab never reach here.
   */
  const shell = getViewShell()
  const titled = $derived(inlineTitle && !!doc && !!path && !!shell)
  $effect(() => {
    const view = handle?.view
    if (!view || !titled) return
    const scroller = view.scrollDOM
    const slot = document.createElement('div')
    slot.className = 'ed-inline-title'
    scroller.insertBefore(slot, view.contentDOM)
    scroller.classList.add('ed-titled')
    const title = mount(InlineTitle, {
      target: slot,
      props: {
        // A getter: a rename from the tree retitles the field in place.
        get path() {
          return path ?? ''
        },
        onRename: (name: string) => {
          const from = untrack(() => path)
          return from && shell ? shell.renameNote(from, name) : Promise.resolve(null)
        },
        onExit: () => void enterText(),
      },
    })
    return () => {
      void unmount(title)
      slot.remove()
      scroller.classList.remove('ed-titled')
    }
  })

  /**
   * Out of the title into the note's first line. After a rename the tab's
   * path has changed and the view is being rebuilt, so wait for the flush and
   * take whichever view the pane holds then.
   */
  async function enterText(): Promise<void> {
    await tick()
    const view = untrack(() => handle)?.view
    if (!view) return
    view.focus()
    view.dispatch({ selection: { anchor: 0 }, scrollIntoView: true })
  }

  /**
   * A note dragged in from the file navigator (P1.2): three handlers feeding
   * the shell's own hit test, so a tree row behaves exactly like a tab.
   *
   * They run in the CAPTURE phase on purpose: CodeMirror answers `drop` on its
   * content with "insert the dropped text", which for a tree row would paste
   * the path into the note. Taking the event before it reaches the editor —
   * and only for our own MIME type, so a text drag inside the editor is
   * untouched — is what stops that.
   */
  const EXTERNAL = 'application/x-editor-path'
  const carriesPath = (e: DragEvent): boolean =>
    e.dataTransfer !== null && [...e.dataTransfer.types].includes(EXTERNAL)

  function onDragOver(e: DragEvent): void {
    if (!carriesPath(e)) return
    e.preventDefault()
    e.stopPropagation()
    // `move`, not `link`: the tree's `dragstart` declares `effectAllowed =
    // 'move'`, and a `dropEffect` that its source does not allow makes the
    // browser call the whole operation off — no cursor, and no `drop` event.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    panes.hoverExternal(e.clientX, e.clientY)
  }

  function onDragLeave(e: DragEvent): void {
    // Row-to-row inside the pane is not leaving it; only the section boundary is.
    const to = e.relatedTarget
    if (to instanceof Node && host?.contains(to)) return
    panes.leaveExternal()
  }

  function onDrop(e: DragEvent): void {
    if (!carriesPath(e)) return
    e.preventDefault()
    e.stopPropagation()
    const path = e.dataTransfer?.getData(EXTERNAL) ?? ''
    if (path) panes.dropExternal(path)
    else panes.leaveExternal()
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
  ondragovercapture={onDragOver}
  ondropcapture={onDrop}
  ondragleave={onDragLeave}
  class="relative flex min-h-0 min-w-0 flex-1 flex-col bg-ed-surface
    {focused && panes.mode ? 'outline-1 -outline-offset-1 outline-ed-pane-mode' : ''}"
>
  {#if edge}
    <!-- Where focus is, when there is more than one pane to tell apart and
         no strip inset says it (S21 Q3): the same 2 px as that inset. -->
    <span
      aria-hidden="true"
      data-testid="pane-focus-edge"
      class="pointer-events-none absolute inset-x-0 top-0 z-10 h-ed-pane-focus bg-ed-pane-focus"
    ></span>
  {/if}
  {#if dot}
    <!-- Band C, unlayered (`.ed-sync-dot`): no theme can repaint or hide it. -->
    <div class="absolute top-1.5 right-2 z-10">
      <SyncPill
        status={dot}
        testid="pane-sync-dot:{pane.id}"
        title={$LL.web.panes.sync_dot({ pane: $LL.web.panes.label({ n: index }), state: pillTitle(dot) })}
      />
    </div>
  {/if}

  {#if strip}
    <TabStrip
      {pane}
      {focused}
      {panes}
      {uid}
      {groupChip}
      {tabMenuGroupItems}
      {moreMenuItems}
      insetMark={!chrome.focusMark}
      presence={workspace.ui.presenceByPath}
    />
  {/if}

  {#if tab}
    <!-- With no strip there is no tab to label a tabpanel: a plain region of
         the pane (the section already names it), never a dangling IDREF. -->
    <div
      role={strip ? 'tabpanel' : undefined}
      id={strip ? `${uid}-panel-${tab.id}` : undefined}
      aria-labelledby={strip ? `${uid}-tab-${tab.id}` : undefined}
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
            {mode}
            {dark}
            {typewriter}
            {extensions}
            reveal={focused ? reveal : null}
            onhandle={(h) => onHandle(held, h)}
          />
        {/key}
      {:else if tab.view}
        <!-- A view tab: whichever component the registry names (S22 Q5). -->
        {@const View = viewDef(tab.view).component}
        <View {workspace} {tab} />
      {:else}
        <EmptyTab
          {search}
          {recent}
          {bindings}
          testid="empty-tab:{pane.id}"
          onPick={(picked) => panes.navigate(picked, tab.id)}
          onNew={() => newNote(tab.id)}
          onOpenQuick={openQuick}
        />
      {/if}
    </div>
  {/if}

  {#if chrome.statusbar === 'pane'}
    <!-- The layout's `bars.statusbar`, through the readout renderer, for THIS pane. -->
    <StatusBar paneId={pane.id} {focused} lead={chrome.lead} />
  {/if}
</section>
