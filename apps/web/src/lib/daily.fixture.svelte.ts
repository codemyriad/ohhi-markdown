/**
 * Harness for the daily-notes shell layer (`daily.svelte.ts`).
 *
 * Runes are compile-time, so the reactive stand-in for the workspace and the
 * effect root live in this `.svelte.ts` file; the suite that uses them stays
 * an ordinary `.test.ts` (the `panes-shell.fixture` pattern).
 */
import { flushSync } from 'svelte'
import type { FileRow } from '@ohhi/workspace'
import { DAILY_CONFIG_PATH } from './daily-notes.js'
import { createDaily, type DailyShell, type DailyWorkspace } from './daily.svelte.js'
import type { NoticeInput } from './notices.js'

export interface FakeDailyWorkspace extends DailyWorkspace {
  ui: { files: FileRow[]; selectedPath: string | null }
  /** Every notice raised, in order. */
  readonly notices: NoticeInput[]
  /** Every `createFile(dir, name)` call, in order. */
  readonly created: { dir: string; name: string }[]
  setFiles(paths: string[]): void
}

/** A vault with these files and, optionally, a `daily-notes.json`. */
export function fakeDailyWorkspace(
  paths: string[],
  config: { format: string; folder: string } | null
): FakeDailyWorkspace {
  const rows = (list: string[]): FileRow[] =>
    list.map((path) => ({ path, guid: `g:${path}`, kind: 'text' as const }))
  const ui = $state({ files: rows(paths), selectedPath: null as string | null })
  const notices: NoticeInput[] = []
  const created: { dir: string; name: string }[] = []
  return {
    ui,
    notices,
    created,
    setFiles: (list) => {
      ui.files = rows(list)
    },
    readAppFile: async (path) =>
      path === DAILY_CONFIG_PATH && config ? JSON.stringify(config) : null,
    createFile: async (dir = '', name = 'untitled.md') => {
      created.push({ dir, name })
      const path = dir ? `${dir}/${name}` : name
      ui.files = [...ui.files, ...rows([path])]
      return path
    },
    notify: (input) => {
      notices.push(input)
    },
  }
}

export interface DailyHarness {
  daily: DailyShell
  /** Swap the vault the shell sees (null between vaults). */
  setWorkspace(ws: DailyWorkspace | null): void
  /** The note the shell was asked to open, newest last. */
  readonly opened: string[]
  /** Run pending effects and derivations. */
  flush(): void
  stop(): void
}

export function withDaily(now: () => number, initial: DailyWorkspace | null = null): DailyHarness {
  let workspace = $state.raw<DailyWorkspace | null>(initial)
  const opened: string[] = []
  let daily!: DailyShell
  const stop = $effect.root(() => {
    daily = createDaily({
      workspace: () => workspace,
      open: (path) => opened.push(path),
      now,
    })
  })
  return {
    daily,
    setWorkspace: (ws) => {
      workspace = ws
    },
    opened,
    flush: flushSync,
    stop,
  }
}
