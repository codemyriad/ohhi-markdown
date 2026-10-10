/**
 * The guide renderer (first-run E4): standalone pages, headings with ids,
 * sibling links rewritten, and nothing executable surviving from markdown.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildGuide, renderPage, safeUrl } from './build-guide.mjs'

const FIXTURE = `---
status: current
date: 2026-10-10
---

# Sharing and the relay

Some *text* with a [sibling](recovery.md#set-this-up-first) and an [outside link](https://example.com).

## The secret

<script>alert('x')</script>
<img src=x onerror="alert(1)">
<iframe src="https://evil.example"></iframe>

A [bad link](javascript:alert(1)) and ![bad image](data:image/png;base64,AAAA).

\`<script>in code</script>\`
`

const nav = [
  { name: 'start', title: 'Getting started' },
  { name: 'sharing', title: 'Sharing and the relay' },
]

describe('renderPage', () => {
  const html = renderPage({ name: 'sharing', source: FIXTURE, nav })

  it('is a standalone page with a title, the nav and the date', () => {
    expect(html).toMatch(/^<!doctype html>/)
    expect(html).toContain('<title>Sharing and the relay · Oh hi markdown</title>')
    expect(html).toContain('<a href="sharing.html" aria-current="page">Sharing and the relay</a>')
    expect(html).toContain('<a href="start.html">Getting started</a>')
    expect(html).toContain('Updated 2026-10-10')
    expect(html).not.toContain('status: current')
  })

  it('renders headings with ids and rewrites sibling links', () => {
    expect(html).toContain('<h1 id="sharing-and-the-relay">Sharing and the relay</h1>')
    expect(html).toContain('<h2 id="the-secret">The secret</h2>')
    expect(html).toContain('<a href="recovery.html#set-this-up-first">sibling</a>')
    expect(html).toContain('<a href="https://example.com" rel="noopener noreferrer">outside link</a>')
  })

  it('lets no script, handler, frame or dangerous URL through', () => {
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<iframe/i)
    expect(html).not.toMatch(/<img[^>]*onerror/i)
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('data:image')
    // Shown as text instead.
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('bad link')
  })
})

describe('safeUrl', () => {
  it('keeps web, mail, fragment and relative URLs; drops other schemes and protocol-relative ones', () => {
    expect(safeUrl('https://a.example/x')).toBe('https://a.example/x')
    expect(safeUrl('mailto:a@b.example')).toBe('mailto:a@b.example')
    expect(safeUrl('#top')).toBe('#top')
    expect(safeUrl('./start.md')).toBe('start.html')
    expect(safeUrl('JavaScript:alert(1)')).toBeNull()
    expect(safeUrl('vbscript:x')).toBeNull()
    expect(safeUrl('//evil.example')).toBeNull()
  })
})

describe('buildGuide', () => {
  it('writes one page per markdown file, in the nav order, plus an index', () => {
    const src = mkdtempSync(join(tmpdir(), 'guide-src-'))
    const out = join(mkdtempSync(join(tmpdir(), 'guide-out-')), 'guide')
    writeFileSync(join(src, 'sharing.md'), FIXTURE)
    writeFileSync(join(src, 'start.md'), '# Getting started\n\nHello.\n')
    expect(buildGuide(src, out)).toEqual(['start', 'sharing'])
    expect(readFileSync(join(out, 'start.html'), 'utf8')).toContain('<h1 id="getting-started">Getting started</h1>')
    expect(readFileSync(join(out, 'index.html'), 'utf8')).toContain('aria-current="page">Getting started')
  })
})
