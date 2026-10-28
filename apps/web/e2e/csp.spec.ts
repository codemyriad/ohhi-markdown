/**
 * The public web app under its own Content Security Policy: `public/_headers`
 * forbids eval (no 'unsafe-eval'). The preview server does not apply
 * `_headers`, so the document is served here with that policy, and every
 * `securitypolicyviolation` the page fires is recorded from before its first
 * script runs.
 *
 * What it guards: zod 4 probes `new Function('')` when an object schema is
 * built unless `jitless` was set first (src/lib/zod-jitless.ts, imported
 * first by main.ts), and the legacy Pug grammar compiled attribute values
 * with `Function(…)` while highlighting a ```pug fence (dropped from the
 * fence grammars in libs/editor). Either one is a console error in Firefox.
 */
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openApp, paneContent } from './fixtures.js'

const HEADERS = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
const POLICY = /Content-Security-Policy: (.*)/.exec(HEADERS)![1]

test('the app boots and highlights code under its CSP without one violation', async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const response = await route.fetch()
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': POLICY } })
  })
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __csp: string[] }).__csp = seen
    document.addEventListener('securitypolicyviolation', (e) =>
      seen.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}:${e.columnNumber}`)
    )
  })

  await openApp(page, 'csp-boot')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await paneContent(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('```pug\ndiv(class=foo, id="x") hello\n```\n\n```ts\nconst x: number = 1\n```\n\nafter\n')
  // Both fences drawn as code cards: their grammars have loaded and run.
  await expect(paneContent(page).locator('.cm-live-code')).toHaveCount(2)
  await page.waitForTimeout(500)

  expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([])
})
