/**
 * The keymap file (quiet-shell F10; foundations-plan Stage 6):
 * `.ohhi/keymaps/<name>.json` — which keys run which commands, as data.
 *
 *   {
 *     "$schema": "ohhi.keymap.v1",
 *     "extends": "default",                       // optional; a keymap by name
 *     "bindings": {
 *       "daily.next": "Alt+ArrowRight",           // one chord
 *       "nav.quick-open": ["Mod+o", "Mod+k"],     // several
 *       "format.bold": []                         // unbound
 *     }
 *   }
 *
 * A keymap is a set of OVERRIDES over the command table's own defaults: an id
 * it does not name keeps the binding it ships with, and the built-in `default`
 * keymap names none. `extends` layers files — the parent first, this file's
 * bindings over it, per command id — with cycle protection.
 *
 * Pure: no runes, no I/O. The loader is `resources.svelte.ts`, the shell's
 * side is `keymap.svelte.ts`, and the registry (`commands.ts`) is what reads
 * the resolved bindings.
 */
import { z } from 'zod'
import { COMMAND_IDS } from './command-ids.js'
import { parseBinding, type BindingOverrides } from './commands.js'
import { RESOURCE_NAME, choiceName, parseChoice, parseJsonFile, walkExtends, type Choice } from './resource-kind.js'

export const KEYMAP_SCHEMA_ID = 'ohhi.keymap.v1'

/** The built-in keymap names; anything else is `custom:<name>`. */
export const BUILTIN_KEYMAPS = ['default'] as const
export type BuiltinKeymap = (typeof BUILTIN_KEYMAPS)[number]

/** The keymap a device has chosen. */
export type KeymapChoice = Choice<BuiltinKeymap>

/** A name a keymap can be saved under (and the file's basename) — the one resource-name rule. */
export const KEYMAP_NAME = RESOURCE_NAME

/**
 * A chord in the registry's `Mod+Shift+K` form. The pattern is what the JSON
 * Schema can say (modifiers, then one key); `parseBinding` is the runtime's
 * last word.
 */
export const CHORD_PATTERN = /^(?:(?:[Mm][Oo][Dd]|[Ss][Hh][Ii][Ff][Tt]|[Aa][Ll][Tt]|[Cc][Tt][Rr][Ll])\+)*[^+\s]+$/

const chord = z
  .string()
  .regex(CHORD_PATTERN, { message: 'a chord is modifiers (Mod, Shift, Alt, Ctrl) then one key, e.g. Mod+Shift+K' })
  .refine((s) => parseBinding(s) !== null, { message: 'not a binding' })

/** One command's entry: a chord, several, or `[]` for unbound. */
export const KeymapBindingSchema = z.union([chord, z.array(chord)])

/**
 * The runtime schema. Command ids are any non-empty string: a file written
 * for a newer build (a command this one does not have) still loads, and the
 * registry simply never matches the unknown id.
 */
export const KeymapFileSchema = z.strictObject({
  $schema: z.literal(KEYMAP_SCHEMA_ID),
  extends: z.string().min(1).optional(),
  bindings: z.record(z.string().min(1), KeymapBindingSchema),
})
export type KeymapFile = z.infer<typeof KeymapFileSchema>

/**
 * The documented schema — `spec/ohhi.keymap.v1.schema.json` is generated from
 * it — with the command ids enumerated, so an editor or an agent validating a
 * file is told about a typo. Same shape as `KeymapFileSchema`.
 */
export const KeymapDocSchema = KeymapFileSchema.extend({
  bindings: z.partialRecord(z.enum(COMMAND_IDS), KeymapBindingSchema),
})

/** The built-in keymaps, as files: `default` overrides nothing. */
export const BUILTIN_KEYMAP_FILES: Readonly<Record<BuiltinKeymap, KeymapFile>> = {
  default: { $schema: KEYMAP_SCHEMA_ID, bindings: {} },
}

/** Resolved bindings: command id → chords in force; `[]` = unbound. Absent = the default. */
export type KeymapBindings = Record<string, string[]>

export class KeymapError extends Error {
  readonly name = 'KeymapError'
}

/** Read a keymap file's text (or an already-parsed value) into a validated file. */
export function parseKeymap(json: unknown): { ok: true; keymap: KeymapFile } | { ok: false; error: string } {
  const parsed = parseJsonFile(KeymapFileSchema, json)
  return parsed.ok ? { ok: true, keymap: parsed.value } : parsed
}

/** A file's own bindings as arrays (`"Mod+k"` → `["Mod+k"]`). */
export function ownBindings(file: Pick<KeymapFile, 'bindings'>): KeymapBindings {
  const out: KeymapBindings = {}
  for (const [id, value] of Object.entries(file.bindings)) {
    if (value === undefined) continue
    out[id] = typeof value === 'string' ? [value] : [...value]
  }
  return out
}

/**
 * A file → the bindings in force: `extends` followed through `files` (by name;
 * the built-ins are always there unless `files` shadows them), parents first,
 * each file's bindings over its parent's, per command id. A cycle, an unknown
 * parent or a chain deeper than 16 throws a `KeymapError` saying so.
 *
 * `self` names the file being resolved, so a file that extends itself is a
 * cycle rather than an infinite walk.
 */
export function resolveKeymap(
  file: KeymapFile,
  files: Readonly<Record<string, KeymapFile>> = {},
  self?: string
): KeymapBindings {
  const all: Readonly<Record<string, KeymapFile>> = { ...BUILTIN_KEYMAP_FILES, ...files }
  const layers = walkExtends(file, all, {
    ...(self ? { self } : {}),
    what: 'keymap',
    fail: (message) => new KeymapError(message),
  })
  return Object.assign({}, ...layers.map(ownBindings)) as KeymapBindings
}

/**
 * The legacy per-device override map (`config.hotkeys`, `null` = unbound) as
 * keymap bindings — the fallback before a vault is open, and what the
 * migration writes into `device.json`.
 */
export function overridesToBindings(overrides: BindingOverrides): KeymapBindings {
  const out: KeymapBindings = {}
  for (const [id, keys] of Object.entries(overrides)) out[id] = keys === null ? [] : [keys]
  return out
}

/**
 * Bindings → the file that says them: one chord as a string, several as a
 * list, none as `[]` — what Settings and the migration write, so a hand-read
 * `git diff` stays short.
 */
export function keymapFile(bindings: KeymapBindings, extendsName?: string): KeymapFile {
  const out: KeymapFile = { $schema: KEYMAP_SCHEMA_ID, ...(extendsName ? { extends: extendsName } : {}), bindings: {} }
  for (const id of Object.keys(bindings).sort()) {
    const chords = bindings[id]!
    out.bindings[id] = chords.length === 1 ? chords[0]! : [...chords]
  }
  return out
}

/** A stored or URL-given keymap choice, or null when it is not one. */
export function parseKeymapChoice(raw: unknown): KeymapChoice | null {
  return parseChoice(raw, BUILTIN_KEYMAPS)
}

/** The file name a choice resolves by: `custom:mine` → `mine`. */
export const keymapName: (choice: KeymapChoice) => string = choiceName
