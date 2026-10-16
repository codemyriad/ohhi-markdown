/**
 * Where a vault's own themes live, and what a theme may be called — pure, so
 * the resource loader (which lists the folders) and the theme runtime (which
 * reads one by name) agree without either importing the other.
 *
 * A theme is a FOLDER, `.ohhi/themes/<name>/theme.css` — deliberately the
 * shape of `.obsidian/themes/<name>/theme.css` — and the folder's name is the
 * theme's name: it becomes the `[data-theme]` value and a path segment, so it
 * is held to `[\w -]{1,64}`.
 */

/** The folder every theme folder sits in. */
export const THEMES_DIR = '.ohhi/themes'

/** The one file a theme folder holds that the app reads. */
export const THEME_FILE = 'theme.css'

/** A theme name: letters, digits, `_`, spaces and `-`, at most 64. */
export const THEME_NAME = /^[\w -]{1,64}$/

/** Where a custom theme lives in the vault. Mirrors `.obsidian/themes/`. */
export const themePath = (name: string): string => `${THEMES_DIR}/${name}/${THEME_FILE}`
