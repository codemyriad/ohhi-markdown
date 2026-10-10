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
 * and re-selects that keymap (`Keymap.restore`). The workspace has no
 * restore-from-journal call for `.ohhi/` files (only for notes), so Undo
 * holds its own copy of the pre-image rather than asking the journal for it;
 * the journal still has every version either way. The stack lives as long as
 * the Keys section does.
 */
import type { CommandBinding, CommandRegistry } from './commands.js'
import { BUILTIN_KEYMAPS, keymapFile, keymapName, ownBindings, type KeymapBindings, type KeymapChoice } from './keymap-spec.js'
import type { Keymap } from './keymap.svelte.js'
import type { ResourceEntry, Resources } from './resources.svelte.js'
import { savableName } from './resource-kind.js'

export interface HotkeyWriterHost {
  registry: Pick<CommandRegistry, 'bindings'>
  keymap: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'save' | 'restore'>
  resources?: Partial<Pick<Resources, 'refreshKeymaps' | 'read'>>
  /** The legacy per-device map, as bindings — what is in force in legacy mode. */
  legacy(): KeymapBindings
  /** A vault is open: there is somewhere to write a keymap file. */
  canSave(): boolean
}

/** What one write replaced — enough to put it back. */
interface UndoEntry {
  name: string
  /** The file's bytes before the write; null = the write created it. */
  text: string | null
  /** The keymap that was active before. */
  choice: KeymapChoice
}

/** The outcome of the last write, for the status line. */
export interface HotkeyWrite {
  path: string
  /** This write created the file (the "saved in mine.json" moment). */
  created: boolean
}

/** The name a new personal keymap is written under: `mine`, else the first free `mine-N`. */
export function personalName(taken: ReadonlySet<string>): string {
  if (!taken.has('mine')) return 'mine'
  let n = 2
  while (taken.has(`mine-${n}`)) n++
  return `mine-${n}`
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i])

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
  let undone = $state(false)
  let error = $state('')
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
    if (!host.canSave()) throw new Error('no vault')
    if (unresolved) throw new Error(unresolved)
    const choice = host.keymap.active
    let name: string
    let file
    const created = !writable
    if (writable) {
      const active = resolved()!
      name = keymapName(choice)
      const own = ownBindings(active.file)
      if (same(chords, inherited(row))) delete own[row.id]
      else own[row.id] = [...chords]
      file = keymapFile(own, active.file.extends)
    } else {
      const entries: ResourceEntry[] = (await host.resources?.refreshKeymaps?.()) ?? []
      name = personalName(new Set(entries.map((e) => e.name)))
      const own: KeymapBindings = host.keymap.legacy ? host.legacy() : {}
      own[row.id] = [...chords]
      file = keymapFile(own, host.keymap.legacy ? 'default' : keymapName(choice))
    }
    const text = await preImage(name)
    const path = await host.keymap.save(name, file)
    undoStack = [...undoStack, { name, text, choice }]
    return { path, created: created && text === null }
  }

  function track(job: () => Promise<HotkeyWrite>): Promise<void> {
    return serial(async () => {
      error = ''
      try {
        last = await job()
        undone = false
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
      }
    })
  }

  return {
    /** The rows under the keymap in force. */
    rows(): CommandBinding[] {
      return host.registry.bindings(inForce)
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
    get undone() {
      return undone
    },
    get error() {
      return error
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
    /** Put back what the latest write replaced. */
    undo: (): Promise<void> =>
      serial(async () => {
        const entry = undoStack.at(-1)
        if (!entry) return
        error = ''
        try {
          await host.keymap.restore(entry.name, entry.text, entry.choice)
          undoStack = undoStack.slice(0, -1)
          last = null
          undone = true
        } catch (err) {
          error = err instanceof Error ? err.message : String(err)
        }
      }),
  }
}

export type HotkeyWriter = ReturnType<typeof createHotkeyWriter>
