/**
 * Theme resolution and the user-theme sanitizer.
 *
 * The sanitizer is load-bearing, not hygiene: a theme file arrives with a
 * shared vault — i.e. it is another person's content — and CSS `url()` is a
 * working beacon out of a local-first app. These are the cases it must catch.
 */
import { describe, expect, it } from 'vitest'
import { sanitizeThemeCss } from './theme.svelte.js'

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
