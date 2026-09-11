/**
 * Harness for the pane CONTROLLER (`workspace-panes.svelte.ts`).
 *
 * The controller is the one module in the pane feature that is neither pure
 * nor a component: it creates `$effect`s and reads a live workspace. Runes are
 * compile-time, so this file is `.svelte.ts` (which the vite plugin compiles)
 * and the suite that uses it stays an ordinary `.test.ts`.
 *
 * Two things live here and nowhere else: an effect root, so the controller's
 * effects run without mounting a component, and a reactive stand-in for the
 * workspace facade — the shim itself boots a vault, and the controller only
 * ever reads four things off it.
 */
import { flushSync } from 'svelte'
import type { FileRow } from '@editor/workspace'
import { CommandRegistry } from './commands.js'
import type { Workspace } from './workspace.svelte.js'
import { createPanes, type PaneShell } from './workspace-panes.svelte.js'
import type { Clock } from '@editor/testkit'

/** Everything the controller reads or writes on the facade, and nothing else. */
export interface FakeWorkspace {
  ui: { files: FileRow[]; selectedPath: string | null; settling: boolean }
  setLiveViews(paths: ReadonlySet<string>): void
  /** Every set handed to `setLiveViews`, in order — the S9 seam, observed. */
  readonly liveViews: string[][]
  /** Replace the file list the way a tree refresh does. */
  setFiles(paths: string[]): void
  asWorkspace(): Workspace
}

export function fakeWorkspace(paths: string[] = []): FakeWorkspace {
  const rows = (list: string[]): FileRow[] =>
    list.map((path) => ({ path, guid: `g:${path}`, kind: 'text' as const }))
  const ui = $state({
    files: rows(paths),
    selectedPath: null as string | null,
    settling: false,
  })
  const liveViews: string[][] = []
  const fake: FakeWorkspace = {
    ui,
    setLiveViews: (next) => liveViews.push([...next].sort()),
    get liveViews() {
      return liveViews
    },
    setFiles: (list) => {
      ui.files = rows(list)
    },
    asWorkspace: () => fake as unknown as Workspace,
  }
  return fake
}

export interface PanesHarness {
  panes: PaneShell
  registry: CommandRegistry
  /**
   * Run the controller's pending effects. Svelte batches them, so a test that
   * changes state and asserts in the same tick would be reading the value from
   * before the derivation ran.
   */
  flush(): void
  stop(): void
}

/** A controller inside an effect root, so its `$effect`s run unmounted. */
export function withPanes(
  clock: Clock,
  ids: () => string,
  registry = new CommandRegistry(false)
): PanesHarness {
  let panes!: PaneShell
  const stop = $effect.root(() => {
    panes = createPanes(clock, registry, ids)
  })
  return { panes, registry, flush: flushSync, stop }
}
