/**
 * The shell's command table and its one keyboard entry point.
 *
 * Registration ORDER is the contract here (B7, W2, X2, R1.3): the `app.*` /
 * `nav.*` / `file.*` defaults first, then `workspace.*` + `tab.*`, then
 * `group.*`, then `view.*`, so a later table's binding of a shared key wins
 * — as the registry documents — and the user's own overrides sit over all of
 * them. Keeping the order in one function is the point of this file.
 */
import type { CommandRegistry } from './commands.js'
import type { DailyShell } from './daily.svelte.js'
import type { FileActions } from './file-actions.svelte.js'
import type { GroupShell } from './group-ui.svelte.js'
import { defaultCommands, type PaletteMode } from './navigation.svelte.js'
import type { ShareActions } from './share-actions.svelte.js'
import type { ShellLayout } from './shell-layout.svelte.js'
import { containingDir } from './tree-model.js'
import type { PaneShell } from './workspace-panes.svelte.js'

export interface ShellCommandDeps {
  registry: CommandRegistry
  openPalette(mode: PaletteMode): void
  panes: Pick<PaneShell, 'commands' | 'readCommands' | 'travel' | 'handleKey'>
  groups: Pick<GroupShell, 'commands' | 'savedCommands'>
  daily: Pick<DailyShell, 'openToday' | 'step' | 'steps'>
  fileOps: Pick<FileActions, 'createNote' | 'op'>
  sharing: Pick<ShareActions, 'addShareOpen'>
  layout: Pick<ShellLayout, 'treeOpen' | 'railOpen'>
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
  /** The user's own bindings, over the defaults (R1.3). */
  overrides(): unknown
  openSettings(): void
  openDeviceLink(): void
}

/** Commands that act on the pane tree behind whatever is on top (M4). */
const WORKSPACE_COMMANDS = /^(?:workspace|tab|group)\./

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

  registry.register(
    ...defaultCommands({
      quickOpen: () => deps.openPalette('quick-open'),
      commandPalette: () => deps.openPalette('command'),
      search: () => deps.openPalette('search'),
      newNote: () => void fileOps.createNote(''),
      toggleSidebar: () => (layout.treeOpen = !layout.treeOpen),
      toggleRail: () => (layout.railOpen = !layout.railOpen),
      settings: () => deps.openSettings(),
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
      linkDevice: () => {
        if (hasVault()) deps.openDeviceLink()
      },
      dailyToday: () => void daily.openToday(),
      dailyPrev: () => daily.step('prev'),
      dailyNext: () => daily.step('next'),
      hasPrevDaily: () => daily.steps.prev !== null,
      hasNextDaily: () => daily.steps.next !== null,
    })
  )
  // Every `workspace.*` and `tab.*` row of the command table (B7). Registered
  // after the defaults so a later rebind of a shared key wins, as the registry
  // documents.
  registry.register(...panes.commands())
  // The `group.*` table (W2). Registered after the pane rows for the same
  // reason they come after the defaults: a later registration wins a shared key.
  registry.register(...groups.commands())
  // The `view.*` + `edit.toggle-checkbox` table (read X2). Same order rule.
  registry.register(...panes.readCommands())
  // One palette row per SAVED group (Fork 2-A). A provider rather than
  // registrations, because the ids come and go every time a group is closed
  // or reopened — and a row nobody can predict is a row nobody can bind.
  registry.addProvider(() => groups.savedCommands())
  // The user's own bindings sit over those defaults (R1.3). Settings writes
  // config and re-applies them itself, so this is the boot read.
  registry.setOverrides(deps.overrides())

  function onKeydown(e: KeyboardEvent): void {
    if (!deps.inWorkspace()) return
    // A live pane mode owns the keyboard: its letters are commands, not text,
    // and this handler is in the capture phase so CodeMirror never sees them.
    if (panes.handleKey(e)) return
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
