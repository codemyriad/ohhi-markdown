/**
 * Small screens (QA round 1, 2026-10-15): below the shell's one breakpoint,
 * 40rem (`lib/small-screen.svelte.ts`), the shell behaves like a phone's.
 * Every case boots the quiet default (`layout: null`) at a phone's width,
 * with touch on, as Chris uses it.
 */
import { expect, test, type Page } from '@playwright/test'
import { appUrl, expectAccessible, openByQuickOpen, paneContent } from './fixtures.js'

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true })

const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Note toolbar' })
const formatBar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
const corner = (page: Page) => page.getByTestId('corner-status')

async function boot(page: Page, room: string): Promise<void> {
  await page.goto(appUrl({ room, layout: null }))
  await expect(toolbar(page)).toBeVisible({ timeout: 15_000 })
}

test('the format bar scrolls across most of the row, and the word count is a chip at its right end', async ({
  page,
}) => {
  await boot(page, 'small-format')
  await openByQuickOpen(page, 'welcome')
  const bar = page.getByTestId('format-bar')
  // Never folded into the Format menu here: every command a button, on one row that scrolls.
  await expect(formatBar(page).getByTestId('toolbar-format-menu')).toBeHidden()
  await expect(formatBar(page).getByTestId('toolbar:format.bold')).toBeVisible()
  const scroll = page.getByTestId('format-bar-scroll')
  expect(await scroll.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
  await expect(scroll).toHaveAttribute('data-more-end', 'true')
  await scroll.evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect(scroll).toHaveAttribute('data-more-start', 'true')

  // Most of the width: the bar and the chip share the row, the bar the lion's share.
  const area = (await page.getByTestId('editor-area').boundingBox())!
  const box = (await bar.boundingBox())!
  const chip = (await corner(page).boundingBox())!
  expect(box.width).toBeGreaterThan(area.width * 0.7)
  expect(chip.x).toBeGreaterThanOrEqual(box.x + box.width)
  expect(chip.x + chip.width).toBeLessThanOrEqual(area.x + area.width)
  expect(Math.abs(chip.y + chip.height - (box.y + box.height))).toBeLessThan(6)

  // The chip: the number alone ("1,204"), the words for a screen reader; a tap shows them all.
  const toggle = corner(page).getByTestId('corner-status-toggle')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle.locator('[aria-hidden="true"]')).toHaveText(/^[\d,]+$/)
  await expect(toggle).toHaveAccessibleName(/^[\d,]+ words?$/)
  await expect(corner(page).getByTestId('char-count')).toHaveCount(0)
  await expectAccessible(page, 'small screen: format bar and count chip')
  await toggle.tap()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(corner(page).getByTestId('word-count')).toHaveText(/^[\d,]+ words?$/)
  await expect(corner(page).getByTestId('char-count')).toHaveText(/^[\d,]+ characters?$/)
  await toggle.tap()
  await expect(corner(page).getByTestId('char-count')).toHaveCount(0)

  // Nothing scrolls sideways but the bar itself.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0)
  await expect(paneContent(page)).toBeVisible()
})

test('a tap in the note closes the file drawer and the dock panel', async ({ page }) => {
  await boot(page, 'small-collapse')
  await openByQuickOpen(page, 'welcome')
  const note = paneContent(page)
  const box = (await note.boundingBox())!

  // The drawer floats over the note's left: tap the note beside it.
  await toolbar(page).getByTestId('toggle-tree').tap()
  await expect(page.getByTestId('navigator-drawer')).toBeVisible()
  await page.touchscreen.tap(box.x + box.width - 12, box.y + 12)
  await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)

  // The dock's panel floats over its right.
  await page.getByTestId('dock').locator('button').first().tap()
  await expect(page.getByTestId('dock-panel')).toBeVisible()
  await page.touchscreen.tap(box.x + 12, box.y + 12)
  await expect(page.getByTestId('dock-panel')).toHaveCount(0)

  // A wide screen keeps today's rule: a click in the note leaves the drawer open.
  await page.setViewportSize({ width: 1100, height: 780 })
  await toolbar(page).getByTestId('toggle-tree').click()
  await expect(page.getByTestId('navigator-drawer')).toBeVisible()
  const wide = (await note.boundingBox())!
  await page.mouse.click(wide.x + wide.width - 12, wide.y + 12)
  await expect(page.getByTestId('navigator-drawer')).toBeVisible()
})

test('a pin is kept but not honoured: the side floats here, and its pin says pins apply on wider screens', async ({
  page,
}) => {
  // Pin the navigator on a wide window: a column.
  await page.setViewportSize({ width: 1100, height: 780 })
  await boot(page, 'small-pins')
  await openByQuickOpen(page, 'welcome')
  await toolbar(page).getByTestId('toggle-tree').click()
  await page.getByTestId('navigator-drawer').getByTestId('navigator-pin').click()
  await expect(page.getByTestId('navigator')).toBeVisible()
  await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)

  // A phone's width: no column — the drawer, closed, as if unpinned.
  await page.setViewportSize({ width: 390, height: 780 })
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await toolbar(page).getByTestId('toggle-tree').tap()
  const drawer = page.getByTestId('navigator-drawer')
  await expect(drawer).toBeVisible()
  const pin = drawer.getByTestId('navigator-pin')
  await expect(pin).toHaveAttribute('aria-disabled', 'true')
  await expect(pin).toHaveAccessibleName('Pinned on wider screens — it floats here')
  await expectAccessible(page, 'small screen: the drawer with its pin held')
  // A tap says why (a finger gets no tooltip), and pins nothing.
  // (`force`: Playwright counts aria-disabled as not enabled; a finger does not.)
  await pin.tap({ force: true })
  await expect(page.getByTestId('toast').filter({ hasText: 'Pinned on wider screens' })).toBeVisible()
  await expect(page.getByTestId('navigator-unpin')).toHaveCount(0)

  // The dock's pin says the same, unpinned.
  const box = (await paneContent(page).boundingBox())!
  await page.touchscreen.tap(box.x + box.width - 12, box.y + 12)
  await expect(drawer).toHaveCount(0)
  await page.getByTestId('dock').locator('button').first().tap()
  const railPin = page.getByTestId('dock-panel').getByTestId('rail-pin')
  await expect(railPin).toHaveAttribute('aria-disabled', 'true')
  await expect(railPin).toHaveAccessibleName('Pins apply on wider screens')

  // Wide again: the pin was kept all along.
  await page.setViewportSize({ width: 1100, height: 780 })
  await expect(page.getByTestId('navigator')).toBeVisible()
  await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
  await expect(page.getByTestId('navigator-unpin')).toBeVisible()
})
