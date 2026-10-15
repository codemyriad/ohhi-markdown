/**
 * Token NAMES as TypeScript constants, plus the built-in theme list.
 *
 * This is the only thing other packages may import from @ohhi/ui — the CSS
 * is applied by the app shell, never imported by a library (dependency rule 6
 * in docs/architecture/overview.md).
 *
 * Nothing here holds a colour. Values live in CSS and are resolved by the
 * browser against the [data-theme] on <html>; a hex in TypeScript would
 * freeze one theme's answer into JS and silently stop tracking theme changes.
 */

/**
 * Built-in themes, in the order Settings › Appearance lists them. `system` is
 * a preference, not a theme — see ThemePref.
 *
 * `editor-light` / `editor-dark` are the default pair, labelled "Oh hi Light"
 * and "Oh hi Dark": the ids are plumbing kept from before the themes review
 * (2026-10-15, v2-shaping Fork 2 amendment, 2-A), so a stored preference keeps
 * working while the values are the Ledger direction's. Graphite, Fjord and
 * Iris are the review's other three directions. Nord, the Obsidian port, is
 * no longer built in (Fork 4-A, 2026-10-15): it ships as an example custom
 * theme, `examples/themes/nord-*`, that a vault holds — see RETIRED_THEMES.
 */
export const BUILTIN_THEMES = [
  'editor-light',
  'editor-dark',
  'graphite-light',
  'graphite-dark',
  'fjord-light',
  'fjord-dark',
  'iris-light',
  'iris-dark',
] as const

export type BuiltinTheme = (typeof BUILTIN_THEMES)[number]

/** What `system` resolves to, by the OS's polarity. */
export const DEFAULT_LIGHT_THEME: BuiltinTheme = 'editor-light'
export const DEFAULT_DARK_THEME: BuiltinTheme = 'editor-dark'

/** Which built-ins are dark. Resolves the CM6 darkTheme facet and band C's `data-polarity`. */
export const DARK_THEMES: ReadonlySet<string> = new Set([
  'editor-dark',
  'graphite-dark',
  'fjord-dark',
  'iris-dark',
])

/**
 * A theme's polarity, set as `data-polarity` on <html> beside `data-theme`.
 * Band C (sync-tokens.css) picks one of its two sets by it, so every theme of
 * a polarity — a custom one included — shows the same sync colours.
 */
export type Polarity = 'light' | 'dark'

/**
 * Each built-in's label, as its key under `web.settings.appearance.theme_names`
 * in the i18n dictionary — a label is user-facing text, so it lives there and
 * this registry names the key. (Dictionary keys cannot hold `-`.)
 */
export const THEME_LABEL_KEYS = {
  'editor-light': 'editor_light',
  'editor-dark': 'editor_dark',
  'graphite-light': 'graphite_light',
  'graphite-dark': 'graphite_dark',
  'fjord-light': 'fjord_light',
  'fjord-dark': 'fjord_dark',
  'iris-light': 'iris_light',
  'iris-dark': 'iris_dark',
} as const satisfies Record<BuiltinTheme, string>

export type ThemeLabelKey = (typeof THEME_LABEL_KEYS)[BuiltinTheme]

/**
 * Built-ins that left, each → the built-in that stands in for it (the default
 * of its polarity). Nord Light and Dark moved out of the app into a vault
 * (v2-shaping Fork 2, Fork 4-A, 2026-10-15): they ship as example custom
 * themes, `examples/themes/<id>/theme.css`. A stored preference naming one
 * (device config from before the move) is read as the vault theme of the
 * same name, `custom:<id>`; where the open vault has no such folder, the
 * stand-in is shown and the app says so once. The pre-paint script in
 * `apps/web/index.html` carries the same list (theme.test.ts keeps it equal).
 */
export const RETIRED_THEMES = {
  'nord-light': 'editor-light',
  'nord-dark': 'editor-dark',
} as const satisfies Record<string, BuiltinTheme>

export type RetiredTheme = keyof typeof RETIRED_THEMES

/** How many presence slots a theme defines (--ed-presence-1 … -8). */
export const PRESENCE_SLOTS = 8

/**
 * How many tab-group slots a theme defines (--ed-group-1 … -8).
 *
 * A group's `color` is this slot NUMBER, never a hex: the chip paints itself
 * with `var(--ed-group-N)` so switching theme retints every group, and a
 * device-local group survives a theme change with its identity intact.
 */
export const GROUP_SLOTS = 8

/**
 * The three suggestion tokens (writing-harness B7): an agent's proposed edit
 * drawn in the note — the replaced text struck (`del`), the proposal
 * inserted (`add`), and one a peer's edit overtook (`stale`). Band B, painted
 * by `libs/editor/src/suggestions.ts` through the `ed-suggest-*` classes.
 */
export const SUGGEST_TOKENS = ['--ed-suggest-del', '--ed-suggest-add', '--ed-suggest-stale'] as const

/**
 * The two comment-thread tints (writing-harness B8): the passage a thread
 * hangs off, open and resolved. Band B, painted by
 * `libs/editor/src/comments.ts` through the `ed-comment` /
 * `ed-comment-resolved` marks.
 */
export const COMMENT_TOKENS = ['--ed-comment-bg', '--ed-comment-resolved-bg'] as const

/**
 * The agent's working range (writing-harness B10): the passage an agent's
 * awareness says it is on. Band B (presence), painted by
 * `libs/editor/src/working-highlight.ts` through the `ed-agent-working` mark.
 */
export const AGENT_WORKING_TOKEN = '--ed-agent-working-bg'

/**
 * Read a custom property off an element (default: <html>), trimmed.
 * Returns '' when the property is unset or when there is no DOM.
 */
export function readToken(name: string, el?: Element): string {
  if (typeof getComputedStyle !== 'function') return ''
  const target = el ?? (typeof document !== 'undefined' ? document.documentElement : null)
  if (!target) return ''
  return getComputedStyle(target).getPropertyValue(name).trim()
}

/**
 * The presence colour for slot `i` (0-based), read from the ACTIVE theme.
 *
 * Presence colour is theme-scoped by nature: the eight values tuned for a
 * white page vibrate on #2e3440, and one of them would sit close enough to
 * the diverged red to be actively dangerous. Falls back to a neutral so a
 * missing token never produces `color: ""`.
 */
export function presenceColor(i: number): string {
  const slot = (((i % PRESENCE_SLOTS) + PRESENCE_SLOTS) % PRESENCE_SLOTS) + 1
  return readToken(`--ed-presence-${slot}`) || '#6b7684'
}

/**
 * The ink for presence slot `i` (0-based) in the ACTIVE theme — the colour
 * initials are drawn in on `presenceColor(i)`, asserted to clear 4.5:1 per
 * built-in theme (theme-contract.test.ts). Components use the token directly
 * (`var(--ed-presence-fg-N)`); this is for code that needs the value.
 */
export function presenceInk(i: number): string {
  const slot = (((i % PRESENCE_SLOTS) + PRESENCE_SLOTS) % PRESENCE_SLOTS) + 1
  return readToken(`--ed-presence-fg-${slot}`) || '#ffffff'
}
