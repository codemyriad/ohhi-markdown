/**
 * Settings › Keys writes through (settings-shaping ST3, Fork 2): no draft,
 * no Save. Each change is written to a keymap file at once — through
 * `Keymap.save` → `Resources.saveKeymap` → `Workspace.writeAppFile`, so the
 * bytes it replaces are journaled first and the write is atomic (golden
 * rule 1) — and the keymap is re-applied, so the new key works straight away.
 *
 * Where a change lands:
 *  - the active keymap is a vault file the app may write → that file,
 *    `extends` kept;
 *  - it is read-only — the built-in `default`, a file in the user root, or a
 *    vault file named after a built-in (read, never written) — → the first
 *    change creates `.ohhi/keymaps/mine.json` (`mine-2.json`, … when the name
 *    is taken in any root) that `extends` the active keymap and holds only
 *    that change, and makes it active; every later change writes it;
 *  - the active keymap failed to resolve (`unresolved`), or no vault is open
 *    → nothing: a file extending it would not resolve either.
 *
 * **Undo** puts the previous state back: before each write the file's
 * current bytes are read (the same bytes the journal records as the write's
 * pre-image) and kept here with the keymap that was active; Undo rewrites
 * those bytes through the journal — or removes the file the change created —
 * and re-selects that keymap (`Keymap.restore`), but only while that is
 * honest:
 *  - the file must still hold exactly the bytes the write left
 *    (`Resources.written`); an agent, an editor or another device writing it
 *    since makes Undo refuse (`stale`) rather than write over theirs, and the
 *    rest of the stack goes with it (every older entry is older still);
 *  - the keymap choice moves back only if it is still the one the write made
 *    active — a keymap picked since stays picked.
 * The workspace has no restore-from-journal call for `.ohhi/` files (only
 * for notes), so Undo holds its own copy of the pre-image rather than asking
 * the journal for it; the journal still has every version either way. The
 * stack lives as long as the Keys section does.
 *
 * A change to the active file is built from its bytes on disk, read just
 * before the write — not from the copy the keymap last resolved, which can
 * be up to a watcher's debounce behind — so an agent's edit a moment before
 * is kept, not overwritten.
 */
import { getLL } from '@ohhi/i18n'
import { aiEnabled } from './ai-config.svelte.js'
import type { CommandBinding, CommandRegistry } from './commands.js'
import { offeredRows } from './hotkey-rows.js'
import {
  BUILTIN_KEYMAPS,
  keymapFile,
  keymapName,
  ownBindings,
  parseKeymap,
  type KeymapBindings,
  type KeymapChoice,
} from './keymap-spec.js'
import type { Keymap } from './keymap.svelte.js'
import { StaleUndoError, type ResourceEntry, type Resources } from './resources.svelte.js'
import { savableName } from './resource-kind.js'

export interface HotkeyWriterHost {
  registry: Pick<CommandRegistry, 'bindings'>
  keymap: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'save' | 'restore'>
  resources?: Partial<Pick<Resources, 'refreshKeymaps' | 'read' | 'written'>>
  /** The legacy per-device map, as bindings — what is in force in legacy mode. */
  legacy(): KeymapBindings
  /** A vault is open: there is somewhere to write a keymap file. */
  canSave(): boolean
}

/** What one write replaced — enough to put it back, and to know when that is no longer safe. */
interface UndoEntry {
  /** The command the write changed. */
  id: string
  name: string
  /** The file's bytes before the write; null = the write created it. */
  text: string | null
  /** The keymap that was active before. */
  choice: KeymapChoice
  /** The keymap the write made active. */
  madeActive: KeymapChoice
  /** The bytes the write left (`Resources.written`); undefined = unknown, not checked. */
  written: string | null | undefined
}

/** The outcome of the last write, for the status line. */
export interface HotkeyWrite {
  /** The command changed, and the keys it has now (`[]` = none). */
  id: string
  chords: string[]
  path: string
  /** This write created the file (the "saved in mine.json" moment). */
  created: boolean
}

/**
 * Why the last action did not happen: a write that failed, an Undo that
 * failed, or an Undo refused because the file changed since (`path`).
 */
export type HotkeyProblem =
  | { kind: 'save'; message: string }
  | { kind: 'undo'; message: string }
  | { kind: 'stale'; path: string }

/** The name a new personal keymap is written under: `mine`, else the first free `mine-N`. */
export function personalName(taken: ReadonlySet<string>): string {
  if (!taken.has('mine')) return 'mine'
  let n = 2
  while (taken.has(`mine-${n}`)) n++
  return `mine-${n}`
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export function createHotkeyWriter(host: HotkeyWriterHost) {
  const resolved = () => (host.keymap.legacy ? null : host.keymap.resolved)

  /** The bindings in force — what the rows show. */
  const inForce = $derived<KeymapBindings>(host.keymap.legacy ? host.legacy() : (host.keymap.resolved?.bindings ?? {}))

  /** The active keymap fell back (a missing or invalid file): why — nothing can be written over it. */
  const unresolved = $derived(resolved()?.error ?? null)
  /** The active file is the vault's but named after a built-in: read, never written. */
  const shadowsBuiltin = $derived(
    resolved()?.entry?.root === 'vault' && !savableName(resolved()!.entry!.name, BUILTIN_KEYMAPS)
  )
  /** A change writes the active file itself (else it creates `mine.json`). */
  const writable = $derived(resolved()?.entry?.root === 'vault' && !shadowsBuiltin)

  let undoStack = $state<UndoEntry[]>([])
  let last = $state<HotkeyWrite | null>(null)
  /** The last Undo: the command it put back and the file. */
  let undone = $state<{ id: string; path: string } | null>(null)
  let problem = $state<HotkeyProblem | null>(null)
  /** Writes run one at a time, in order: two quick changes never race for the same file. */
  let queue: Promise<unknown> = Promise.resolve()

  function serial<T>(job: () => Promise<T>): Promise<T> {
    const run = queue.then(job, job)
    queue = run.catch(() => {})
    return run
  }

  /** What the parent chain (or the command's default) gives `id` — writing it back is the same as no entry. */
  function inherited(row: Pick<CommandBinding, 'id' | 'defaultKeys'>): string[] {
    const parent = resolved()?.parent ?? {}
    if (Object.hasOwn(parent, row.id)) return [...parent[row.id]!]
    return row.defaultKeys ? [row.defaultKeys] : []
  }

  /** The file's bytes in the vault now, or null when the vault has no such file. */
  async function preImage(name: string): Promise<string | null> {
    const found = await host.resources?.read?.('keymaps', name)
    return found && found.entry.root === 'vault' ? found.text : null
  }

  async function write(row: Pick<CommandBinding, 'id' | 'defaultKeys'>, chords: string[]): Promise<HotkeyWrite> {
    if (!host.canSave()) throw new Error(getLL().web.keymaps.needs_vault())
    if (unresolved) throw new Error(unresolved)
    const choice = host.keymap.active
    let name: string
    let file
    let text: string | null
    const created = !writable
    if (writable) {
      const active = resolved()!
      name = keymapName(choice)
      text = await preImage(name)
      // The file as it is on disk now; the resolved copy only if it cannot be read as a keymap.
      const parsed = text === null ? null : parseKeymap(text)
      const base = parsed?.ok ? parsed.keymap : active.file
      const own = ownBindings(base)
      if (same(chords, inherited(row))) delete own[row.id]
      else own[row.id] = [...chords]
      file = keymapFile(own, base.extends)
    } else {
      const entries: ResourceEntry[] = (await host.resources?.refreshKeymaps?.()) ?? []
      name = personalName(new Set(entries.map((e) => e.name)))
      const own: KeymapBindings = host.keymap.legacy ? host.legacy() : {}
      own[row.id] = [...chords]
      file = keymapFile(own, host.keymap.legacy ? 'default' : keymapName(choice))
      text = await preImage(name)
    }
    const path = await host.keymap.save(name, file)
    const madeActive: KeymapChoice = `custom:${name}`
    undoStack = [...undoStack, { id: row.id, name, text, choice, madeActive, written: host.resources?.written?.(path) }]
    return { id: row.id, chords: [...chords], path, created: created && text === null }
  }

  function track(job: () => Promise<HotkeyWrite>): Promise<void> {
    return serial(async () => {
      problem = null
      try {
        last = await job()
        undone = null
      } catch (err) {
        problem = { kind: 'save', message: messageOf(err) }
      }
    })
  }

  return {
    /** The rows under the keymap in force. */
    rows(): CommandBinding[] {
      return offeredRows(host.registry.bindings(inForce), aiEnabled())
    },
    get inForce() {
      return inForce
    },
    get writable() {
      return writable
    },
    get shadowsBuiltin() {
      return shadowsBuiltin
    },
    get unresolved() {
      return unresolved
    },
    /** A change can be written now (a vault is open and the keymap resolved). */
    get canWrite() {
      return host.canSave() && unresolved === null
    },
    get last() {
      return last
    },
    /** The last Undo, until the next write: the command it put back, and the file. */
    get undone() {
      return undone
    },
    get problem() {
      return problem
    },
    get canUndo() {
      return undoStack.length > 0
    },
    /** Bind `row` to `chords` (`[]` = no key), written at once. */
    set: (row: Pick<CommandBinding, 'id' | 'defaultKeys'>, chords: string[]): Promise<void> =>
      track(() => write(row, chords)),
    /** Back to what the command ships with. */
    reset: (row: Pick<CommandBinding, 'id' | 'defaultKeys'>): Promise<void> =>
      track(() => write(row, row.defaultKeys ? [row.defaultKeys] : [])),
    /** Put back what the latest write replaced (see the module doc for when it refuses). */
    undo: (): Promise<void> =>
      serial(async () => {
        const entry = undoStack.at(-1)
        if (!entry) return
        problem = null
        // A keymap picked since the write stays picked.
        const choice = host.keymap.active === entry.madeActive ? entry.choice : null
        try {
          await host.keymap.restore(entry.name, entry.text, choice, entry.written)
          undoStack = undoStack.slice(0, -1)
          last = null
          undone = { id: entry.id, path: `.ohhi/keymaps/${entry.name}.json` }
        } catch (err) {
          if (err instanceof StaleUndoError) {
            undoStack = []
            problem = { kind: 'stale', path: err.path }
          } else problem = { kind: 'undo', message: messageOf(err) }
        }
      }),
  }
}

export type HotkeyWriter = ReturnType<typeof createHotkeyWriter>
