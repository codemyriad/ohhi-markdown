/**
 * Theme runtime.
 *
 * Colours are entirely a CSS concern: every surface — the Svelte chrome and
 * the CodeMirror editor alike — resolves `var(--ed-*)` and `var(--color-*)`
 * against the `data-theme` attribute on <html>. So this module does exactly
 * three things: set the attribute, persist the choice, and publish the one
 * boolean CSS cannot express for us (CM6's `darkTheme` facet, which selects
 * its own base rules for scrollers, panels and tooltips).
 *
 * `system` is resolved to an explicit attribute rather than left to
 * `:root:not([data-theme])`. DaisyUI's `--prefersdark` could handle band A in
 * pure CSS, but our `--ed-*` band lives under `[data-theme="…"]` selectors and
 * would need every dark token duplicated inside a media query to match. One
 * code path is worth more than the CSS-only purity, and the boot script is
 * synchronous so there is no flash either way. Recorded in docs/theming.md.
 */
import { getLL } from '@editor/i18n'
import { BUILTIN_THEMES, DARK_THEMES, type BuiltinTheme } from '@editor/ui/tokens'
import { setThemePref, themePref, type ThemePref } from './config.js'

const DEFAULT_LIGHT: BuiltinTheme = 'editor-light'
const DEFAULT_DARK: BuiltinTheme = 'editor-dark'

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
  if ((BUILTIN_THEMES as readonly string[]).includes(name)) return DARK_THEMES.has(name)
  try {
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
  /** Resolved polarity, for CM6's darkTheme facet. CSS needs no such thing. */
  dark: false,
})

export function applyTheme(pref: ThemePref): void {
  const name = resolveTheme(pref)
  try {
    document.documentElement.setAttribute('data-theme', name)
  } catch {
    // No DOM (tests, SSR) — state below is still correct for callers.
  }
  themeState.pref = pref
  themeState.name = name
  themeState.dark = resolveDark(pref)
  setThemePref(pref)
}

/** Apply the stored preference and start following the OS while on `system`. */
export function initTheme(): void {
  const pref = themePref()
  const name = resolveTheme(pref)
  try {
    document.documentElement.setAttribute('data-theme', name)
  } catch {
    /* no DOM */
  }
  themeState.pref = pref
  themeState.name = name
  themeState.dark = resolveDark(pref)

  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      // Only `system` follows the OS; an explicit choice is an explicit choice.
      if (themeState.pref === 'system') applyTheme('system')
    })
  } catch {
    /* matchMedia unavailable */
  }
}

/** Where a custom theme lives in the vault. Mirrors `.obsidian/themes/`. */
export const themePath = (name: string): string => `.editor/themes/${name}/theme.css`

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
  if (!/^[\w -]{1,64}$/.test(clean)) {
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
  // The CSS only exists now, so the polarity probe can finally answer — the
  // boot script set the attribute long before the vault could be read.
  themeState.dark = resolveDark(themeState.pref)
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
      // The honesty tokens, and any rule aimed at the pill itself.
      .replace(/--ed-sync-[a-z-]*\s*:[^;}]*;?/gi, '')
      .replace(/[^{}]*(?:ed-sync-dot|sync-pill)[^{}]*\{[^}]*\}/gi, '')
      // `!important` REVERSES layer order: an important declaration in
      // @layer editor.user outranks every unlayered rule we write, so no
      // CSS-only defence survives it. A theme has no legitimate need for it
      // either — it already sits in the highest-priority normal layer.
      .replace(/!\s*important/gi, '')
      .replace(/<\/style/gi, '<\\/style')
  )
}
