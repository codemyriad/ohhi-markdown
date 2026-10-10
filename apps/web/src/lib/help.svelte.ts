/**
 * Help (first-run-shaping E1–E3): the state behind the toolbar's Help menu,
 * the `help.*` commands and the Report a problem dialog, in one module any
 * surface can reach — the toolbar's `help` readout, the command palette, and
 * the vault manager's help icon (which has no readout context).
 *
 * For a surface outside the workspace (the manager): render
 * `<HelpMenu>` with your own trigger, or call `openHelp()` to open the
 * mounted one. `runHelp(id)` runs any menu item by its command id; the
 * palette's `help.*` rows (shell-commands.ts) call the same function, so a
 * menu item and its command are one action.
 *
 * Honesty (R5): the version line says "up to date" only when the updater's
 * last check completed and found nothing (`UpdateStatus`, updater.ts); times
 * are on the updater's injected clock.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import { sharedSnapshot, type InSyncSpan } from '@ohhi/workspace'
import { openGuide, type GuidePage } from './guide.js'
import { isTauri } from './platform.js'
import { onlinePeers } from './presence.js'
import { noteStatus } from './readout-state.js'
import { realClock } from './real-clock.js'
import { relativeTime } from './relative-time.js'
import { detectOs, type ReportFacts, type ReportVaultKind } from './report.js'
import { snapshotInput } from './shared.svelte.js'
import type { UpdateStatus } from './updater.js'
import type { Workspace } from './workspace.svelte.js'

/** Every `help.*` command id, in the menu's order (also listed in command-ids.ts). */
export const HELP_COMMAND_IDS = [
  'help.menu',
  'help.start',
  'help.shortcuts',
  'help.recovery',
  'help.sharing',
  'help.changes',
  'help.report',
] as const
export type HelpCommandId = (typeof HELP_COMMAND_IDS)[number]

/** The guide page each guide item opens. */
export const HELP_GUIDES = {
  'help.start': 'start',
  'help.recovery': 'recovery',
  'help.sharing': 'sharing',
  'help.changes': 'changes',
} as const satisfies Partial<Record<HelpCommandId, GuidePage>>

/**
 * The build's version, inlined by Vite (`define` in vite.config.ts, from the
 * release workflow's `VERSION`); '' in a local build. The desktop reads its
 * own from Tauri instead (`loadVersion`).
 */
declare const __OHHI_VERSION__: string | undefined
export const BUILD_VERSION: string = typeof __OHHI_VERSION__ === 'string' ? __OHHI_VERSION__.trim() : ''

class HelpState {
  /** The Help menu (bound to every mounted `HelpMenu`; one is on screen at a time). */
  menuOpen = $state(false)
  /** The Report a problem dialog (App.svelte mounts it). */
  reportOpen = $state(false)
  /** The running build's version; null when not known. */
  version = $state<string | null>(BUILD_VERSION || null)
  /** The updater's last outcome (desktop); `unchecked` in a browser. */
  update = $state<UpdateStatus>({ kind: 'unchecked' })
  /** How many `HelpMenu`s are mounted: `help.menu` has something to open only then. */
  menus = $state(0)
  /** The updater's clock — the version line's "checked 2 h ago" is measured on it. */
  clock: Clock = realClock
}

export const help = new HelpState()

/** What only the shell can do for a help item. */
export interface HelpHost {
  /** Settings at Keys (the settings view tab). */
  openShortcuts(): void
  /** Open a guide page; defaults to `openGuide`. */
  openGuide?(page: GuidePage): void
}

let host: HelpHost | null = null

/** App.svelte installs the shell's half at init. */
export function setHelpHost(next: HelpHost | null): void {
  host = next
}

/** Open the mounted Help menu (the manager's help icon, `help.menu`). */
export function openHelp(): void {
  help.menuOpen = true
}

/** Open the Report a problem dialog. */
export function openReport(): void {
  help.menuOpen = false
  help.reportOpen = true
}

/** Run one help item by its command id: the menu and the palette both come here. */
export function runHelp(id: HelpCommandId): void {
  switch (id) {
    case 'help.menu':
      openHelp()
      return
    case 'help.shortcuts':
      help.menuOpen = false
      host?.openShortcuts()
      return
    case 'help.report':
      openReport()
      return
    default: {
      help.menuOpen = false
      const page = HELP_GUIDES[id]
      if (host?.openGuide) host.openGuide(page)
      else void openGuide(page)
    }
  }
}

/** Read the desktop build's own version (Settings › About shows the same). */
export async function loadVersion(): Promise<void> {
  if (!isTauri()) return
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    help.version = await getVersion()
  } catch {
    // Not known: the line says so rather than guessing.
  }
}

/**
 * The Help menu's foot (E1): the version and the last check's honest
 * outcome. Pure over its inputs.
 */
export function versionLine(
  version: string | null,
  update: UpdateStatus,
  now: number,
  LL: TranslationFunctions = getLL()
): string {
  const t = LL.web.help.version
  if (!version) return t.unknown()
  switch (update.kind) {
    case 'unchecked':
      return t.plain({ version })
    case 'current':
      return t.current({ version, when: relativeTime(update.checkedAt, now, LL) })
    case 'failed':
      return update.lastCheckedAt === null
        ? t.failed_never({ version })
        : t.failed({ version, when: relativeTime(update.lastCheckedAt, now, LL) })
    case 'found':
      return t.found({ version, next: update.version })
    case 'ready':
      return t.ready({ version })
  }
}

/**
 * The report's facts from the open workspace (E3) — metadata only, never a
 * note's text (see report.ts). `vault` is the shell's name and kind for it.
 */
export function collectReportFacts(
  ws: Workspace | null,
  extra: { vault: { name: string; kind: ReportVaultKind } | null; inSyncByRoom: Record<string, InSyncSpan> }
): ReportFacts {
  const base = { version: help.version, desktop: isTauri(), os: detectOs(), vault: extra.vault }
  if (!ws) return { ...base, relays: [], note: null, people: 0, events: [] }
  const snapshot = sharedSnapshot(snapshotInput(ws, { inSyncByRoom: extra.inSyncByRoom }))
  const path = ws.ui.selectedPath
  return {
    ...base,
    relays: snapshot.relays,
    note: path ? { path, status: noteStatus(ws.ui.files, ws.ui.records, path) } : null,
    people: onlinePeers(ws.ui.presenceByRoom, ws.user.name).length,
    events: ws.ui.events,
  }
}
