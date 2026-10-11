/**
 * The session: which vault is open, and the view that shows while none is.
 *
 * This is the shell's boot state machine, out of `App.svelte` so it can be
 * driven in a test with a `setup` that resolves, rejects or never settles.
 * Three views — `manager`, `connecting`, `workspace` — and one invariant:
 * a boot that was cancelled or superseded can neither install its workspace
 * nor touch the view, however late it settles (`bootGen`).
 *
 * The manager's own actions (open a folder, join, link a device, remove) live
 * in `manager.svelte.ts` and write `failure`, `busy` and `joining` here; this
 * module owns the transitions, not the affordances.
 */
import type { IndexSink, PullProgress, Workspace, WorkspaceConfig } from './workspace.svelte.js'
import type { VaultEntry } from './config.js'
import { touchVault } from './config.js'
import { getLL } from '@ohhi/i18n'
import { isAccessRefused } from './fs-access.js'
import type { AppConfig, MemoryModeConfig } from './params.js'
import { themePath, installUserTheme, themeState } from './theme.svelte.js'

export type SessionView = 'manager' | 'connecting' | 'workspace'

/** Boot failure surfaced on the manager — against its vault row when room is set. */
export interface BootFailure {
  room: string | null
  message: string
  /**
   * The desktop fs scope refused the vault's folder (DEL-89): the manager
   * offers "Allow access to this folder again" instead of a broken vault.
   */
  access?: true
}

/** A whole vault arriving (device-link N2): the two-phase panel's subject. */
export interface Joining {
  entry: VaultEntry
  destination: string
  /**
   * What is arriving (first-run F1): a whole vault through a device link, or
   * a folder share opened as its own vault — the panel titles them apart.
   */
  kind: 'device' | 'folder'
}

/** What the session needs from the rest of the shell. */
export interface SessionHost {
  /** The one index every workspace writes into (V2b). */
  index: IndexSink
  /** Point the index at the new vault — or at nothing, BEFORE the next one fills it. */
  attachIndex(ws: Workspace | null): void
  /** After `ui.files` exists, so the restored tree is pruned first (B6). */
  attachPanes(ws: Workspace | null, room: string): void
  /** A rename must reach the tabs in the same turn the file list changes (B6, S9-Q4). */
  onRenamed(moves: { from: string; to: string }[]): void
  userName(): string
  /** The vault to reopen on a plain launch, if any. */
  lastVault(): VaultEntry | null
  /** A registered vault just opened: refresh the manager's lists, remind about storage… */
  onOpened(ws: Workspace, entry: VaultEntry): void
  /** Injected so a test can hand back a fake, a rejection or a boot that hangs. */
  setup(cfg: WorkspaceConfig): Promise<Workspace>
  configForSession(entry: VaultEntry, user: string): Promise<WorkspaceConfig>
  configForMemory(cfg: MemoryModeConfig): Promise<WorkspaceConfig>
}

export interface Session {
  readonly view: SessionView
  readonly workspace: Workspace | null
  failure: BootFailure | null
  /** True from the first click until the boot settles (N2); the manager disables itself on it. */
  busy: boolean
  joining: Joining | null
  /** Reported from inside `setup`, before it resolves — the progress panel's feed (S10 Q4). */
  readonly pull: PullProgress | null
  /**
   * Initial routing. `deepLinked` is a share link in the URL: the manager
   * then shows with it prefilled instead of reopening the last vault.
   */
  start(config: AppConfig, deepLinked: boolean): void
  /** Boot a registered vault; failures land on the manager, never a dead end. */
  boot(entry: VaultEntry): Promise<void>
  /** Abandon the boot in flight; back to whatever was showing before. */
  cancel(): void
  showManager(): void
  /** The manager's Back — only offered when a workspace is open. */
  showWorkspace(): void
  /**
   * Tear the open workspace down NOW (its vault is about to be removed), so
   * its debounced flushes cannot write into a half-wiped namespace.
   */
  close(): void
}

export function createSession(host: SessionHost): Session {
  let view = $state<SessionView>('connecting')
  let workspace = $state.raw<Workspace | null>(null)
  let failure = $state<BootFailure | null>(null)
  let busy = $state(false)
  let joining = $state<Joining | null>(null)
  let pull = $state<PullProgress | null>(null)
  /**
   * Boot generation: bumped by cancel, by close and by every new boot, so a
   * stale `setup` settling late can neither install itself nor clobber the
   * view. A cancelled boot's workspace is disposed when it settles.
   */
  let bootGen = 0

  function install(ws: Workspace, room: string): void {
    workspace?.dispose()
    workspace = ws
    host.attachIndex(ws)
    host.attachPanes(ws, room)
    void restoreCustomTheme(ws)
  }

  /**
   * `busy` stays TRUE until this resolves (device-link N2): the join path used
   * to clear it and then await the boot, so the manager re-enabled every
   * button while a whole vault was being pulled. A first join with `joining`
   * set keeps its failure on the progress panel instead of the manager — the
   * panel offers the retry, and retrying is the right move for a stall.
   */
  async function boot(entry: VaultEntry): Promise<void> {
    const gen = ++bootGen
    view = 'connecting'
    failure = null
    busy = true
    pull = null
    // Drop the previous vault's index BEFORE the next one fills it.
    host.attachIndex(null)
    try {
      const ws = await host.setup({
        ...(await host.configForSession(entry, host.userName())),
        index: host.index,
        onPathsRenamed: (moves) => host.onRenamed(moves),
        onPull: (progress) => {
          if (gen === bootGen) pull = progress
        },
      })
      if (gen !== bootGen) {
        ws.dispose() // cancelled or superseded while awaiting
        return
      }
      install(ws, entry.room)
      touchVault(entry.room, Date.now())
      joining = null
      view = 'workspace'
      host.onOpened(ws, entry)
    } catch (err) {
      if (gen !== bootGen) return
      failure =
        entry.vault.kind === 'tauri' && isAccessRefused(err)
          ? { room: entry.room, message: getLL().web.manager.access_lost(), access: true }
          : { room: entry.room, message: err instanceof Error ? err.message : String(err) }
      if (!joining) view = 'manager'
    } finally {
      if (gen === bootGen) busy = false
    }
  }

  /** Memory URL contract (dev / Playwright L2) — bypasses the manager entirely. */
  async function bootMemory(cfg: MemoryModeConfig): Promise<void> {
    const gen = ++bootGen
    view = 'connecting'
    host.attachIndex(null)
    try {
      const ws = await host.setup({
        ...(await host.configForMemory(cfg)),
        index: host.index,
        onPathsRenamed: (moves) => host.onRenamed(moves),
      })
      if (gen !== bootGen) {
        ws.dispose()
        return
      }
      install(ws, ws.room)
      view = 'workspace'
    } catch (err) {
      if (gen !== bootGen) return
      failure = { room: null, message: err instanceof Error ? err.message : String(err) }
      view = 'manager'
    }
  }

  /**
   * The pre-paint script restores the `data-theme` attribute, but a custom
   * theme's CSS lives in the vault and cannot be read until one is open. Fetch
   * and install it as soon as it can be; a missing file leaves the attribute
   * pointing at nothing, which resolves to the contract defaults rather than
   * to a broken page.
   */
  async function restoreCustomTheme(ws: Workspace): Promise<void> {
    if (!themeState.pref.startsWith('custom:')) return
    const name = themeState.pref.slice('custom:'.length)
    try {
      const css = await ws.readAppFile(themePath(name))
      if (css) installUserTheme(css)
    } catch {
      // A vault without the theme file: the built-in defaults still apply.
    }
  }

  return {
    get view() {
      return view
    },
    get workspace() {
      return workspace
    },
    get failure() {
      return failure
    },
    set failure(next) {
      failure = next
    },
    get busy() {
      return busy
    },
    set busy(next) {
      busy = next
    },
    get joining() {
      return joining
    },
    set joining(next) {
      joining = next
    },
    get pull() {
      return pull
    },
    start(config, deepLinked) {
      if (config.kind === 'memory') {
        void bootMemory(config)
      } else if (config.kind === 'error') {
        failure = { room: null, message: config.message }
        view = 'manager'
      } else {
        const last = host.lastVault()
        if (last && !deepLinked) {
          // Attempted once; a failure routes to the manager with the error
          // shown against this entry (no reload retrap — the entry is fixable there).
          void boot(last)
        } else {
          view = 'manager'
        }
      }
    },
    boot,
    cancel() {
      bootGen++
      joining = null
      pull = null
      busy = false
      view = workspace ? 'workspace' : 'manager'
    },
    showManager() {
      view = 'manager'
    },
    showWorkspace() {
      view = 'workspace'
    },
    close() {
      ++bootGen // supersede any in-flight boot of this vault
      host.attachIndex(null)
      host.attachPanes(null, '')
      workspace?.dispose()
      workspace = null
    },
  }
}
