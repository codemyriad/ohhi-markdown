// Renders apps/desktop/app-icon.png, the source every icon set is generated
// from (`rushx icon` runs this, then `tauri icon`), from the landing page's
// favicon (apps/site/public/favicon.svg): the "hi" mark in Public Sans 600 on
// the default theme's paper, at 1024x1024 with transparent corners. The
// favicon's 1px border is dropped: it is there for a browser's tab strip, and
// inside iOS's own mask it would read as a line. Chromium (apps/web's
// Playwright) does the rendering, so the glyphs are the bundled font's and
// not whatever fontconfig falls back to.
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const out = join(repo, 'apps/desktop/app-icon.png')
const { chromium } = createRequire(join(repo, 'apps/web/package.json'))('@playwright/test')

const favicon = readFileSync(join(repo, 'apps/site/public/favicon.svg'), 'utf8')
const svg = favicon
  .replace(/<svg /, '<svg width="1024" height="1024" ')
  .replace(/\s*<rect x="1"[^>]*stroke[^>]*\/>/, '')
if (!/font-weight="600"/.test(svg) || /stroke/.test(svg)) throw new Error('favicon.svg changed shape: review this script')

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
  console.log(`wrote ${out}`)
} finally {
  await browser.close()
}
