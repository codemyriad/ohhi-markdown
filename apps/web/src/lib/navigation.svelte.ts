/**
 * Navigation state: the vault index, the command registry, and the one
 * overlay that serves quick-open, the command palette and vault search.
 *
 * Kept out of App.svelte so the interesting parts stay unit-testable and the
 * shell stays a renderer (the tree-model.ts pattern — the only testable-UI
 * convention this repo has).
 */
import { getLL } from '@ohhi/i18n'
import { MemoryIndex, PathResolver, type LinkRef, type SearchHit } from '@ohhi/index'
import { CommandRegistry, type Command } from './commands.js'
import type { PaletteRow } from './components/Palette.svelte'
import type { TabView } from './panes.js'
import { recentPaths, touchPath } from './recent.js'
import { splitArgs } from './template.js'
import { viewCommands } from './views.js'
import { textPaths, type IndexSink, type Workspace } from './workspace.svelte.js'

export type PaletteMode = 'quick-open' | 'command' | 'search' | 'templates' | 'layouts'

/**
 * What the `layouts` mode lists and applies (`layout.use-file`, round 3 Q6):
 * the layout files every root offers, the built-in first.
 */
export interface LayoutFileSource {
  rows(): Promise<readonly { name: string; title: string; subtitle?: string; active: boolean }[]>
  use(name: string): void
}

/**
 * What the `templates` mode lists and runs (quiet-shell F11): the first word
 * of the query picks a template, the rest are its arguments.
 */
export interface TemplateSource {
  rows(): readonly { name: string; description: string; argumentHint: string }[]
  insert(name: string, args: string[]): void
}

/**
 * How many tags the `#` completion offers. The measured vault has 28; the cap
 * is what stops a pathological vault from building a list nobody can read.
 */
const TAG_COMPLETION_LIMIT = 500

/** The testids are the spec's contract; the copy is the dictionary's (`web.palette`). */
const MODE_KEYS: Record<
  PaletteMode,
  { key: 'quick_open' | 'command' | 'search' | 'templates' | 'layouts'; testid: string }
> = {
  'quick-open': { key: 'quick_open', testid: 'quick-open' },
  command: { key: 'command', testid: 'command-palette' },
  search: { key: 'search', testid: 'search' },
  templates: { key: 'templates', testid: 'template-picker' },
  layouts: { key: 'layouts', testid: 'layout-picker' },
}

function modeMeta(mode: PaletteMode): { placeholder: string; testid: string; empty: string } {
  const { key, testid } = MODE_KEYS[mode]
  const t = getLL().web.palette[key]
  return { placeholder: t.placeholder(), testid, empty: t.empty() }
}

export interface PaletteState {
  mode: PaletteMode | null
  query: string
  rows: PaletteRow[]
}

export function createNavigation(): {
  index: MemoryIndex
  /** Hand this to setupWorkspace: it writes the index AND wakes the queries. */
  sink: IndexSink
  registry: CommandRegistry
  palette: PaletteState
  /** A pending caret reveal for the open note (search Enter), else null. */
  pending: { reveal: { offset: number } | null }
  /** Tell navigation whether the links panel is visible; it skips the work if not. */
  setLinksVisible(isVisible: () => boolean): void
  /**
   * How a picked note opens. The pane tree owns that decision (tab-groups
   * B5), so the palette hands the path over rather than selecting anything
   * itself. Without one, picking a note does nothing.
   */
  setOpener(open: (path: string, opts: { background?: boolean }) => void): void
  /** What the `templates` mode lists and inserts (`template.insert`, F11). */
  setTemplates(source: TemplateSource): void
  /** What the `layouts` mode lists and applies (`layout.use-file`, round 3 Q6). */
  setLayoutFiles(source: LayoutFileSource): void
  /**
   * Bumped on every indexed content change, from any writer. Read it inside
   * an `$effect` to re-derive anything that depends on note TEXT — the index
   * itself is a plain data structure, so this counter is the subscription.
   */
  readonly revision: number
  open(mode: PaletteMode): void
  /**
   * Open vault search on a query that is already written — what a click on a
   * tag chip does (read-shaping B5). `open()` clears the query by design, so
   * this is its own door rather than two calls in a row that race the effect.
   */
  openSearch(query: string): void
  close(): void
  setQuery(q: string): void
  pick(row: PaletteRow, opts?: { background?: boolean }): void
  /**
   * Point navigation at a workspace. Pass null (and call it BEFORE booting the
   * next vault) to drop the previous vault's documents.
   */
  attach(workspace: Workspace | null): void
  meta: { placeholder: string; testid: string; empty: string }
  /** Backlinks and outgoing links for the open note (V2c panels). */
  links: { backlinks: LinkRef[]; outgoing: LinkRef[] }
  /**
   * Synchronous target→path resolution for the CM6 decorator, which cannot
   * await. Backed by the SAME PathResolver rules the index uses, so a link's
   * colour in the editor and its attribution in the panels can never disagree.
   */
  resolveLink(target: string, fromPath?: string): string | null
  /**
   * Does more than one note in the vault carry this basename? What decides
   * whether a copied group link needs its full path (tab-groups B8). Asked of
   * the SAME `PathResolver` the editor's links resolve through, so a link
   * copied out of a group resolves back to the note it came from.
   */
  ambiguousName(name: string): boolean
  /**
   * Every tag the index knows, `#` included — the `#` completion source
   * (read-shaping B5). Synchronous because CM6's completion cannot await, and
   * memoised on the index revision: the answer is recomputed once per content
   * change, and only when something actually asks (typing `#`), never on the
   * editor's input path.
   */
  tags(): string[]
} {
  const index = new MemoryIndex()
  const registry = new CommandRegistry()
  /**
   * A second PathResolver over the same path set. The index's own resolver is
   * private and its API is async by contract; CM6's decoration builder runs
   * synchronously on every viewport change and cannot await. Same class, same
   * rules — so the editor and the panels always agree.
   */
  const resolver = new PathResolver()
  let resolverPaths = ''
  const palette = $state<PaletteState>({ mode: null, query: '', rows: [] })
  const links = $state<{ backlinks: LinkRef[]; outgoing: LinkRef[] }>({
    backlinks: [],
    outgoing: [],
  })

  let workspace: Workspace | null = null
  /** Set by the host: false while the links panel is hidden. */
  let linksWanted: () => boolean = () => true
  /** Set by the host: opens a path in the pane tree. */
  let opener: (path: string, opts: { background?: boolean }) => void = () => {}
  /** Set by the host: the templates the `templates` mode offers. */
  let templates: TemplateSource | null = null
  let layoutFiles: LayoutFileSource | null = null
  /**
   * Bumped by the index sink so derived queries re-run on any content change.
   *
   * The index itself is deliberately NOT reactive: it is a plain data
   * structure, and making a thousand documents reactive would mean a Svelte
   * proxy per note. One counter is the whole subscription.
   */
  let revision = $state(0)

  /** Keep the sync resolver in step with the file set (cheap; path-set only). */
  const refreshResolver = (): void => {
    const paths = textPaths(workspace?.ui.files ?? [])
    const key = paths.join('\u0000')
    if (key === resolverPaths) return
    resolverPaths = key
    resolver.reset(paths)
  }

  const sink: IndexSink = {
    upsert(doc) {
      index.upsert(doc)
      revision++
      refreshTags()
    },
    remove(guid) {
      index.remove(guid)
      revision++
      refreshTags()
    },
    rename(guid, path) {
      index.rename(guid, path)
      revision++
      refreshTags()
    },
  }

  const meta = $derived(modeMeta(palette.mode ?? 'quick-open'))

  /** Set when a search result asked to land on a specific character. */
  const pending = $state<{ reveal: { offset: number } | null }>({ reveal: null })

  /**
   * The `#` completion list, the revision it was computed for, and whether a
   * recompute is already on its way.
   */
  let tagList: string[] = []
  let tagsAt = -1
  let tagsQueued = false

  /**
   * Keep the `#` completion list warm.
   *
   * It is read SYNCHRONOUSLY, from inside a CM6 completion source, and CM6
   * asks once per typing pause — so a list that is only fetched when it is
   * asked for is empty exactly when it is first needed, and nothing asks
   * again. Refreshing when the index changes instead costs one pass per
   * change, coalesced to one per microtask so that indexing a whole vault at
   * boot is still one pass (golden rule 8: the query stays Promise-returning
   * and paged, whatever backs it).
   */
  function refreshTags(): void {
    if (tagsQueued || tagsAt === revision) return
    tagsQueued = true
    queueMicrotask(() => {
      const at = revision
      tagsQueued = false
      void index.tags({ limit: TAG_COMPLETION_LIMIT }).then((page) => {
        tagsAt = at
        tagList = page.items.map((t) => t.tag)
      })
    })
  }

  const openNote = (path: string, offset?: number, background = false): void => {
    if (!workspace) return
    opener(path, { background })
    touchPath(workspace.room, path)
    palette.mode = null
    // A NEW object every time, so picking the same hit twice still reveals.
    pending.reveal = offset === undefined ? null : { offset }
  }

  const refresh = async (): Promise<void> => {
    const mode = palette.mode
    if (!mode) {
      palette.rows = []
      return
    }
    const query = palette.query
    const rows = await buildRows(mode, query)
    // A slower query that resolved after the user moved on must not overwrite
    // the current list. (In-memory answers are synchronous today; this keeps
    // the code correct for the SQLite backend behind Fork 1's trigger.)
    if (palette.mode === mode && palette.query === query) palette.rows = rows
  }

  /**
   * The subtitle for one search row. `title`/`path` name the tier; `body` keeps
   * the behaviour it had before tiers existed — a filename-only match is
   * labelled, everything else leans on its snippets.
   */
  function tierSubtitle(hit: SearchHit): string | undefined {
    const t = getLL().web.palette
    if (hit.tier === 'title') return t.tier.title()
    if (hit.tier === 'path') return t.tier.path()
    return hit.snippets.length === 0 ? t.filename_match() : undefined
  }

  async function buildRows(mode: PaletteMode, query: string): Promise<PaletteRow[]> {
    if (mode === 'layouts') {
      const q = query.trim().toLowerCase()
      const inUse = getLL().web.palette.layouts.in_use()
      return (await (layoutFiles?.rows() ?? Promise.resolve([])))
        .filter((r) => !q || r.title.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
        .map((r) => ({
          id: r.name,
          title: r.title,
          ...(r.subtitle ? { subtitle: r.subtitle } : {}),
          ...(r.active ? { hint: inUse } : {}),
        }))
    }
    if (mode === 'templates') {
      const [first = ''] = splitArgs(query)
      const q = first.toLowerCase()
      return (templates?.rows() ?? [])
        .filter((r) => !q || r.name.toLowerCase().includes(q))
        .map((r) => ({
          id: r.name,
          title: r.name,
          ...(r.description ? { subtitle: r.description } : {}),
          ...(r.argumentHint ? { hint: r.argumentHint } : {}),
        }))
    }
    if (mode === 'command') {
      const q = query.trim().toLowerCase()
      return registry
        .available()
        .filter((c) => !q || c.title.toLowerCase().includes(q))
        .map((c) => ({
          id: c.id,
          title: c.title,
          subtitle: c.group,
          hint: registry.binding(c.id),
        }))
    }
    if (mode === 'quick-open') {
      const recent = workspace ? recentPaths(workspace.room) : []
      const page = await index.quickOpen(query, { limit: 50, recent })
      return page.items.map((hit) => ({
        id: hit.path,
        title: hit.path,
        spans: hit.spans,
        hint: !query && recent.includes(hit.path) ? getLL().web.palette.recent() : undefined,
      }))
    }
    if (!query.trim()) return []
    const page = await index.search(query, { limit: 50 })
    return page.items.map((hit: SearchHit) => ({
      id: hit.path,
      title: hit.path,
      // The tier is WHY the row is where it is, and results are ordered by
      // tier before score. It is also the one thing the snippets cannot show:
      // a note called `Docs` that never writes the word has no snippet at all.
      subtitle: tierSubtitle(hit),
      detail: hit.snippets.map((s) => ({ text: s.text, spans: s.spans })),
      // Enter lands the caret on the first match, not at the top of the note.
      offset: hit.spans[0]?.from,
    }))
  }

  // Re-run whenever the mode, the query, or the indexed content changes.
  $effect(() => {
    palette.mode
    palette.query
    revision
    void refresh()
  })

  // Link panels for the open note. Skipped entirely while the panel is closed
  // — this runs on every content change, i.e. on CodeMirror's input path.
  $effect(() => {
    revision
    const path = linksWanted() ? (workspace?.ui.selectedPath ?? null) : null
    if (!path) {
      links.backlinks = []
      links.outgoing = []
      return
    }
    const guid = workspace?.ui.files.find((f) => f.path === path)?.guid
    void (async () => {
      links.backlinks = (await index.backlinks(path, { limit: 200 })).items
      links.outgoing = guid ? (await index.outgoing(guid, { limit: 200 })).items : []
    })()
  })

  return {
    index,
    sink,
    registry,
    pending,
    palette,
    get meta() {
      return meta
    },
    get revision() {
      return revision
    },
    setLinksVisible(isVisible) {
      linksWanted = isVisible
    },
    setOpener(open) {
      opener = open
    },
    setTemplates(source) {
      templates = source
    },
    setLayoutFiles(source) {
      layoutFiles = source
    },
    resolveLink(target, fromPath) {
      refreshResolver()
      return resolver.resolve(target, fromPath)
    },
    ambiguousName(name) {
      refreshResolver()
      return resolver.candidates(name).length > 1
    },
    links,
    open(mode) {
      palette.mode = mode
      palette.query = ''
    },
    openSearch(query) {
      palette.mode = 'search'
      palette.query = query
    },
    tags() {
      // A safety net only: the list is kept warm by the index sink, so this
      // hands back what the last index change computed rather than starting a
      // fetch nobody will wait for.
      refreshTags()
      return tagList
    },
    close() {
      palette.mode = null
    },
    setQuery(q) {
      palette.query = q
    },
    pick(row, opts) {
      if (palette.mode === 'command') {
        palette.mode = null
        void registry.get(row.id)?.run()
        return
      }
      if (palette.mode === 'layouts') {
        palette.mode = null
        layoutFiles?.use(row.id)
        return
      }
      if (palette.mode === 'templates') {
        // `meeting Weekly "Ana Bo"`: the first word picked the row, the rest
        // are its arguments.
        const args = splitArgs(palette.query).slice(1)
        palette.mode = null
        templates?.insert(row.id, args)
        return
      }
      openNote(row.id, row.offset, opts?.background)
    },
    attach(ws) {
      // Detaching CLEARS the index. Guids are UUIDs, so nothing collides —
      // the previous vault's notes would simply accumulate, and quick-open
      // would list files that `select()` cannot open in the vault you are in.
      if (ws === null) {
        index.rebuild([])
        resolver.reset([])
        resolverPaths = ''
        links.backlinks = []
        links.outgoing = []
        palette.rows = []
      }
      workspace = ws
      revision++
    },
  }
}

/** The V2b command set, bound to the keys Chris already uses in Obsidian. */
export function defaultCommands(actions: {
  quickOpen: () => void
  commandPalette: () => void
  search: () => void
  newNote: () => void
  toggleSidebar: () => void
  toggleRail: () => void
  settings: () => void
  back: () => void
  forward: () => void
  /** Chrome U3: file ops on the OPEN note (Chris's Mod+Shift+R / Mod+Shift+A rebinds). */
  hasNote: () => boolean
  deleteNote: () => void
  moveNote: () => void
  newFolder: () => void
  addShare: () => void
  /**
   * The share sheet for the open note's folder (sharing E4), or for the
   * shared folder around it; listed only while there is one to share.
   */
  shareFolder: () => void
  canShareFolder: () => boolean
  /** Device linking (N2, A1): opens the device-link dialog. */
  linkDevice: () => void
  /**
   * Daily notes (W3), over Obsidian's own `daily-notes.json`. `today` creates
   * the note if it is not there yet; prev/next only ever open a daily that
   * already exists, so their guards are "is there one to step to".
   */
  dailyToday: () => void
  dailyPrev: () => void
  dailyNext: () => void
  hasPrevDaily: () => boolean
  hasNextDaily: () => boolean
  /**
   * Open a view tab (the view registry, spike S22 Q5): one palette row per
   * registered view is generated from `views.ts`, each with its own `when`
   * (the inspector's is "developer tools are on").
   */
  openView: (id: TabView, arg?: string) => void
  devtools: () => boolean
}): Command[] {
  // Titles resolve at registration (the locale is loaded before the shell
  // mounts); a locale switch re-registers, the way Edible re-runs its load.
  const t = getLL().web.commands
  const g = t.groups
  return [
    { id: 'nav.quick-open', title: t.quick_open(), group: g.navigate(), keys: 'Mod+o', run: actions.quickOpen },
    { id: 'nav.command-palette', title: t.command_palette(), group: g.navigate(), keys: 'Mod+Shift+p', run: actions.commandPalette },
    { id: 'nav.search', title: t.search(), group: g.navigate(), keys: 'Mod+Shift+f', run: actions.search },
    { id: 'file.new', title: t.new_note(), group: g.file(), keys: 'Mod+n', run: actions.newNote },
    { id: 'file.new-folder', title: t.new_folder(), group: g.file(), keys: 'Mod+Shift+n', run: actions.newFolder },
    // Chris's own Obsidian bindings: app:delete-file and file-explorer:move-file.
    { id: 'file.delete', title: t.delete_note(), group: g.file(), keys: 'Mod+Shift+r', run: actions.deleteNote, when: actions.hasNote },
    { id: 'file.move', title: t.move_note(), group: g.file(), keys: 'Mod+Shift+a', run: actions.moveNote, when: actions.hasNote },
    { id: 'share.folder', title: t.share_folder(), group: g.share(), run: actions.shareFolder, when: actions.canShareFolder },
    { id: 'share.add', title: t.add_share(), group: g.share(), run: actions.addShare },
    { id: 'share.link-device', title: t.link_device(), group: g.share(), run: actions.linkDevice },
    // Mod+[ / Mod+] are Chris's own Obsidian bindings for navigation history.
    { id: 'nav.back', title: t.back(), group: g.navigate(), keys: 'Mod+[', run: actions.back },
    { id: 'nav.forward', title: t.forward(), group: g.navigate(), keys: 'Mod+]', run: actions.forward },
    // Chris's own Obsidian bindings for the sidebars (Mod+Left / Mod+Right).
    { id: 'view.sidebar', title: t.toggle_navigator(), group: g.view(), keys: 'Mod+ArrowLeft', run: actions.toggleSidebar },
    { id: 'view.rail', title: t.toggle_rail(), group: g.view(), keys: 'Mod+ArrowRight', run: actions.toggleRail },
    // Chris's own Obsidian bindings for the daily-notes plugin (3 of his 18 rebinds).
    { id: 'daily.today', title: t.daily_today(), group: g.daily(), keys: 'Mod+\\', run: actions.dailyToday },
    { id: 'daily.prev', title: t.daily_prev(), group: g.daily(), keys: 'Mod+-', run: actions.dailyPrev, when: actions.hasPrevDaily },
    { id: 'daily.next', title: t.daily_next(), group: g.daily(), keys: 'Mod+=', run: actions.dailyNext, when: actions.hasNextDaily },
    { id: 'app.settings', title: t.settings(), group: g.app(), keys: 'Mod+,', run: actions.settings },
    ...viewCommands(actions.openView, { devtools: actions.devtools }),
  ]
}

/** The navigation object the shell's components are handed (V2b/V2c). */
export type Navigation = ReturnType<typeof createNavigation>
