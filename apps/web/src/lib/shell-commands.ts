/**
 * The shell's command table and its one keyboard entry point.
 *
 * Registration ORDER is the contract here (B7, W2, X2, R1.3): the `app.*` /
 * `nav.*` / `file.*` defaults first, then `workspace.*` + `tab.*`, then
 * `group.*`, then `view.*`, so a later table's binding of a shared key wins
 * — as the registry documents — and the active keymap sits over all of them
 * (applied by `keymap.svelte.ts`, which the registry keeps across these
 * registrations). Keeping the order in one function is the point of this file.
 */
import { getLL } from '@ohhi/i18n'
import type { Command, CommandRegistry } from './commands.js'
import type { DailyShell } from './daily.svelte.js'
import type { FileActions } from './file-actions.svelte.js'
import type { GroupShell } from './group-ui.svelte.js'
import { HELP_COMMAND_IDS, type HelpCommandId } from './help.svelte.js'
import { defaultCommands, type LayoutFileSource, type PaletteMode } from './navigation.svelte.js'
import { choiceOf } from './resource-kind.js'
import type { Resources } from './resources.svelte.js'
import type { ShareActions } from './share-actions.svelte.js'
import type { ShellLayout } from './shell-layout.svelte.js'
import { containingDir } from './tree-model.js'
import { railForm } from './layout.js'
import { BUILTIN_LAYOUTS, offersView } from './layout-spec.js'
import { VIEW_KINDS, type TabView } from './panes.js'
import { viewDef } from './views.js'
import type { PaneShell } from './workspace-panes.svelte.js'

export interface ShellCommandDeps {
  registry: CommandRegistry
  openPalette(mode: PaletteMode): void
  panes: Pick<PaneShell, 'commands' | 'readCommands' | 'formatCommands' | 'travel' | 'handleKey'>
  groups: Pick<GroupShell, 'commands' | 'savedCommands'>
  daily: Pick<DailyShell, 'openToday' | 'step' | 'steps'>
  fileOps: Pick<FileActions, 'createNote' | 'op'>
  sharing: Pick<ShareActions, 'addShareOpen' | 'folderSharePath'>
  /** The open vault's mounts ('' = the root): the share sheet opens on the shared folder around a note. */
  mounts(): readonly { path: string }[]
  /** The column toggles, and the spec whose `views` decides which view commands are offered. */
  layout: Pick<ShellLayout, 'treeOpen' | 'railOpen' | 'spec'>
  /** The focused pane's active path, or null with no vault or no note. */
  selectedPath(): string | null
  /** True while a vault is open (it may be showing behind the manager). */
  hasWorkspace(): boolean
  /** True while that vault is what is on screen — the keyboard's gate. */
  inWorkspace(): boolean
  /**
   * True while a dialog or a text field owns the keyboard (M4): a command
   * that acts on the pane tree must not fire from inside it.
   */
  claimed(): boolean
  openDeviceLink(): void
  /** Open a registered view tab (`views.ts`), and whether developer tools are on (the inspector's `when`). */
  openView(id: TabView, arg?: string): void
  devtools(): boolean
  /** `app.reload-resources` (quiet-shell F9): re-read the resource roots and re-apply the layout. */
  reloadResources?(): void
  /**
   * Focus mode (quiet-shell F7): `view.focus` toggles it and `Escape` leaves
   * it. Absent → no command and no Escape handling.
   */
  focusMode?: { active(): boolean; toggle(): void; leave(): void }
  /**
   * Templates (quiet-shell F11): one palette row per file, `template:<name>`,
   * from a provider; `template.insert` opens the picker.
   */
  templates?: { commands(): Command[] }
  /**
   * Help (first-run E1): one row per `help.*` id, each running `run(id)` —
   * `runHelp` in help.svelte.ts, the function the Help menu's rows call.
   * `menuMounted` gates `help.menu`: with no Help menu on screen (a layout
   * without the `help` readout) there is nothing for it to open.
   */
  help?: { run(id: HelpCommandId): void; menuMounted(): boolean }
}

/**
 * Something on screen that Escape belongs to before Focus mode: an open menu
 * (Melt's dropdowns render in place, as `role=menu`), CodeMirror's completion
 * list, or a popover. Dialogs and text fields are `claimed()` already.
 */
export function escapeTaken(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return false
  return doc.querySelector('[role="menu"], .cm-tooltip-autocomplete, [data-melt-popover-content]') !== null
}

/** Commands that act on the pane tree — or the note — behind whatever is on top (M4). */
const WORKSPACE_COMMANDS = /^(?:workspace|tab|group|format)\./

export interface ShellCommands {
  /**
   * Global hotkeys, to be bound in the CAPTURE phase.
   *
   * Capture matters: several of Chris's own bindings collide with
   * CodeMirror's defaults — `Mod+ArrowLeft`/`Mod+ArrowRight` are his Obsidian
   * sidebar toggles AND `standardKeymap`'s word/line motion. CM6 calls
   * preventDefault but not stopPropagation, so a bubble-phase handler would
   * run the command *and* move the caret. Capturing lets an app command
   * claim the key first and stop it, which is the precedence Obsidian has.
   */
  onKeydown(e: KeyboardEvent): void
}

export function installShellCommands(deps: ShellCommandDeps): ShellCommands {
  const { registry, panes, groups, daily, fileOps, sharing, layout } = deps
  const hasVault = (): boolean => deps.hasWorkspace()
  /**
   * Which folder "Share this folder…" means: the shared folder the open note
   * is inside, else the note's own folder. The vault root is not a folder
   * that shares (it LINKS, to your own devices), so a top-level note has none.
   */
  const shareTarget = (): string | null => {
    const path = hasVault() ? deps.selectedPath() : null
    if (!path) return null
    const around = deps.mounts().find((m) => m.path !== '' && path.startsWith(`${m.path}/`))
    return around ? around.path : containingDir(path, 'text') || null
  }

  registry.register(
    ...defaultCommands({
      quickOpen: () => deps.openPalette('quick-open'),
      commandPalette: () => deps.openPalette('command'),
      search: () => deps.openPalette('search'),
      newNote: () => void fileOps.createNote(''),
      toggleSidebar: () => (layout.treeOpen = !layout.treeOpen),
      toggleRail: () => {
        // A pinned column is not collapsed — it is unpinned, from its own
        // header (Chris, 2026-10-06). Open, the sidebar key focuses it.
        if (layout.railOpen && railForm(layout.spec.regions) === 'column') {
          document.querySelector<HTMLElement>('[data-testid="right-rail"] [role="tab"][aria-selected="true"]')?.focus()
          return
        }
        layout.railOpen = !layout.railOpen
      },
      // Fork 4: back/forward walk the FOCUSED TAB's own trail, not one
      // workspace-wide list — with four panes, "back" jumping panes is a
      // surprise, and a tab replaced in place is exactly what has a trail.
      back: () => panes.travel(-1),
      forward: () => panes.travel(1),
      hasNote: () => deps.selectedPath() != null,
      deleteNote: () => {
        const path = deps.selectedPath()
        if (path) fileOps.op = { type: 'delete', path, kind: 'text' }
      },
      moveNote: () => {
        const path = deps.selectedPath()
        if (path) fileOps.op = { type: 'move', path, kind: 'text' }
      },
      newFolder: () => {
        if (hasVault()) fileOps.op = { type: 'new-folder', dir: containingDir(deps.selectedPath(), 'text') }
      },
      addShare: () => {
        if (hasVault()) sharing.addShareOpen = { dir: '' }
      },
      shareFolder: () => {
        const target = shareTarget()
        if (target) sharing.folderSharePath = target
      },
      canShareFolder: () => shareTarget() !== null,
      linkDevice: () => {
        if (hasVault()) deps.openDeviceLink()
      },
      dailyToday: () => void daily.openToday(),
      dailyPrev: () => daily.step('prev'),
      dailyNext: () => daily.step('next'),
      hasPrevDaily: () => daily.steps.prev !== null,
      hasNextDaily: () => daily.steps.next !== null,
      openView: (id, arg) => deps.openView(id, arg),
      devtools: () => deps.devtools(),
    })
  )
  // The layout's `views` (quiet-shell F1) decides which view tabs the palette
  // offers: a view it does not list keeps its tab type, loses its command.
  // An empty list offers every view.
  for (const id of VIEW_KINDS) {
    // Settings is never hidden by a layout: it is where a layout is changed back.
    if (id === 'settings') continue
    const command = registry.get(viewDef(id).command.id)
    if (!command) continue
    const when = command.when
    registry.register({ ...command, when: () => offersView(layout.spec, id) && (when ? when() : true) })
  }
  // Focus mode (quiet-shell F7, Decision 6): a window state, never saved.
  // `Mod+.` — free in every table, and a plain key on every layout (the
  // shifted `Mod+Shift+.` reads as `>` on a US board, which no binding matches).
  const focusMode = deps.focusMode
  if (focusMode) {
    const t = getLL().web.commands
    registry.register({
      id: 'view.focus',
      title: t.focus_mode(),
      group: t.groups.view(),
      keys: 'Mod+.',
      when: () => deps.hasWorkspace(),
      run: () => focusMode.toggle(),
    })
  }
  // Re-read `.ohhi/` and the user root, re-apply the layout (quiet-shell F9).
  // Desktop watches the folder too, but a watcher that fails to start fails
  // silently — this is the way back.
  const reloadResources = deps.reloadResources
  if (reloadResources) {
    const t = getLL().web.commands
    registry.register({
      id: 'app.reload-resources',
      title: t.reload_resources(),
      group: t.groups.app(),
      run: () => reloadResources(),
    })
  }
  // *Use layout file…* (round 3, Q6): the one place a layout FILE is chosen —
  // Settings › Layout edits this device's overrides and never names a file.
  {
    const t = getLL().web.commands
    registry.register({
      id: 'layout.use-file',
      title: t.layout_use_file(),
      group: t.groups.view(),
      run: () => deps.openPalette('layouts'),
    })
  }
  // Help (first-run E1): the menu's rows, one command each, so the palette
  // lists them and a keymap can bind them. App-level: they work with no vault.
  const help = deps.help
  if (help) {
    const t = getLL().web.help.commands
    const title: Record<HelpCommandId, () => string> = {
      'help.menu': t.menu,
      'help.start': t.start,
      'help.shortcuts': t.shortcuts,
      'help.recovery': t.recovery,
      'help.sharing': t.sharing,
      'help.changes': t.changes,
      'help.report': t.report,
    }
    registry.register(
      ...HELP_COMMAND_IDS.map(
        (id): Command => ({
          id,
          title: title[id](),
          group: getLL().web.commands.groups.help(),
          ...(id === 'help.menu' ? { when: () => help.menuMounted() } : {}),
          run: () => help.run(id),
        })
      )
    )
  }
  // Templates (quiet-shell F11): `template.insert` opens the picker; each file
  // is its own palette row, from a provider because the set is the folder's.
  const templates = deps.templates
  if (templates) {
    const t = getLL().web.commands
    registry.register({
      id: 'template.insert',
      title: t.template_insert(),
      group: t.groups.templates(),
      run: () => deps.openPalette('templates'),
    })
    registry.addProvider(() => templates.commands())
  }
  // Every `workspace.*` and `tab.*` row of the command table (B7). Registered
  // after the defaults so a later rebind of a shared key wins, as the registry
  // documents.
  registry.register(...panes.commands())
  // The `group.*` table (W2). Registered after the pane rows for the same
  // reason they come after the defaults: a later registration wins a shared key.
  registry.register(...groups.commands())
  // The `view.*` + `edit.toggle-checkbox` table (read X2). Same order rule.
  registry.register(...panes.readCommands())
  // The `format.*` table (quiet-shell F4). Last, so `Mod+B/I/K` are its own;
  // the editor's matching CM6 keymap never double-fires, because this handler
  // runs in the capture phase and stops the event before CM6 sees it.
  registry.register(...panes.formatCommands())
  // One palette row per SAVED group (Fork 2-A). A provider rather than
  // registrations, because the ids come and go every time a group is closed
  // or reopened — and a row nobody can predict is a row nobody can bind.
  registry.addProvider(() => groups.savedCommands())

  function onKeydown(e: KeyboardEvent): void {
    if (!deps.inWorkspace()) return
    // A live pane mode owns the keyboard: its letters are commands, not text,
    // and this handler is in the capture phase so CodeMirror never sees them.
    if (panes.handleKey(e)) return
    // Escape leaves Focus mode — unless a dialog, a field, a menu or the
    // completion list is what Escape is for right now. Capture phase, so the
    // editor never sees it; nothing else in the shell binds a bare Escape.
    if (
      e.key === 'Escape' &&
      !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey &&
      deps.focusMode?.active() &&
      !deps.claimed() &&
      !escapeTaken()
    ) {
      e.preventDefault()
      e.stopPropagation()
      deps.focusMode.leave()
      return
    }
    const command = registry.match(e)
    if (!command) return
    // …but a command that acts on the workspace must not fire from inside a
    // dialog or a text field: capture phase means `Mod+W` typed into Settings'
    // relay-URL box used to close a tab behind it (M4). Navigation and the
    // overlays themselves still answer — they are how you get out.
    //
    // Swallowed rather than let through: these are the browser's own chords
    // (`Mod+W` closes the window, `Mod+P` prints), and handing them back would
    // be a worse surprise than the command they stand in for.
    if (WORKSPACE_COMMANDS.test(command.id) && deps.claimed()) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    void command.run()
  }

  return { onKeydown }
}

/**
 * What the palette's *Use layout file…* lists and applies (round 3, Q6):
 * every layout file the roots offer — `.ohhi/layouts/*.json`, the user
 * root's, the built-in *Default* first — and the one in use marked. Picking
 * one sets `config.layout.active` (`layout.setActive`); the device's
 * overrides and pins stay laid over whichever file it is.
 */
export function layoutFileSource(
  resources: Pick<Resources, 'list'>,
  layout: Pick<ShellLayout, 'active' | 'setActive'>
): LayoutFileSource {
  return {
    async rows() {
      const entries = await resources.list('layouts')
      return entries.map((entry) => {
        const choice = choiceOf(entry, BUILTIN_LAYOUTS)
        const builtin = entry.root === 'builtin'
        return {
          name: choice,
          title: builtin ? getLL().web.palette.layouts.builtin() : entry.name,
          ...(builtin ? {} : { subtitle: entry.path }),
          active: layout.active === choice,
        }
      })
    },
    use(name) {
      const entry = name.startsWith('custom:') || (BUILTIN_LAYOUTS as readonly string[]).includes(name)
      if (entry) void layout.setActive(name as Parameters<typeof layout.setActive>[0])
    },
  }
}
