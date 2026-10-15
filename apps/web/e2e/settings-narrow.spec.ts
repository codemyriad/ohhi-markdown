/**
 * Settings in a narrow pane (settings-shaping, fix round): the nav and each
 * section measure their own width — container queries, not the viewport — so
 * a phone-width window and a split pane on a wide screen both get the narrow
 * layout. Below 32rem the side nav gives way to a `<select>` holding the same
 * sections; Customise's rows stack as cards; nothing scrolls sideways.
 */
import { expect, test, type Page } from '@playwright/test'
import { appUrl, expectAccessible, openApp, openByQuickOpen, settingsView, splitRight } from './fixtures.js'

const nav = (page: Page) => settingsView(page).getByRole('tablist', { name: 'Settings sections' })
const select = (page: Page) => settingsView(page).getByTestId('settings-tabs-select')

/** Settings' own scroller never scrolls sideways (1px of rounding allowed). */
async function expectNoSideScroll(page: Page): Promise<void> {
  const over = await settingsView(page).evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(over).toBeLessThanOrEqual(1)
}

async function openSettingsByKey(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  await expect(settingsView(page)).toBeVisible()
}

test('at phone width the nav is a select, Customise stacks, and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
  // The default layout (not the specs' `dense`, whose fixed columns leave a
  // 360px window no editor area at all): drawers, so Settings gets the width.
  await page.goto(appUrl({ room: 'settings-narrow-phone', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openSettingsByKey(page)

  await expect(select(page)).toBeVisible()
  await expect(nav(page)).toBeHidden()
  await expectNoSideScroll(page)

  for (const section of ['editor', 'layout', 'appearance', 'keys', 'sync', 'customise', 'ai', 'about']) {
    await select(page).selectOption(section)
    await expect(page.getByTestId(`settings-section:${section}`)).toBeVisible()
    await expect(settingsView(page).getByTestId('settings')).toHaveAttribute('data-section', section)
    await expectNoSideScroll(page)
  }

  // Customise: each kind is a card, not a table row squeezed into 3 columns.
  await select(page).selectOption('customise')
  const table = page.getByTestId('customise-kinds')
  await expect(table).toBeVisible()
  expect(await table.evaluate((el) => getComputedStyle(el).display)).toBe('block')
  await expectAccessible(page, 'Settings › Customise at 360px')
})

test('in a split pane on a wide screen, Settings takes the narrow layout too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page, 'settings-narrow-split')
  await openByQuickOpen(page, 'welcome')

  // One wide pane first: the side nav, no select.
  await openSettingsByKey(page)
  await expect(nav(page)).toBeVisible()
  await expect(select(page)).toBeHidden()

  // Split twice: Settings' pane is now a third of the editor area.
  await splitRight(page)
  await splitRight(page, 3)
  const width = await settingsView(page).evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeLessThan(32 * 16 + 64)
  await expect(select(page)).toBeVisible()
  await expect(nav(page)).toBeHidden()

  await select(page).selectOption('customise')
  await expect(page.getByTestId('settings-section:customise')).toBeVisible()
  await expectNoSideScroll(page)
  await expectAccessible(page, 'Settings › Customise in a split pane')
})
