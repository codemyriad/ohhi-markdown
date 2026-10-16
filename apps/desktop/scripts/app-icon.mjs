// Renders apps/desktop/app-icon.png, the source every icon set is generated
// from (`rushx icon` runs this, then `tauri icon app-icon.json`), from the
// landing page's favicon (apps/site/public/favicon.svg): the mark in Public
// Sans 600 on its tile colour, at 1024x1024 with transparent corners. A 1px
// border, if the favicon has one, is dropped: it is there for a browser's tab
// strip, and inside iOS's own mask it would read as a line. Chromium
// (apps/web's Playwright) does the rendering, so the glyphs are the bundled
// font's and not whatever fontconfig falls back to. Beside the PNG it writes
// app-icon.json, the `tauri icon` manifest, with `bg_color` = the tile's fill:
// the opaque background iOS needs (the App Store refuses alpha) and Android's
// adaptive-icon background, so the corners iOS and Android paint are the
// tile's own colour, whatever the favicon becomes.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const out = join(repo, 'apps/desktop/app-icon.png')
const manifest = join(repo, 'apps/desktop/app-icon.json')
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test')

const favicon = readFileSync(join(repo, 'apps/site/public/favicon.svg'), 'utf8')
const svg = favicon
  .replace(/<svg /, '<svg width="1024" height="1024" ')
  .replace(/\s*<rect x="1"[^>]*stroke[^>]*\/>/, '')
if (!/font-weight="600"/.test(svg) || /stroke/.test(svg)) throw new Error('favicon.svg changed shape: review this script')
const tile = /<rect [^>]*fill="(#[0-9a-fA-F]{3,8})"/.exec(svg)?.[1]
if (!tile) throw new Error('favicon.svg has no filled <rect> tile: review this script')

const font = readFileSync(join(repo, 'libs/ui/fonts/publicsans/600-latin.woff2')).toString('base64')
const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Public Sans'; font-weight: 600; font-style: normal;
  src: url(data:font/woff2;base64,${font}) format('woff2'); }
html, body { margin: 0; background: transparent; } svg { display: block; }
</style></head><body>${svg}</body></html>`

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.evaluate(() => document.fonts.load("600 30px 'Public Sans'").then(() => document.fonts.ready))
  if (!(await page.evaluate(() => document.fonts.check("600 30px 'Public Sans'")))) throw new Error('Public Sans 600 did not load')
  writeFileSync(out, await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 1024, height: 1024 } }))
  writeFileSync(manifest, JSON.stringify({ default: 'app-icon.png', bg_color: tile }, null, 2) + '\n')
  console.log(`wrote ${out} and ${manifest} (bg_color ${tile})`)
} finally {
  await browser.close()
}
