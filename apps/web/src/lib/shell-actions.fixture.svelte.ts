/**
 * Harness for the shell's action layers (`share-actions.svelte.ts`,
 * `file-actions.svelte.ts`): a reactive stand-in for the workspace facade
 * that records every mutating call, and an effect root so the layers'
 * `$derived`s settle without a component (the `panes-shell.fixture` pattern).
 */
import { flushSync } from 'svelte'
import type { EngineDoc } from '@ohhi/sync'
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
  /**
   * Live docs by path: `docForPath` answers from here, and a rename or move
   * carries the entry (and the row) to its new path, as the vault's does.
   */
  readonly docs: Map<string, FakeDoc>
  asWorkspace(): Workspace
}

/** A text doc with just what a link rewrite uses: the text, and one transaction over it. */
export interface FakeDoc extends Pick<EngineDoc, 'guid' | 'getText' | 'transact'> {
  /** Every transaction's origin, in order — one `'local'` per note is the contract. */
  readonly origins: string[]
}

export function fakeDoc(guid: string, text: string): FakeDoc {
  let current = text
  const origins: string[] = []
  return {
    guid,
    origins,
    getText: () => current,
    transact: (fn, origin) => {
      origins.push(origin)
      fn({
        insert: (index, s) => {
          current = current.slice(0, index) + s + current.slice(index)
        },
        delete: (index, length) => {
          current = current.slice(0, index) + current.slice(index + length)
        },
      })
    },
  }
}

export function mount(path: string, room: string, provenance: MountInfo['provenance'] = 'carved'): MountInfo {
  return { path, room, provenance, link: null, status: 'synced', foreign: false, relay: `wss://relay.of/${room}` } as unknown as MountInfo
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
  const docs = new Map<string, FakeDoc>()
  /** A rename or move lands: the row and the doc follow the path, deep for a folder. */
  const relocate = (from: string, to: string): void => {
    const moved = (p: string): string | null => (p === from ? to : p.startsWith(`${from}/`) ? `${to}${p.slice(from.length)}` : null)
    ui.files = ui.files.map((f) => {
      const next = moved(f.path)
      return next === null ? f : { ...f, path: next }
    })
    for (const [path, doc] of [...docs]) {
      const next = moved(path)
      if (next === null) continue
      docs.delete(path)
      docs.set(next, doc)
    }
  }
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
    docs,
    asWorkspace: () =>
      ({
        ui,
        room,
        notify: (input: NoticeInput) => notices.push(input),
        flash: () => {},
        docForPath: (path: string) => docs.get(path) ?? null,
        createFile: record('createFile', (dir = '', name = 'untitled-1.md') =>
          dir ? `${dir}/${name}` : name
        ),
        createDir: record('createDir', () => undefined),
        renamePath: record('renamePath', (from, to) => relocate(from, to)),
        movePath: record('movePath', (from, to) => relocate(from, to)),
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

/** A reactive cell a `.test.ts` can write to and have a layer's `$effect`s see. */
export function box<T>(initial: T): { value: T } {
  let value = $state.raw(initial)
  return {
    get value() {
      return value
    },
    set value(next) {
      value = next
    },
  }
}
