/**
 * The shell's half of daily notes (v2-shaping B5, slice W3).
 *
 * `daily-notes.ts` is pure: it formats, parses and orders. This is the thin
 * layer that gives it a vault — which config file to read, which files
 * exist, which note is focused, and what "today" is — and exposes the three
 * verbs the command table binds (`file.daily-today`, `nav.daily-prev/next`).
 *
 * Everything it needs from the shell arrives through `DailyHost`, so a test
 * can drive it with a fake vault and a pinned clock (golden rule 5) and never
 * mounts a component.
 */
import { getLL } from '@ohhi/i18n'
import type { FileRow } from '@ohhi/workspace'
import {
  DAILY_DEFAULTS,
  dailyPath,
  dateOfPath,
  findDaily,
  loadDailyConfig,
  neighbours,
  today,
  unsupportedTokens,
  type DailyConfig,
} from './daily-notes.js'
import type { NoticeInput } from './notices.js'
import { textPaths } from './workspace.svelte.js'

/** The four things daily notes read or call on the workspace facade. */
export interface DailyWorkspace {
  ui: { files: readonly FileRow[]; selectedPath: string | null }
  readAppFile(path: string): Promise<string | null>
  createFile(dir?: string, name?: string, text?: string): Promise<string | null>
  notify(input: NoticeInput): void
}

export interface DailyHost {
  /** The open vault, or null between vaults. Read reactively — a getter, not a value. */
  workspace(): DailyWorkspace | null
  /** Every "open this note" in the shell goes through one door (Fork 1-B). */
  open(path: string): void
  /** Wall clock in ms; injected so a test can pin the day. */
  now(): number
}

export interface DailyShell {
  /** The vault's `daily-notes.json`; `DAILY_DEFAULTS` until it answers (and if it is absent). */
  readonly config: DailyConfig
  /**
   * The memoized neighbours, for the `when` guards that run on EVERY keypress
   * (via `registry.match`): those must never rescan the vault.
   */
  readonly steps: { prev: string | null; next: string | null }
  /**
   * The dailies either side of where we are — from the focused note's own
   * date when it is a daily, else from today. Computed fresh because the day
   * can turn over while the app is open.
   */
  neighbours(): { prev: string | null; next: string | null }
  /** Today's daily note, created if it is not there yet. */
  openToday(): Promise<void>
  /** Walk to the neighbouring daily; a no-op at either end (the guards agree). */
  step(side: 'prev' | 'next'): void
}

export function createDaily(host: DailyHost): DailyShell {
  /** Read once per vault. */
  let config = $state<DailyConfig>(DAILY_DEFAULTS)

  $effect(() => {
    const ws = host.workspace()
    if (!ws) return
    let live = true
    void loadDailyConfig((path) => ws.readAppFile(path)).then((cfg) => {
      if (!live) return
      config = cfg
      // A format with tokens we do not implement prints them as written, so
      // Editor and Obsidian would disagree about which file today is with no
      // symptom but a stray note. Say it once, where the session's notices
      // are (Minor 17).
      const unsupported = unsupportedTokens(cfg.format)
      if (unsupported.length > 0) {
        ws.notify({
          level: 'warn',
          text: getLL().web.daily.unsupported_format({
            format: cfg.format,
            tokens: unsupported.join(', '),
          }),
        })
      }
    })
    return () => {
      live = false
    }
  })

  function dailyNeighbours(): { prev: string | null; next: string | null } {
    const ws = host.workspace()
    if (!ws) return { prev: null, next: null }
    const from = dateOfPath(config, ws.ui.selectedPath) ?? today(() => host.now())
    return neighbours(config, textPaths(ws.ui.files), from)
  }
  const steps = $derived(dailyNeighbours())

  /**
   * Empty, as Obsidian creates it with no template configured — Chris has
   * none.
   */
  async function openToday(): Promise<void> {
    const ws = host.workspace()
    if (!ws) return
    const date = today(() => host.now())
    // Matched on the DATE, not on the formatted name (Minor 16): the parser
    // is padding-tolerant, so an older `Daily/03-01-2025.md` IS that day's
    // note even though `DD-M-Y` would write it `03-1-2025`.
    const existing = findDaily(config, textPaths(ws.ui.files), date)
    if (existing) {
      host.open(existing)
      return
    }
    const path = dailyPath(config, date)
    const cut = path.lastIndexOf('/')
    // createFile answers with the path and opens nothing — WHERE a new note
    // lands is the shell's call now (tab-groups B5). It adopts a file already
    // on disk rather than clobbering it, so a note Obsidian wrote today opens
    // untouched.
    const created = await ws.createFile(cut === -1 ? '' : path.slice(0, cut), path.slice(cut + 1))
    if (created) host.open(created)
  }

  return {
    get config() {
      return config
    },
    get steps() {
      return steps
    },
    neighbours: dailyNeighbours,
    openToday,
    // Fresh, not `steps`: the guard's memo is for the keypress path, the step
    // itself must be right even if a day turned over since.
    step: (side) => {
      const path = dailyNeighbours()[side]
      if (path) host.open(path)
    },
  }
}
