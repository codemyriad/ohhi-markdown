/**
 * The `[[` link popover (editor-usability E1): the compact rows, the footer
 * of key hints, Tab accepting like Enter, and the link closed with the caret
 * after `]]`. Ranking, scope and the apply rules are unit-tested in
 * libs/editor-lang (link-completion.test.ts); this is the real-browser smoke.
 */
import { expect, test, type Page } from '@playwright/test'
import { appUrl, openByQuickOpen } from './fixtures.js'

const content = (page: Page) => page.locator('[data-testid="editor-pane"] .cm-content')
const popover = (page: Page) => page.locator('.cm-tooltip-autocomplete.cm-link-popover')

test('the popover ranks, shows its hints, and Tab writes a closed link', async ({ page }) => {
  await page.goto(appUrl({ room: 'link-popover', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'ideas')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nsee [[welc')

  await expect(popover(page)).toBeVisible()
  const first = popover(page).locator('li').first()
  await expect(first).toContainText('welcome')
  // The matched part of the name is bold, on one ~22px line.
  await expect(first.locator('.cm-completionMatchedText')).toHaveText('welc')
  const row = (await first.boundingBox())!
  expect(row.height).toBeLessThan(26)
  await expect(popover(page).locator('.cm-link-footer')).toContainText('link')

  await page.keyboard.press('Tab')
  await expect(popover(page)).toHaveCount(0)
  await page.keyboard.type('!')
  await expect(content(page)).toContainText('see [[welcome]]!')
  // closeBrackets paired the typed `[[` (`[[welc]]`); the accept steps over
  // that `]]` rather than writing a second one.
  const doc = await content(page).evaluate((el) => {
    type Tile = { root?: { view?: { state: { doc: { toString(): string } } } } }
    return (el as unknown as { cmTile?: Tile }).cmTile?.root?.view?.state.doc.toString() ?? ''
  })
  expect(doc.split('\n').at(-1)).toBe('see [[welcome]]!')
})
