/**
 * Fonts (round 3 Q7): the bundled faces load without a single console error
 * or failed request — under the production build the suite serves AND under
 * `vite dev`, where every woff2 used to 403 (libs/ui/fonts sat outside Vite's
 * `server.fs.allow`; apps/web/vite.config.ts now allows it). The dev server is
 * this spec's own, on its own port, so the config's webServer list stays the
 * build + relay pair.
 *
 * And the weight, in Chromium and in WebKit (the desktop's engine on Linux is
 * WebKitGTK): body text is the static 400 instance — a line's computed weight
 * is 400, its text measures exactly as an explicit 400 and NOT as 600, so a
 * variable file or a synthesised bold answering for 400 would fail. WebKit
 * runs only where `npx playwright install webkit` has been done.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, webkit, type Browser, type Page } from '@playwright/test'
import { appUrl, openApp } from './fixtures.js'

const DEV_PORT = 5391
const DEV_URL = `http://localhost:${DEV_PORT}`
const WEB = fileURLToPath(new URL('..', import.meta.url))

/** Every console error, failed request and HTTP ≥ 400 the page sees. */
function watch(page: Page): { errors: string[]; fontRequests: string[] } {
  const errors: string[] = []
  const fontRequests: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => errors.push(`failed: ${r.url()} ${r.failure()?.errorText ?? ''}`))
  page.on('response', (r) => {
    if (r.url().endsWith('.woff2')) fontRequests.push(`${r.status()} ${r.url()}`)
    if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`)
  })
  return { errors, fontRequests }
}

/** The bundled faces are actually loaded — not a fallback answering to the name. */
async function expectBundledFaces(page: Page): Promise<void> {
  const loaded = await page.evaluate(async () => ({
    sans: (await document.fonts.load('15px "Public Sans"')).length,
    mono: (await document.fonts.load('15px "JetBrains Mono"')).length,
    check: document.fonts.check('15px "Public Sans"'),
  }))
  expect(loaded.check).toBe(true)
  expect(loaded.sans).toBeGreaterThan(0)
  expect(loaded.mono).toBeGreaterThan(0)
}

test('the built app loads its fonts with no console errors and no failed requests', async ({ page }) => {
  const seen = watch(page)
  await openApp(page, 'fonts-build', { token: 'fonts-build-token' })
  await expectBundledFaces(page)
  await page.waitForLoadState('networkidle')
  expect(seen.errors).toEqual([])
  expect(seen.fontRequests.length).toBeGreaterThan(0)
  for (const r of seen.fontRequests) expect(r).toMatch(/^200 /)
})

test.describe('under vite dev', () => {
  let dev: ChildProcess | undefined

  test.beforeAll(async () => {
    test.setTimeout(60_000)
    dev = spawn('./node_modules/.bin/vite', ['--port', String(DEV_PORT), '--strictPort'], {
      cwd: WEB,
      stdio: 'ignore',
    })
    const deadline = Date.now() + 45_000
    for (;;) {
      try {
        if ((await fetch(DEV_URL)).ok) break
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`vite dev did not answer on ${DEV_URL}`)
      await new Promise((r) => setTimeout(r, 250))
    }
  })

  test.afterAll(() => {
    dev?.kill()
  })

  test('the dev server serves every face: zero console errors, zero failed font requests', async ({ page }) => {
    const seen = watch(page)
    await page.goto(DEV_URL + appUrl({ room: 'fonts-dev', token: 'fonts-dev-token' }))
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 30_000 })
    await expectBundledFaces(page)
    await page.waitForLoadState('networkidle')
    expect(seen.errors).toEqual([])
    expect(seen.fontRequests.length).toBeGreaterThan(0)
    for (const r of seen.fontRequests) expect(r).toMatch(/^200 .*\/@fs\/.*\/libs\/ui\/fonts\//)
  })
})

const SAMPLE = 'Hamburgefonstiv quick brown fox'

/** Open the sample note and measure its first prose line against 400 and 600. */
async function expectBodyAt400(page: Page): Promise<void> {
  await page.getByTestId('file-item:notes/welcome.md').click()
  const line = page.locator('.cm-content .cm-line', { hasText: 'tracer-bullet' })
  await expect(line).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const m = await line.evaluate(async (el, sample) => {
    await document.fonts.load('400 15px "Public Sans"')
    await document.fonts.load('600 15px "Public Sans"')
    const width = (weight?: string): number => {
      const s = el.appendChild(document.createElement('span'))
      s.textContent = sample
      if (weight) s.style.fontWeight = weight
      const w = s.getBoundingClientRect().width
      s.remove()
      return w
    }
    const cs = getComputedStyle(el)
    return {
      check: document.fonts.check('400 15px "Public Sans"'),
      family: cs.fontFamily,
      weight: cs.fontWeight,
      synthesis: cs.getPropertyValue('font-synthesis'),
      inherit: width(),
      w400: width('400'),
      w600: width('600'),
    }
  }, SAMPLE)
  expect(m.check).toBe(true)
  expect(m.family).toMatch(/^"Public Sans"/)
  expect(m.weight).toBe('400')
  expect(m.synthesis).toBe('none')
  expect(m.inherit).toBeCloseTo(m.w400, 2)
  expect(Math.abs(m.w600 - m.w400)).toBeGreaterThan(0.5)
}

test('Chromium: note text is the 400 instance, distinguishable from 600', async ({ page }) => {
  await openApp(page, 'fonts-weight')
  await expectBodyAt400(page)
})

test.describe('WebKit', () => {
  let browser: Browser | undefined

  test.beforeAll(async () => {
    try {
      browser = await webkit.launch()
    } catch {
      browser = undefined
    }
  })

  test.afterAll(async () => {
    await browser?.close()
  })

  test('note text is the 400 instance, distinguishable from 600', async ({ baseURL }) => {
    test.skip(!browser, 'WebKit is not installed (npx playwright install webkit)')
    const page = await browser!.newPage({ baseURL })
    await page.goto(appUrl({ room: 'fonts-webkit' }))
    await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 30_000 })
    await expectBodyAt400(page)
    await page.close()
  })
})
