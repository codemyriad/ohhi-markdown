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
  import { attachmentHost, redoCommand, runFormat, undoCommand, type MarkdownEditorHandle } from '@ohhi/editor'
  import {
    inTable,
    readHost,
    runTableCommand,
    toggleTask,
    wikiLinkHost,
    type LinkHeading,
    type LinkMount,
    refreshPreview,
    type CollectionEmbedProps,
    type Mounted,
    type PropertiesEditor,
    type PropertiesProps,
    type ReadHost,
    type WikiLinkHost,
  } from '@ohhi/editor-lang'
  import { isCollectionPath } from '@ohhi/collections'
  import { parseFrontmatter } from '@ohhi/frontmatter'
  import { LL } from '@ohhi/i18n/i18n-svelte'
  import { mount, tick, unmount, untrack, type Snippet } from 'svelte'
  import { activeTab, panes as panesOf, type Group, type Pane, type Tab, type ViewMode } from '../panes.js'
  import { DENSE_CHROME, showsFocusEdge, showsStrip, showsSyncDot, type PaneChrome } from '../pane-chrome.js'
  import { pillTitle } from '../pill-status.js'
  import { editorLabels, loadRemoteImage, openExternal } from '../read.svelte.js'
  import { typingState } from '../typing.svelte.js'
  import { createAttachmentHost } from '../attachment-host.js'
  import { noteStatus } from '../readout-state.js'
  import type { MenuItemAttrs, MenuSeparatorAttrs } from '../ui/DropdownMenu.svelte'
  import type { PaneShell } from '../workspace-panes.svelte.js'
  import type { Workspace } from '../workspace.svelte.js'
  import CollectionView from './CollectionView.svelte'
  import EmptyTab, { type PickerRow } from './EmptyTab.svelte'
  import { getViewShell, shellClock, viewDef, viewShellContext } from '../views.js'
  import { isDesktop } from '../platform.js'
  import InlineTitle from './InlineTitle.svelte'
  import PropertiesForm from './PropertiesForm.svelte'
  import StatusBar from './StatusBar.svelte'
  import SyncPill from './SyncPill.svelte'
  import TabStrip from './TabStrip.svelte'
  import type { SelectionRender } from './PaneTree.svelte'
  import SelectionBar from './SelectionBar.svelte'
  import { selectionBar } from '@ohhi/editor'
  // Comment threads — not AI-gated; only *Send to agent* is.
  import { commentsExtension } from '@ohhi/editor'
  import { bindEditor, focusEditor } from '../focused-editor.svelte.js'
  import { aiEnabled } from '../ai-config.svelte.js'
  import { bindThreads, commentBubble, commentsHostFor, showActiveThread } from '../threads.svelte.js'
  import CommentBubble from './CommentBubble.svelte'
  // The agent's suggestions in the note.
  import { noteSuggestions } from '../suggestions.svelte.js'
  // The agent's working range, from the note's awareness.
  import { workingHighlight } from '@ohhi/editor'
  import { workingHost } from '../agent-presence.js'

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
    /** The link popover's scope (E1, fork A2): the vault's shares and the recent notes. */
    linkContext?: () => { mounts: LinkMount[]; recents: string[] }
    /** `[[Note#` headings, from the index. */
    linkHeadings?: (path: string) => Promise<LinkHeading[]>
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
    /** The selection handle's items and registry (selection explorations); absent → none. */
    selection?: SelectionRender
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
    linkContext,
    linkHeadings,
    searchTag,
    tags,
    reveal,
    groupChip,
    tabMenuGroupItems,
    moreMenuItems,
    chrome = DENSE_CHROME,
    selection,
    typewriter = false,
    inlineTitle = true,
  }: Props = $props()

  const uid = $props.id()
  const index = $derived(panes.paneIndex(pane.id))
  const tab = $derived(activeTab(pane))
  const path = $derived(tab?.path ?? null)
  /**
   * Re-resolved after every surgery (`ui.docsEpoch`): a carve, an unshare or
   * an adopt keeps the PATH and replaces the doc instance behind it, and the
   * one a view held is destroyed — typing into it reached nobody.
   */
  const doc = $derived.by(() => {
    void workspace.ui.docsEpoch
    return path ? workspace.docForPath(path) : null
  })
  /**
   * Re-resolved under the same epoch; a new awareness for the SAME doc (its
   * connection came up after the note opened) is swapped into the editor in
   * place, never by remounting it.
   */
  const awareness = $derived.by(() => {
    void workspace.ui.docsEpoch
    return path ? workspace.awarenessForPath(path) : null
  })
  /**
   * A surgery is replacing this note's doc right now (`ui.frozen`): the view
   * still shows the old instance, so it holds still — what is typed into it
   * would be gone at the remount. Through the editor's compartment, no rebuild.
   */
  const frozen = $derived(
    path !== null &&
      (workspace.ui.frozen ?? []).some((p) => p === '' || path === p || path.startsWith(`${p}/`))
  )
  const undoManager = $derived.by(() => {
    void workspace.ui.docsEpoch
    return path ? workspace.undoManagerFor(path) : null
  })
  /**
   * The editor is keyed on the doc INSTANCE as well as the path, so a new
   * instance remounts it (the old binding cannot be repointed) while a
   * surgery that left this note's doc alone keeps the editor as it is.
   */
  const instanceIds = new WeakMap<object, number>()
  let nextInstanceId = 0
  const instanceOf = (d: object): number => {
    let id = instanceIds.get(d)
    if (id === undefined) {
      id = nextInstanceId++
      instanceIds.set(d, id)
    }
    return id
  }
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
    // The popover's scope is THIS pane's note: a link written in a shared
    // note is offered the share's notes first (E1, fork A2).
    context: () =>
      untrack(() => ({ path: path ?? null, ...(linkContext?.() ?? { mounts: [], recents: [] }) })),
    headings: (target) => untrack(() => linkHeadings?.(target) ?? Promise.resolve([])),
    // A getter, as the note host's is: a locale switch reaches the popover.
    get labels() {
      return untrack(editorLabels).linkPopover
    },
  }
  /**
   * What a RENDERED note can ask the shell for (read-shaping B2.2/B2.3/B5).
   * Untracked for the same reason `linkHost` is — CM6 calls these while it
   * builds decorations, inside the effect that creates the view, so a tracked
   * read here would put the view's lifecycle on the pane tree.
   */
  const noteHost: ReadHost = {
    readAttachment: (name: string, form?: 'wikilink' | 'markdown') =>
      untrack(() => workspace.readAttachment(name, path, form)),
    // `![alt](https://…)` loads on a click, never on open (E5).
    loadRemoteImage,
    openExternal,
    searchTag: (tag: string) => untrack(() => searchTag(tag)),
    tags: () => untrack(() => tags()),
    // A getter, not a value: the copy is read when a decoration is built, so a
    // locale switch reaches the widgets (see `editorLabels`).
    get labels() {
      return untrack(editorLabels)
    },
    // The strip's reader: the same parser the index and the CLI use, so the
    // chips at the top of a note agree with `tag:#x` search by construction.
    frontmatter: parseFrontmatter,
    // Whether this note is a row of a collection (bases-shaping Fork 3-B):
    // the shell's tracker's last answer; the engine is told to rebuild when
    // it changes (below).
    inCollection: () => untrack(() => (path && membership ? membership.isMember(path) : false)),
    mountProperties,
    // The doc's own history (the Y.UndoManager's), for Mod+Z inside the form.
    undo: (view) => undoCommand(view),
    redo: (view) => redoCommand(view),
    // `![[X.base]]` resolves like any link, but only a collection counts.
    resolveCollection: (name: string) =>
      untrack(() => {
        const resolved = resolveLink(name, path ?? undefined)
        return resolved && isCollectionPath(resolved) ? resolved : null
      }),
    mountCollection,
  }
  // ONE stable array, built once: both facets are reconfigured through the
  // host compartment, never re-created, so the Y.Text binding survives.
  /**
   * Pasting and dropping pictures (E5): written beside the note by Obsidian's
   * rules, through the workspace's journaled write. Untracked like the hosts
   * above; the clock is the shell's (golden rule 5).
   */
  const pasteClock = shellClock()
  const fileHost = createAttachmentHost({
    workspace: () => workspace,
    notePath: () => untrack(() => path),
    now: () => pasteClock.now(),
  })
  const extensions = [
    wikiLinkHost.of(linkHost),
    readHost.of(noteHost),
    attachmentHost.of(fileHost),
    commentsExtension(commentsHostFor(() => pane.id, () => path)),
    // Untracked like the hosts above: CM6 reads these inside the view's own effect.
    // The pair on a proposal runs the registry's caret rows — through the
    // shell, with this pane the one note-acting commands mean.
    noteSuggestions(
      () => untrack(() => workspace),
      () => untrack(() => path),
      {
        run: (id) => {
          focusEditor(pane.id)
          shell?.runCommand(id)
        },
        keys: (id) => shell?.commandKeys(id) ?? '',
      }
    ),
    workingHighlight(
      workingHost(
        () => untrack(() => awareness),
        () => untrack(() => doc)
      )
    ),
    // The selection handle (selection explorations, shape B): the editor
    // decides when and where, this pane draws the layout's `bars.selection`
    // into it. Untracked like the hosts above; the settle delay runs on the
    // shell's clock.
    selectionBar({
      schedule: (fn, ms) => pasteClock.schedule(fn, ms),
      host: {
        offered: () => untrack(() => (selection?.ids().length ?? 0) > 0),
        mount: (dom, view, form) => {
          const render = untrack(() => selection)
          if (!render) return {}
          const app = mount(SelectionBar, {
            target: dom,
            props: { ids: render.ids(), registry: render.registry, form, view },
            ...(shell ? { context: viewShellContext(shell) } : {}),
          })
          return { destroy: () => void unmount(app) }
        },
      },
    }),
  ]

  // ---- the shell (verbs and the index) this pane's widgets reach ----
  const shell = getViewShell()
  const membership = shell?.membership ?? null

  /**
   * Is the open note a row of at least one collection (bases-shaping A7)?
   * The shell's one tracker answers, once per note path however many panes
   * show it, coalesced on the shell's clock; this pane only says which note
   * it is showing. The engine reads the answer synchronously through
   * `inCollection` and is told to rebuild with one effect when it changes —
   * or when the vault's path set does (below).
   */
  $effect(() => {
    const p = path
    if (!membership || !p || isCollectionPath(p)) return
    return membership.watch(p)
  })
  /**
   * The vault's path set, as one string so the effect below re-runs only
   * when a path appears, goes or moves — not on every row update. An embed's
   * `.base` is resolved when the decorations are built (`resolveCollection`),
   * so a collection that moves while the embed's text stays put
   * (`![[Competitors.base]]` still resolves after a move between folders)
   * would keep its old path without this.
   */
  const pathSet = $derived(workspace.ui.files.map((f) => f.path).join('\n'))
  $effect(() => {
    const p = path
    void (p && membership ? membership.isMember(p) : false)
    void pathSet
    const view = handle?.view
    if (view) view.dispatch({ effects: refreshPreview.of(null) })
  })

  /**
   * The properties form (A7), mounted into the engine's block widget over the
   * frontmatter lines — the InlineTitle pattern: a Svelte component inside
   * CM6's DOM, mounted imperatively, its inputs pushed through a reactive
   * holder so the element (and the focus inside it) survives every rebuild.
   */
  function mountProperties(dom: HTMLElement, props: PropertiesProps, editor: PropertiesEditor): Mounted<PropertiesProps> {
    const live = $state({ text: props.text, editable: props.editable })
    const app = mount(PropertiesForm, {
      target: dom,
      props: {
        workspace,
        get path() {
          return untrack(() => path) ?? ''
        },
        get text() {
          return live.text
        },
        get editable() {
          return live.editable
        },
        editor,
      },
      ...(shell ? { context: viewShellContext(shell) } : {}),
    })
    return {
      update: (next) => {
        live.text = next.text
        live.editable = next.editable
      },
      destroy: () => void unmount(app),
    }
  }

  /**
   * An embedded collection (A6): the collection tab's own component, read-
   * mostly, with `this.file` scoped to THIS note. A new target is a new
   * component (the tab keys on the path too); a new view name is a prop.
   */
  function mountCollection(dom: HTMLElement, props: CollectionEmbedProps): Mounted<CollectionEmbedProps> {
    const live = $state({ view: props.view, editable: props.editable })
    let at = props.path
    const start = () =>
      mount(CollectionView, {
        target: dom,
        props: {
          workspace,
          path: at,
          embedded: true,
          get viewName() {
            return live.view
          },
          get editable() {
            return live.editable
          },
          get scopePath() {
            return untrack(() => path) ?? at
          },
        },
        ...(shell ? { context: viewShellContext(shell) } : {}),
      })
    let app = start()
    return {
      update: (next) => {
        live.view = next.view
        live.editable = next.editable
        if (next.path !== at) {
          void unmount(app)
          at = next.path
          app = start()
        }
      },
      destroy: () => void unmount(app),
    }
  }

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
            // The `table.*` rows (E4): the same path as a format command.
            table: (tid) => {
              const done = runTableCommand(view.view, tid)
              view.view.focus()
              return done
            },
            inTable: () => inTable(view.view.state),
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

  // This pane's editor is what note-acting commands reach (`focused-editor`):
  // bound while it shows a note, and the focused one while its pane is.
  $effect(() => {
    const view = handle?.view
    if (!view || !path) return
    return bindEditor({ paneId: pane.id, path, view, focused: untrack(() => focused) })
  })
  $effect(() => {
    if (focused && handle) focusEditor(pane.id)
  })
  // Comment threads: this view's marks follow its note's threads, and the
  // open bubble's thread is drawn active.
  $effect(() => bindThreads({ path, view: handle?.view ?? null, storeFor: (p) => workspace.threadsFor(p) }))
  $effect(() => showActiveThread(pane.id, handle?.view ?? null))

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
   * The inline title (P3): mounted INTO the view's scroller, as its FIRST
   * child, so it scrolls with the note while staying outside the
   * document — CM6 listens on its content element only, so the title's keys,
   * clicks and selection never reach the editor, and the resume point (the
   * scroller's `scrollTop`) still means the same place. It is mounted
   * imperatively rather than rendered and moved: a Svelte block whose nodes
   * were moved into CM6's DOM would tear down by walking CM6's siblings.
   * Only a note gets one — a view tab and the empty tab never reach here.
   *
   * First, not "before `.cm-content`": CM6 puts its gutters there too (a
   * comment thread's marker column), and a view built with a thread already
   * in the note has them before this effect runs. Slotted between the
   * gutters and the content, the title wrapped onto a second row and left
   * the full-height gutter column alone on the first — a pane-high gap above
   * the note, its marker stranded at the top (QA round 1, after *Send to
   * agent* split the pane and rebuilt the note's view).
   */
  /** The desktop app: the launcher's *Connect an agent* (settings-shaping ST6) — a browser vault is out of an agent's reach. */
  const desktop = isDesktop()
  // A collection's Source view has no inline title: its name is not a heading of a note.
  const titled = $derived(inlineTitle && !!doc && !!path && !!shell && !isCollectionPath(path))
  $effect(() => {
    const view = handle?.view
    if (!view || !titled) return
    const scroller = view.scrollDOM
    const slot = document.createElement('div')
    slot.className = 'ed-inline-title'
    scroller.prepend(slot)
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
      {#if doc && path && isCollectionPath(path) && mode !== 'source'}
        <!-- A collection (bases-shaping A3): the table over its views; Source
             shows the YAML in CM6. Keyed like the editor, so a tab moving
             from one collection to another starts clean. -->
        {#key `${pane.id}:${path}`}
          <CollectionView {workspace} {path} />
        {/key}
      {:else if doc && path}
        {#key `${pane.id}:${path}:${instanceOf(doc)}`}
          {@const held = tab.id}
          <MarkdownEditor
            {doc}
            {awareness}
            readOnly={frozen}
            {undoManager}
            user={workspace.user}
            {mode}
            {dark}
            {typewriter}
            typing={typingState.aids}
            {extensions}
            reveal={focused ? reveal : null}
            onhandle={(h) => onHandle(held, h)}
          />
        {/key}
        {#if commentBubble.current?.paneId === pane.id && commentBubble.current.path === path}
          {#key commentBubble.current}
            <CommentBubble
              request={commentBubble.current}
              {workspace}
              ai={aiEnabled()}
              onClose={() => commentBubble.close()}
            />
          {/key}
        {/if}
      {:else if tab.view}
        <!-- A view tab: whichever component the registry names (S22 Q5).
             Keyed on the tab, so two tabs of one kind in a pane (the full
             inspector and an own-tab one) never share an instance's state. -->
        {@const View = viewDef(tab.view).component}
        {#key tab.id}
          <View {workspace} {tab} />
        {/key}
      {:else}
        <EmptyTab
          {search}
          {recent}
          {bindings}
          testid="empty-tab:{pane.id}"
          onPick={(picked) => panes.navigate(picked, tab.id)}
          onNew={() => newNote(tab.id)}
          onOpenQuick={openQuick}
          onCustomise={shell ? () => shell.openSettings('customise') : undefined}
          onAgents={shell && desktop ? () => shell.openSettings('ai') : undefined}
        />
      {/if}
    </div>
  {/if}

  {#if chrome.statusbar === 'pane'}
    <!-- The layout's `bars.statusbar`, through the readout renderer, for THIS pane. -->
    <StatusBar paneId={pane.id} {focused} lead={chrome.lead} />
  {/if}
</section>
