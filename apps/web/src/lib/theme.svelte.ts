/**
 * Theme runtime.
 *
 * Colours are entirely a CSS concern: every surface — the Svelte chrome and
 * the CodeMirror editor alike — resolves `var(--ed-*)` and `var(--color-*)`
 * against the `data-theme` attribute on <html>. So this module does exactly
 * three things: set the attribute, persist the choice, and publish the one
 * boolean CSS cannot work out for itself — the theme's polarity — twice: as
 * CM6's `darkTheme` facet (its own base rules for scrollers, panels and
 * tooltips) and as `data-polarity` on <html>, which picks band C's sync
 * colours (sync-tokens.css, one set per polarity: themes review Fork 3-B).
 *
 * `system` is resolved to an explicit attribute rather than left to
 * `:root:not([data-theme])`. DaisyUI's `--prefersdark` could handle band A in
 * pure CSS, but our `--ed-*` band lives under `[data-theme="…"]` selectors and
 * would need every dark token duplicated inside a media query to match. One
 * code path is worth more than the CSS-only purity, and the boot script is
 * synchronous so there is no flash either way. Recorded in docs/theming.md.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import {
  BUILTIN_THEMES,
  DARK_THEMES,
  DEFAULT_DARK_THEME as DEFAULT_DARK,
  DEFAULT_LIGHT_THEME as DEFAULT_LIGHT,
  RETIRED_THEMES,
  THEME_LABEL_KEYS,
  type BuiltinTheme,
  type Polarity,
} from '@ohhi/ui/tokens'
import { setPolarityMirror, setThemePref, themePref, type ThemePref } from './config.js'
import { THEME_NAME, themePath } from './theme-files.js'

/** Is `name` one of the built-in themes (the registry in `@ohhi/ui/tokens`)? */
export function isBuiltinTheme(name: string): name is BuiltinTheme {
  return (BUILTIN_THEMES as readonly string[]).includes(name)
}

/**
 * A built-in theme's label in the current language, or null for a custom
 * theme (whose name is its folder's). The labels are dictionary entries
 * (`web.settings.appearance.theme_names`), keyed by `THEME_LABEL_KEYS`.
 */
export function builtinThemeLabel(ll: TranslationFunctions, name: string): string | null {
  if (!isBuiltinTheme(name)) return null
  const names: Record<(typeof THEME_LABEL_KEYS)[BuiltinTheme], () => string> = ll.web.settings.appearance.theme_names
  return names[THEME_LABEL_KEYS[name]]()
}

function prefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** The `data-theme` value a preference resolves to right now. */
export function resolveTheme(pref: ThemePref): string {
  if (pref === 'system') return prefersDark() ? DEFAULT_DARK : DEFAULT_LIGHT
  if (pref.startsWith('custom:')) return pref.slice('custom:'.length)
  return pref
}

/**
 * Is the resolved theme dark? Built-ins are known statically.
 *
 * A custom theme declares its polarity with `color-scheme`, but that CANNOT be
 * read off `<html>`: index.html carries `<meta name="color-scheme" content=
 * "light dark">` so the pre-CSS frame paints correctly, and that behaves as an
 * unlayered author declaration on `:root` — outranking a themed
 * `[data-theme="x"] { color-scheme: light }` inside `@layer editor.user`, so
 * the root always computes to "light dark" and every custom theme would read
 * as dark. Probe a detached element the theme's own selector matches instead.
 */
export function resolveDark(pref: ThemePref): boolean {
  const name = resolveTheme(pref)
  if (isBuiltinTheme(name)) return DARK_THEMES.has(name)
  try {
    // A custom theme whose CSS is not in yet (boot, before the vault opens)
    // cannot be probed: keep the polarity the pre-paint script restored
    // from the mirror rather than overwrite it — and the mirror — with the
    // OS's, which would flip band C back and forth on every boot.
    if (!document.getElementById('ed-user-theme')) {
      const restored = document.documentElement.getAttribute('data-polarity')
      if (restored === 'dark' || restored === 'light') return restored === 'dark'
      return prefersDark()
    }
    const probe = document.createElement('div')
    probe.setAttribute('data-theme', name)
    probe.style.display = 'none'
    document.body.append(probe)
    const scheme = getComputedStyle(probe).colorScheme
    probe.remove()
    // `normal` means the theme declared nothing — fall back to the OS.
    if (scheme.includes('dark') && !scheme.includes('light')) return true
    if (scheme.includes('light') && !scheme.includes('dark')) return false
    return prefersDark()
  } catch {
    return prefersDark()
  }
}

export const themeState = $state({
  pref: themePref(),
  /** The applied `data-theme` value. */
  name: DEFAULT_LIGHT as string,
  /** Resolved polarity: CM6's darkTheme facet, and `data-polarity` (band C). */
  dark: false,
  /**
   * The vault theme the preference names, when the open vault has no such
   * folder and the built-in default of its polarity stands in; else null.
   * The preference is kept, so the theme comes back once the folder is there.
   */
  fellBackFrom: null as string | null,
})

/** The built-in shown while a vault theme cannot be: the default of the polarity. */
const standIn = (dark: boolean): string => (dark ? DEFAULT_DARK : DEFAULT_LIGHT)

/** Is the preference a vault theme whose CSS is installed now? */
const userThemeInstalled = (): boolean => {
  try {
    return document.getElementById('ed-user-theme') !== null
  } catch {
    return false
  }
}

/**
 * Set band C's `data-polarity` on <html> (sync-tokens.css picks the light or
 * dark sync colours by it) and mirror it for the pre-paint script, which
 * cannot know a custom theme's polarity before the vault opens.
 */
function setPolarity(dark: boolean): void {
  const polarity: Polarity = dark ? 'dark' : 'light'
  themeState.dark = dark
  try {
    document.documentElement.setAttribute('data-polarity', polarity)
  } catch {
    // No DOM (tests, SSR).
  }
  setPolarityMirror(polarity)
}

export function applyTheme(pref: ThemePref): void {
  const name = resolveTheme(pref)
  themeState.fellBackFrom = null
  try {
    document.documentElement.setAttribute('data-theme', name)
  } catch {
    // No DOM (tests, SSR) — state below is still correct for callers.
  }
  themeState.pref = pref
  themeState.name = name
  setPolarity(resolveDark(pref))
  setThemePref(pref)
}

/**
 * Apply the stored preference and start following the OS while on `system`.
 *
 * A vault theme's CSS cannot be read before its vault opens, so until it is
 * installed the built-in default of the polarity the app last resolved for
 * it stands in (the pre-paint script does the same) — a dark theme's first
 * frames are dark, not the contract's light defaults.
 */
export function initTheme(): void {
  const pref = themePref()
  themeState.pref = pref
  const dark = resolveDark(pref)
  const name = pref.startsWith('custom:') && !userThemeInstalled() ? standIn(dark) : resolveTheme(pref)
  try {
    document.documentElement.setAttribute('data-theme', name)
  } catch {
    /* no DOM */
  }
  themeState.name = name
  setPolarity(dark)

  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      // Only `system` follows the OS; an explicit choice is an explicit choice.
      if (themeState.pref === 'system') applyTheme('system')
    })
  } catch {
    /* matchMedia unavailable */
  }
}

export { themePath }

/**
 * Load and apply a vault-resident theme. Returns an error message on failure
 * rather than throwing: a missing or broken theme must degrade to the built-in
 * default, never to a dead app.
 */
export async function useCustomTheme(
  name: string,
  read: (path: string) => Promise<string | null>
): Promise<string | null> {
  const clean = name.trim()
  // The name becomes a [data-theme] value and a path segment.
  if (!THEME_NAME.test(clean)) {
    return getLL().web.theme.bad_name()
  }
  let css: string | null
  try {
    css = await read(themePath(clean))
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  if (css === null) return getLL().web.theme.missing({ path: themePath(clean) })
  installUserTheme(css)
  applyTheme(`custom:${clean}`)
  return null
}

/**
 * Install a user theme's CSS into `@layer editor.user`, which sits above our
 * own `editor.tokens` layer — and below nothing, because the sync tokens are
 * unlayered and unlayered beats every layer. A theme file arrives with a
 * SHARED VAULT, i.e. it is another person's content.
 */
export function installUserTheme(css: string): void {
  let el = document.getElementById('ed-user-theme') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'ed-user-theme'
    document.head.append(el)
  }
  el.textContent = `@layer editor.user {\n${sanitizeThemeCss(css)}\n}`
  // The preference's theme can now be shown: until this, its stand-in was.
  if (themeState.pref.startsWith('custom:')) {
    const name = resolveTheme(themeState.pref)
    try {
      document.documentElement.setAttribute('data-theme', name)
    } catch {
      /* no DOM */
    }
    themeState.name = name
    themeState.fellBackFrom = null
  }
  // The CSS only exists now, so the polarity probe can finally answer — the
  // boot script set the attribute long before the vault could be read.
  setPolarity(resolveDark(themeState.pref))
}

/**
 * The open vault has no folder for the vault theme the preference names:
 * drop any theme CSS another vault left installed and show the built-in
 * default of the polarity last resolved for it. The preference is kept
 * (`themeState.fellBackFrom` says what stands in for what), so the theme
 * returns when a vault with the folder opens, or the folder is added.
 */
export function standInFor(name: string): void {
  try {
    document.getElementById('ed-user-theme')?.remove()
  } catch {
    /* no DOM */
  }
  // A retired built-in (Nord) stands in with the default of its own polarity.
  const shown = Object.hasOwn(RETIRED_THEMES, name)
    ? RETIRED_THEMES[name as keyof typeof RETIRED_THEMES]
    : standIn(themeState.dark)
  try {
    document.documentElement.setAttribute('data-theme', shown)
  } catch {
    /* no DOM */
  }
  themeState.name = shown
  themeState.fellBackFrom = name
  setPolarity(DARK_THEMES.has(shown))
}

/**
 * Read the vault theme the preference names from the open vault and install
 * it — or, when the vault has no such file, show the stand-in. Called when a
 * vault opens and whenever its theme folders change (a watcher event, *Reload
 * files*, an example just added), which is how an edited theme reloads.
 */
export async function restoreVaultTheme(
  read: (path: string) => Promise<string | null>
): Promise<'none' | 'installed' | 'missing'> {
  const pref = themeState.pref
  if (!pref.startsWith('custom:')) return 'none'
  const name = pref.slice('custom:'.length)
  let css: string | null = null
  try {
    css = THEME_NAME.test(name) ? await read(themePath(name)) : null
  } catch {
    css = null
  }
  // Another pick landed while this read: it is that pick's to apply.
  if (themeState.pref !== pref) return 'none'
  if (css !== null) {
    installUserTheme(css)
    return 'installed'
  }
  standInFor(name)
  return 'missing'
}

/**
 * Make a third-party stylesheet safe to inject. Two jobs, both load-bearing.
 *
 * 1. NOTHING MAY REACH THE NETWORK. CSS `url()`, `@import` and `image-set()`
 *    are working beacons out of a local-first app: a theme arrives with the
 *    folder, so loading one unfiltered would tell whoever shared the vault
 *    when you opened it. `data:` URIs survive, so a theme can still ship an
 *    image or a font inline.
 *
 * 2. NOTHING MAY TOUCH THE SYNC PILL. Cascade layers only settle conflicts on
 *    the SAME element, and custom properties inherit — `body { --ed-sync-ok:
 *    red }` would be the only declaration on <body> and the pill would
 *    inherit it, layer priority never entering the picture. And `!important`
 *    reverses layer order, so a layered important rule outranks every
 *    unlayered one we could write. So three things go: the sync tokens, any
 *    rule that targets the pill, and `!important` itself.
 *    (libs/ui also paints the dot by longhand on its own element, which
 *    handles the inheritance vector at paint time — two defences, not one.)
 *
 * Deliberately conservative: unknown constructs are removed, not kept.
 */
export function sanitizeThemeCss(css: string): string {
  return (
    css
      // Comments first, so nothing hides a directive inside one.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import\b[^;]*;?/gi, '')
      .replace(/@(?:charset|namespace)\b[^;]*;?/gi, '')
      // Any declaration whose value can fetch: url() with a non-data scheme,
      // and the image-producing functions that take a bare string URL.
      .replace(/[^;{}]*:[^;{}]*\b(?:-webkit-)?(?:image-set|cross-fade)\s*\([^;{}]*;?/gi, '')
      .replace(/url\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, 'none')
      // The honesty tokens, and any rule aimed at a pill or a dot. Every sync
      // surface carries `data-status` and a testid naming it (`sync-pill-*`,
      // `toolbar-vault-pill`, `pane-sync-dot:*`, `shared-room-pill:*`, …), so
      // a selector that mentions a testid, `data-status`, a pill or sync at
      // all is dropped — as is `:has(`, which reaches a pill's host through
      // its children. A theme styles content and chrome by class and token;
      // it has no business with test hooks.
      .replace(/--ed-sync-[a-z-]*\s*:[^;}]*;?/gi, '')
      .replace(/[^{}]*(?:data-testid|data-status|pill|sync|:has\()[^{}]*\{[^}]*\}/gi, '')
      // `!important` REVERSES layer order: an important declaration in
      // @layer editor.user outranks every unlayered rule we write, so no
      // CSS-only defence survives it. A theme has no legitimate need for it
      // either — it already sits in the highest-priority normal layer.
      .replace(/!\s*important/gi, '')
      .replace(/<\/style/gi, '<\\/style')
  )
}
