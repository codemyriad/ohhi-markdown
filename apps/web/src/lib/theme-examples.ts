/**
 * The example custom themes the app ships (`examples/themes/<name>/theme.css`),
 * bundled so Settings › Appearance can add one to the open vault.
 *
 * Nord Light and Dark were built-ins until 2026-10-15 (v2-shaping Fork 2,
 * Fork 4-A, the themes review's slice T2): they are vault themes now, with
 * their old ids as their folder names, so a preference stored before the
 * move (`nord-dark`, read as `custom:nord-dark`) applies as soon as the
 * folder is there.
 *
 * Adding one is a write the person asks for, into `.ohhi/` — the folder the
 * app may write on an explicit action (quiet-shell F8: "Writes from Settings
 * go through the journal + atomic write", golden rule 1) — through
 * `Workspace.writeAppFile`, which journals the pre-image and writes
 * atomically. It never writes over a file that is already there: that file
 * is someone's, and the example would replace their edits.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import { RETIRED_THEMES, type BuiltinTheme, type RetiredTheme } from '@ohhi/ui/tokens'
import nordDark from '../../../../examples/themes/nord-dark/theme.css?raw'
import nordLight from '../../../../examples/themes/nord-light/theme.css?raw'
import { themePath } from './theme-files.js'

/** Every example, by its folder name, in the order Appearance offers them. */
export const THEME_EXAMPLES: Readonly<Record<RetiredTheme, string>> = {
  'nord-light': nordLight,
  'nord-dark': nordDark,
}

export const EXAMPLE_THEMES = Object.keys(THEME_EXAMPLES) as RetiredTheme[]

/** Is `name` one of the shipped examples (a retired built-in's id)? */
export function isExampleTheme(name: string): name is RetiredTheme {
  return Object.hasOwn(THEME_EXAMPLES, name)
}

/** The built-in that stands in for an example the open vault lacks: the default of its polarity. */
export function exampleStandIn(name: RetiredTheme): BuiltinTheme {
  return RETIRED_THEMES[name]
}

/** Where the example lives in the repository, for the notice's "copy it there" sentence. */
export const exampleSource = (name: RetiredTheme): string => `examples/themes/${name}/theme.css`

/** An example's label in the current language ("Nord Dark"). */
export function exampleLabel(ll: TranslationFunctions, name: RetiredTheme): string {
  const names: Record<RetiredTheme, () => string> = {
    'nord-light': ll.web.theme.examples.nord_light,
    'nord-dark': ll.web.theme.examples.nord_dark,
  }
  return names[name]()
}

/** The open vault's side: read to check, write to add (`Workspace`'s journaled app-file calls). */
export interface ExampleThemeFiles {
  readAppFile(path: string): Promise<string | null>
  writeAppFile(path: string, text: string): Promise<void>
}

/**
 * Write the example `name` into the open vault at `.ohhi/themes/<name>/theme.css`
 * — journaled, atomic — and return that path. Refuses (throws, worded) when a
 * file is already there.
 */
export async function addExampleTheme(name: RetiredTheme, files: ExampleThemeFiles): Promise<string> {
  const path = themePath(name)
  if ((await files.readAppFile(path).catch(() => null)) !== null) {
    throw new Error(getLL().web.theme.example_exists({ path }))
  }
  await files.writeAppFile(path, THEME_EXAMPLES[name])
  return path
}
