/**
 * Settings › Hotkeys over the ACTIVE keymap file (quiet-shell F10).
 *
 * The draft is the file's own `bindings`, edited in place; what the rows show
 * is the registry's table previewed over `parent ∪ draft`, so a conflict an
 * edit would cause is visible before anything is written. Save writes the
 * file through `workspace.writeAppFile` (journaled, atomic) and re-applies
 * the keymap; nothing reaches the registry until then.
 *
 * Where the save lands:
 *  - the active file is in the vault → that file, `extends` kept;
 *  - the active keymap is the built-in `default` (read-only), a file in the
 *    user root (read-only from the app) or a vault file named after a
 *    built-in (the app never writes one; `shadowsBuiltin` says why) →
 *    *Save as*: a new vault file that `extends` the active one and holds
 *    only what changed;
 *  - the active keymap failed to resolve (`unresolved`) → nothing: a file
 *    extending it would not resolve either, so Save and Save as refuse.
 *
 * Owned by the Settings dialog rather than the tab component, because the
 * tab unmounts on every tab switch and an unsaved edit must survive that.
 */
import type { CommandBinding, CommandRegistry } from './commands.js'
import {
  BUILTIN_KEYMAPS,
  keymapFile,
  keymapName,
  ownBindings,
  type KeymapBindings,
} from './keymap-spec.js'
import type { Keymap } from './keymap.svelte.js'
import { savableName } from './resource-kind.js'

export interface HotkeyDraftHost {
  registry: Pick<CommandRegistry, 'bindings'>
  keymap: Pick<Keymap, 'active' | 'resolved' | 'legacy' | 'save'>
  /** The legacy per-device map, as bindings — what is in force in legacy mode. */
  legacy(): KeymapBindings
  /** A vault is open: there is somewhere to write a keymap file. */
  canSave(): boolean
}

const same = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((x, i) => x === b![i])

function sameMap(a: KeymapBindings, b: KeymapBindings): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && same(a[k], b[k]))
}

const clone = (m: KeymapBindings): KeymapBindings => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]))

export function createHotkeyDraft(host: HotkeyDraftHost) {
  /** The active file's own bindings as last read — what "dirty" is measured against. */
  let fileOwn = $state.raw<KeymapBindings>({})
  /** The edit. */
  let own = $state<KeymapBindings>({})

  const parent = (): KeymapBindings => (host.keymap.legacy ? {} : (host.keymap.resolved?.parent ?? {}))

  /** Re-read the active file into the draft (discarding the edit). */
  function seed(): void {
    fileOwn = host.keymap.legacy ? host.legacy() : ownBindings(host.keymap.resolved?.file ?? { bindings: {} })
    own = clone(fileOwn)
  }

  const dirty = $derived(!sameMap(own, fileOwn))

  /** The bindings the draft would put in force. */
  const preview = $derived<KeymapBindings>({ ...parent(), ...own })

  /** The active keymap fell back (a missing or invalid file): why — nothing can be saved over it. */
  const unresolved = $derived(host.keymap.legacy ? null : (host.keymap.resolved?.error ?? null))
  /** The active file is the vault's but named after a built-in: read, never written. */
  const shadowsBuiltin = $derived(
    !host.keymap.legacy &&
      host.keymap.resolved?.entry?.root === 'vault' &&
      !savableName(host.keymap.resolved.entry.name, BUILTIN_KEYMAPS)
  )
  /** Where Save writes without asking for a name: the active file, when it is the vault's and may be written. */
  const writable = $derived(
    !host.keymap.legacy && host.keymap.resolved?.entry?.root === 'vault' && !shadowsBuiltin
  )

  /**
   * What the inherited binding of `id` is — the parent chain's, else the
   * command's default — so typing it back is the same as Reset.
   */
  function inherited(id: string, defaultKeys: string): string[] {
    const p = parent()
    if (Object.hasOwn(p, id)) return [...p[id]!]
    return defaultKeys ? [defaultKeys] : []
  }

  /** Bind `row` to `chords` in the draft (`[]` = unbound). */
  function set(row: Pick<CommandBinding, 'id' | 'defaultKeys'>, chords: string[]): void {
    if (same(chords, inherited(row.id, row.defaultKeys))) delete own[row.id]
    else own[row.id] = [...chords]
  }

  /** Back to what the parent chain (or the default) says. */
  function reset(id: string): void {
    delete own[id]
  }

  /**
   * The file *Save as* writes: `extends` the active keymap, and holds only
   * what differs from the active file — an id the edit removed from the file
   * is written as its inherited value, since a delta cannot say "remove".
   */
  function saveAsFile() {
    const delta: KeymapBindings = {}
    for (const [id, chords] of Object.entries(own)) {
      if (!Object.hasOwn(fileOwn, id) || !same(chords, fileOwn[id])) delta[id] = [...chords]
    }
    const rows = host.registry.bindings({})
    for (const id of Object.keys(fileOwn)) {
      if (Object.hasOwn(own, id)) continue
      delta[id] = inherited(id, rows.find((r) => r.id === id)?.defaultKeys ?? '')
    }
    const base = host.keymap.legacy ? 'default' : keymapName(host.keymap.active)
    return keymapFile(delta, base)
  }

  /**
   * Write the draft. `name` is required unless the active file is writable;
   * returns the vault-relative path written.
   */
  async function save(name?: string): Promise<string> {
    if (!host.canSave()) throw new Error('no vault')
    if (unresolved) throw new Error(unresolved)
    let path: string
    if (writable && (name === undefined || name === keymapName(host.keymap.active))) {
      const file = host.keymap.resolved!.file
      path = await host.keymap.save(keymapName(host.keymap.active), keymapFile(own, file.extends))
    } else {
      if (!name || !savableName(name, BUILTIN_KEYMAPS)) throw new Error('bad name')
      path = await host.keymap.save(name, saveAsFile())
    }
    seed()
    return path
  }

  seed()

  return {
    get own() {
      return own
    },
    get dirty() {
      return dirty
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
    get preview() {
      return preview
    },
    /** The Settings rows under the draft. */
    rows(): CommandBinding[] {
      return host.registry.bindings(preview)
    },
    /** Re-seed from the active file — unless there is an edit to keep. */
    sync(): void {
      if (!dirty) seed()
    },
    discard: seed,
    set,
    reset,
    save,
  }
}

export type HotkeyDraft = ReturnType<typeof createHotkeyDraft>
