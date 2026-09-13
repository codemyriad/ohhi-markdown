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

/** Built-in themes. `system` is a preference, not a theme — see ThemePref. */
export const BUILTIN_THEMES = ['editor-light', 'editor-dark', 'nord-light', 'nord-dark'] as const

export type BuiltinTheme = (typeof BUILTIN_THEMES)[number]

/** Which built-ins are dark. Used to resolve the CM6 darkTheme facet. */
export const DARK_THEMES: ReadonlySet<string> = new Set(['editor-dark', 'nord-dark'])

export const THEME_LABELS: Record<BuiltinTheme, string> = {
  'editor-light': 'Editor Light',
  'editor-dark': 'Editor Dark',
  'nord-light': 'Nord Light',
  'nord-dark': 'Nord Dark',
}

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
