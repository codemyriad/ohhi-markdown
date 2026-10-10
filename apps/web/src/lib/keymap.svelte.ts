/**
 * The active keymap, on the shell's side (quiet-shell F10; foundations-plan
 * Stage 6). The FILE is `.ohhi/keymaps/<name>.json` (`keymap-spec.ts`), read
 * through the resource roots (`resources.svelte.ts`); the device holds only
 * the choice (`config.keymap.active`). `reload()` resolves the choice and
 * hands the bindings to the registry and the editors through `host.apply`.
 *
 * **The `config.hotkeys` migration.** Before keymaps were files, Settings
 * stored per-device overrides in config. The first time `reload()` runs with
 * a non-empty map AND a vault open, the map is written as
 * `.ohhi/keymaps/device.json` (`device-2.json`, … if the name is taken)
 * extending `default`, the choice becomes `custom:device`, and the map is
 * cleared — so it is read exactly once. With no vault open yet there is
 * nowhere to write it, and the map is applied as it is (the fallback).
 *
 * Idempotent even when clearing config fails (a full or blocked
 * localStorage): a `device*.json` that already says exactly the map is
 * adopted rather than written again, and an instance never migrates twice —
 * so a reload (which the write itself triggers, through the `.ohhi/` feed)
 * can never mint `device-2.json`, `device-3.json`, ….
 *
 * A runes module built by a factory over an explicit host, so a test drives
 * it with fakes.
 */
import type { BindingOverrides, CommandRegistry } from './commands.js'
import { COMMAND_IDS } from './command-ids.js'
import {
  keymapFile,
  ownBindings,
  overridesToBindings,
  parseKeymap,
  type KeymapBindings,
  type KeymapChoice,
  type KeymapFile,
} from './keymap-spec.js'
import type { ResolvedKeymap, Resources } from './resources.svelte.js'
import type { EditorKeyId, FormatBindings } from '@ohhi/editor'
import { getLL } from '@ohhi/i18n'

export interface KeymapHost {
  resources: Pick<Resources, 'resolveKeymap' | 'saveKeymap' | 'list' | 'read'> &
    Partial<Pick<Resources, 'restoreKeymap'>>
  /** True while a vault is open — somewhere a keymap file can be written. */
  hasVault(): boolean
  /** `config.hotkeys`, normalised. */
  legacy(): BindingOverrides
  clearLegacy(): void
  /** `config.keymap.active`. */
  choice(): KeymapChoice
  setChoice(choice: KeymapChoice): void
  /** Hand the bindings in force to the registry and the editors. */
  apply(bindings: KeymapBindings): void
  /** The migration wrote this file (a notice); or could not (`error`). */
  migrated?(result: { path: string } | { error: string }): void
}

/** The name the migration writes under: `device`, else the first free `device-N`. */
export function migrationName(taken: ReadonlySet<string>): string {
  if (!taken.has('device')) return 'device'
  let n = 2
  while (taken.has(`device-${n}`)) n++
  return `device-${n}`
}

/**
 * The chords a registry has in force for every key the editor binds itself —
 * the `format.*` table and `edit.toggle-checkbox` — what the editors are
 * re-keyed with, so a `[]` in a keymap file unbinds the key in CM6 too.
 */
export function formatBindingsOf(registry: Pick<CommandRegistry, 'effectiveChords'>): FormatBindings {
  const out: FormatBindings = {}
  for (const id of COMMAND_IDS) {
    if (id.startsWith('format.') || id === 'edit.toggle-checkbox') out[id as EditorKeyId] = registry.effectiveChords(id)
  }
  return out
}

export function createKeymap(host: KeymapHost) {
  let active = $state<KeymapChoice>(host.choice())
  let resolved = $state.raw<ResolvedKeymap | null>(null)
  /** True while the legacy `config.hotkeys` map is what is in force (no vault yet). */
  let legacy = $state(false)
  let generation = 0
  let migrating: Promise<boolean> | null = null
  /** The file this instance migrated into (or adopted): never a second one. */
  let migratedTo: string | null = null

  /** A vault `device*.json` that already says exactly `file` — an earlier migration whose config clear was lost. */
  async function alreadyMigrated(file: KeymapFile, entries: { name: string; root: string }[]): Promise<string | null> {
    const want = JSON.stringify(file)
    for (const entry of entries) {
      if (entry.root !== 'vault' || !/^device(?:-\d+)?$/.test(entry.name)) continue
      const parsed = parseKeymap((await host.resources.read('keymaps', entry.name))?.text ?? '')
      if (parsed.ok && JSON.stringify(keymapFile(ownBindings(parsed.keymap), parsed.keymap.extends)) === want) {
        return entry.name
      }
    }
    return null
  }

  /** Write the legacy map as a keymap file; true when it is done (or there was nothing to do). */
  async function migrate(overrides: BindingOverrides): Promise<boolean> {
    try {
      const file = keymapFile(overridesToBindings(overrides), 'default')
      const entries = await host.resources.list('keymaps')
      let name = migratedTo ?? (await alreadyMigrated(file, entries))
      if (name === null) {
        name = migrationName(new Set(entries.map((e) => e.name)))
        // Remembered before the write lands: the write's own change event
        // reloads, and that reload must find this, not write again.
        migratedTo = name
        const path = await host.resources.saveKeymap(name, file).catch((err: unknown) => {
          migratedTo = null
          throw err
        })
        host.migrated?.({ path })
      }
      migratedTo = name
      host.setChoice(`custom:${name}`)
      host.clearLegacy()
      return true
    } catch (err) {
      host.migrated?.({ error: err instanceof Error ? err.message : String(err) })
      return false
    }
  }

  /** Resolve the choice (migrating `config.hotkeys` first, when it can) and apply it. */
  async function reload(): Promise<void> {
    const gen = ++generation
    const overrides = host.legacy()
    if (Object.keys(overrides).length > 0) {
      const done = host.hasVault() ? await (migrating ??= migrate(overrides).finally(() => (migrating = null))) : false
      if (gen !== generation) return
      if (!done) {
        legacy = true
        resolved = null
        host.apply(overridesToBindings(overrides))
        return
      }
    }
    const choice = host.choice()
    const next = await host.resources.resolveKeymap(choice)
    if (gen !== generation) return
    legacy = false
    active = choice
    resolved = next
    host.apply(next.bindings)
  }

  /** Make `choice` the active keymap on this device and apply it. */
  async function setActive(choice: KeymapChoice): Promise<void> {
    host.setChoice(choice)
    await reload()
  }

  /** Write `.ohhi/keymaps/<name>.json`, make it active, apply it; the path written. */
  async function save(name: string, file: KeymapFile): Promise<string> {
    const path = await host.resources.saveKeymap(name, file)
    await setActive(`custom:${name}`)
    return path
  }

  /**
   * Undo a `save` (Settings › Keys, settings-shaping ST3) or a reloaded
   * change (ST6): put the file back to the bytes it replaced (`null` = the
   * save created it: remove it) and make `choice` — the keymap active before
   * — active again (null = leave the choice as it is now). `expected` is what
   * the file must still hold (`Resources.restoreKeymap`): anything else
   * refuses, and the choice stays as it was.
   *
   * The choice moves BEFORE the file does, so removing the file in use never
   * lets the change feed's reload resolve a keymap that is gone (a spurious
   * `keymap_invalid`).
   */
  async function restore(
    name: string,
    text: string | null,
    choice: KeymapChoice | null,
    expected?: string | null
  ): Promise<void> {
    if (!host.resources.restoreKeymap) throw new Error(getLL().web.keymaps.cannot_restore())
    const prior = host.choice()
    if (choice !== null) host.setChoice(choice)
    try {
      await host.resources.restoreKeymap(name, text, expected)
    } catch (err) {
      if (choice !== null) host.setChoice(prior)
      throw err
    }
    await reload()
  }

  return {
    get active() {
      return active
    },
    /** The active keymap as resolved; null before the first reload and in legacy mode. */
    get resolved() {
      return resolved
    },
    get legacy() {
      return legacy
    },
    reload,
    setActive,
    save,
    restore,
  }
}

export type Keymap = ReturnType<typeof createKeymap>
