/**
 * Harness for the shell's action layers (`share-actions.svelte.ts`,
 * `file-actions.svelte.ts`): a reactive stand-in for the workspace facade
 * that records every mutating call, and an effect root so the layers'
 * `$derived`s settle without a component (the `panes-shell.fixture` pattern).
 */
import { flushSync } from 'svelte'
import type { FileRow } from '@ohhi/workspace'
import type { NoticeInput } from './notices.js'
import type { MountInfo, Workspace } from './workspace.svelte.js'

export interface ActionsWorkspace {
  ui: { files: FileRow[]; selectedPath: string | null; mounts: MountInfo[] }
  room: string
  /** Every mutating call, as `name(arg, …)` strings, in order. */
  readonly calls: string[]
  readonly notices: NoticeInput[]
  /** Which `movePath` calls `isCrossMount` says yes to. */
  crossMount: (from: string, to: string) => boolean
  /** Make the next call of this name reject. */
  failNext: (name: string, message: string) => void
  asWorkspace(): Workspace
}

export function mount(path: string, room: string, provenance: MountInfo['provenance'] = 'carved'): MountInfo {
  return { path, room, provenance, link: null, status: 'synced', foreign: false } as unknown as MountInfo
}

export function actionsWorkspace(
  paths: string[],
  mounts: MountInfo[] = [],
  room = 'root-room'
): ActionsWorkspace {
  const rows = (list: string[]): FileRow[] =>
    list.map((path) => ({ path, guid: `g:${path}`, kind: 'text' as const }))
  const ui = $state({ files: rows(paths), selectedPath: null as string | null, mounts })
  const calls: string[] = []
  const notices: NoticeInput[] = []
  const failures = new Map<string, string>()
  const record =
    <T>(name: string, result: (...args: string[]) => T) =>
    async (...args: string[]): Promise<T> => {
      calls.push(`${name}(${args.join(', ')})`)
      const fail = failures.get(name)
      if (fail) {
        failures.delete(name)
        throw new Error(fail)
      }
      return result(...args)
    }
  const fake: ActionsWorkspace = {
    ui,
    room,
    calls,
    notices,
    crossMount: () => false,
    failNext: (name, message) => failures.set(name, message),
    asWorkspace: () =>
      ({
        ui,
        room,
        notify: (input: NoticeInput) => notices.push(input),
        createFile: record('createFile', (dir = '', name = 'untitled-1.md') =>
          dir ? `${dir}/${name}` : name
        ),
        createDir: record('createDir', () => undefined),
        renamePath: record('renamePath', () => undefined),
        movePath: record('movePath', () => undefined),
        deletePath: record('deletePath', () => undefined),
        isCrossMount: (from: string, to: string) => fake.crossMount(from, to),
        carveFolder: record('carveFolder', (path) => `share:${path}`),
        linkDevice: record('linkDevice', (label) => `device:${label}`),
        addMountLink: record('addMountLink', () => undefined),
        unshare: record('unshare', () => undefined),
        unmount: record('unmount', () => undefined),
      }) as unknown as Workspace,
  }
  return fake
}

export interface ActionsHarness<T> {
  actions: T
  flush(): void
  stop(): void
}

/** Build an action layer inside an effect root, so its `$derived`s run unmounted. */
export function withActions<T>(make: () => T): ActionsHarness<T> {
  let actions!: T
  const stop = $effect.root(() => {
    actions = make()
  })
  return { actions, flush: flushSync, stop }
}
