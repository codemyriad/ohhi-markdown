/**
 * What every kind of resource file has in common (quiet-shell F8): the name a
 * file is saved and chosen by, the device's choice (`default` or
 * `custom:<name>`), reading a JSON file against its schema into a sentence a
 * person can act on, and the `extends` walk with its cycle and depth guards.
 * Layouts (`layout-spec.ts`) and keymaps (`keymap-spec.ts`) each keep only
 * their schema and their merge; templates share the name rule. The loader
 * over the roots is `resources.svelte.ts`.
 *
 * Pure: no runes, no I/O.
 */
import type { z } from 'zod'

/** A name a resource file can be saved under — its basename, without the extension. */
export const RESOURCE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$/

/** The resource a device has chosen: a built-in by name, or a file by name. */
export type Choice<B extends string = string> = B | `custom:${string}`

/** A stored or URL-given choice, or null when it is not one. */
export function parseChoice<B extends string>(raw: unknown, builtins: readonly B[]): Choice<B> | null {
  if (typeof raw !== 'string') return null
  if ((builtins as readonly string[]).includes(raw)) return raw as B
  if (raw.startsWith('custom:') && RESOURCE_NAME.test(raw.slice('custom:'.length))) return raw as Choice<B>
  return null
}

/** The file name a choice resolves by: `custom:writing` → `writing`. */
export function choiceName(choice: string): string {
  return choice.startsWith('custom:') ? choice.slice('custom:'.length) : choice
}

/**
 * The choice that picks a listed entry: a built-in that nothing shadows is
 * chosen by its own name, any file (a vault `dense.json` included) as
 * `custom:<name>` — the name resolves through the roots either way.
 */
export function choiceOf<B extends string>(
  entry: { name: string; root: string },
  builtins: readonly B[]
): Choice<B> {
  return entry.root === 'builtin' && (builtins as readonly string[]).includes(entry.name)
    ? (entry.name as B)
    : `custom:${entry.name}`
}

/** A name the app may write a file under: well-formed, and not a built-in's (which is read-only). */
export function savableName(name: string, builtins: readonly string[]): boolean {
  return RESOURCE_NAME.test(name) && !builtins.includes(name)
}

/** A schema's complaints, one sentence per issue, each prefixed with where it is. */
export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
    .join('; ')
}

/** A file's text (or an already-parsed value), validated; the error says what is wrong. */
export function parseJsonFile<T>(
  schema: z.ZodType<T>,
  json: unknown
): { ok: true; value: T } | { ok: false; error: string } {
  let value = json
  if (typeof json === 'string') {
    try {
      value = JSON.parse(json)
    } catch (err) {
      return { ok: false, error: `not JSON: ${err instanceof Error ? err.message : String(err)}` }
    }
  }
  const parsed = schema.safeParse(value)
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: describeIssues(parsed.error) }
}

/** Nested `extends` beyond this is refused rather than followed. */
export const MAX_EXTENDS_DEPTH = 16

/**
 * A file and its `extends` ancestors, furthest ancestor first — what a kind
 * merges, in order. Parents are looked up by name in `files`; a cycle, an
 * unknown name or a chain deeper than `MAX_EXTENDS_DEPTH` throws `fail`'s
 * error saying so. `self` names the file being walked, so a file that extends
 * itself is a cycle rather than an infinite walk.
 */
export function walkExtends<F extends { extends?: string | undefined }>(
  file: F,
  files: Readonly<Record<string, F>>,
  opts: { self?: string; what: string; fail: (message: string) => Error }
): F[] {
  const layers: F[] = [file]
  const chain: string[] = opts.self ? [opts.self] : []
  let node = file
  while (node.extends !== undefined) {
    const name = node.extends
    if (chain.includes(name)) throw opts.fail(`extends cycle: ${[...chain, name].join(' → ')}`)
    if (chain.length >= MAX_EXTENDS_DEPTH) throw opts.fail(`extends nested deeper than ${MAX_EXTENDS_DEPTH}`)
    const parent = Object.hasOwn(files, name) ? files[name] : undefined
    if (!parent) throw opts.fail(`extends an unknown ${opts.what} "${name}"`)
    chain.push(name)
    layers.unshift(parent)
    node = parent
  }
  return layers
}
