/**
 * Navigation state: the vault index, the command registry, and the one
 * overlay that serves quick-open, the command palette and vault search.
 *
 * Kept out of App.svelte so the interesting parts stay unit-testable and the
 * shell stays a renderer (the tree-model.ts pattern — the only testable-UI
 * convention this repo has).
 */
import { getLL } from '@editor/i18n'
import { MemoryIndex, PathResolver, type LinkRef, type SearchHit } from '@editor/index'
import { CommandRegistry, type Command } from './commands.js'
import type { PaletteRow } from './components/Palette.svelte'
import { recentPaths, touchPath } from './recent.js'
import type { IndexSink, Workspace } from './workspace.svelte.js'

export type PaletteMode = 'quick-open' | 'command' | 'search'

/** The testids are the spec's contract; the copy is the dictionary's (`web.palette`). */
const MODE_KEYS: Record<PaletteMode, { key: 'quick_open' | 'command' | 'search'; testid: string }> = {
  'quick-open': { key: 'quick_open', testid: 'quick-open' },
  command: { key: 'command', testid: 'command-palette' },
  search: { key: 'search', testid: 'search' },
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
   * Bumped on every indexed content change, from any writer. Read it inside
   * an `$effect` to re-derive anything that depends on note TEXT — the index
   * itself is a plain data structure, so this counter is the subscription.
   */
  readonly revision: number
  open(mode: PaletteMode): void
  close(): void
  setQuery(q: string): void
  pick(row: PaletteRow): void
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
    const paths = (workspace?.ui.files ?? [])
      .filter((f) => f.kind === 'text')
      .map((f) => f.path)
    const key = paths.join('\u0000')
    if (key === resolverPaths) return
    resolverPaths = key
    resolver.reset(paths)
  }

  const sink: IndexSink = {
    upsert(doc) {
      index.upsert(doc)
      revision++
    },
    remove(guid) {
      index.remove(guid)
      revision++
    },
    rename(guid, path) {
      index.rename(guid, path)
      revision++
    },
  }

  const meta = $derived(modeMeta(palette.mode ?? 'quick-open'))

  /** Set when a search result asked to land on a specific character. */
  const pending = $state<{ reveal: { offset: number } | null }>({ reveal: null })

  const openNote = (path: string, offset?: number): void => {
    if (!workspace) return
    workspace.select(path)
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

  async function buildRows(mode: PaletteMode, query: string): Promise<PaletteRow[]> {
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
      subtitle: hit.snippets.length === 0 ? getLL().web.palette.filename_match() : undefined,
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
    resolveLink(target, fromPath) {
      refreshResolver()
      return resolver.resolve(target, fromPath)
    },
    links,
    open(mode) {
      palette.mode = mode
      palette.query = ''
    },
    close() {
      palette.mode = null
    },
    setQuery(q) {
      palette.query = q
    },
    pick(row) {
      if (palette.mode === 'command') {
        palette.mode = null
        void registry.get(row.id)?.run()
        return
      }
      openNote(row.id, row.offset)
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
    { id: 'share.add', title: t.add_share(), group: g.share(), run: actions.addShare },
    // Mod+[ / Mod+] are Chris's own Obsidian bindings for navigation history.
    { id: 'nav.back', title: t.back(), group: g.navigate(), keys: 'Mod+[', run: actions.back },
    { id: 'nav.forward', title: t.forward(), group: g.navigate(), keys: 'Mod+]', run: actions.forward },
    // Chris's own Obsidian bindings for the sidebars (Mod+Left / Mod+Right).
    { id: 'view.sidebar', title: t.toggle_navigator(), group: g.view(), keys: 'Mod+ArrowLeft', run: actions.toggleSidebar },
    { id: 'view.rail', title: t.toggle_rail(), group: g.view(), keys: 'Mod+ArrowRight', run: actions.toggleRail },
    { id: 'app.settings', title: t.settings(), group: g.app(), keys: 'Mod+,', run: actions.settings },
  ]
}
