/**
 * Settings in a narrow pane (settings-shaping fix round; QA round 1's nav):
 * Settings measures its own width — a container query, not the viewport —
 * so a phone-width window and a split pane on a wide screen both get the
 * narrow form. Below 32rem the nav is an icon rail (N3 — Chris: "I like the
 * icon rail"): the same tablist, each tab a glyph with its name (the tab's
 * `aria-label`, and a tooltip on hover and keyboard focus), one tab stop,
 * arrows moving; the active tab marked; the section takes the rest of the
 * width. Customise's rows stack; nothing scrolls sideways.
 */
import { expect, test, type Page } from '@playwright/test'
import { appUrl, expectAccessible, openApp, openByQuickOpen, settingsView, splitRight } from './fixtures.js'

const nav = (page: Page) => settingsView(page).getByRole('tablist', { name: 'Settings sections' })
const tab = (page: Page, id: string) => settingsView(page).getByTestId(`settings-tab:${id}`)

const SECTIONS: [id: string, name: string][] = [
  ['customise', 'Customise'],
  ['editor', 'Editor'],
  ['layout', 'Layout'],
  ['appearance', 'Appearance'],
  ['keys', 'Keys'],
  ['sync', 'Sync & devices'],
  ['ai', 'AI'],
  ['developer', 'Developer'],
  ['about', 'About'],
]

/** Settings' own scroller never scrolls sideways (1px of rounding allowed). */
async function expectNoSideScroll(page: Page): Promise<void> {
  const over = await settingsView(page).evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(over).toBeLessThanOrEqual(1)
}

async function openSettingsByKey(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  await expect(settingsView(page)).toBeVisible()
}

/** The nav is the rail: about 44px wide, the labels gone from sight, a glyph in every tab. */
async function expectRail(page: Page): Promise<void> {
  const width = await nav(page).evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeLessThanOrEqual(48)
  for (const [id, name] of SECTIONS) {
    const t = tab(page, id)
    await expect(t).toHaveAccessibleName(name)
    await expect(t.locator('svg')).toBeVisible()
    // The label is still in the tab (its name), but not drawn.
    expect(await t.locator('span').evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
  }
}

test('at phone width the nav is an icon rail: named tabs, a tooltip on focus, arrows move; Customise stacks; nothing scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 })
  // The default layout (not the specs' `dense`, whose fixed columns leave a
  // 360px window no editor area at all): drawers, so Settings gets the width.
  await page.goto(appUrl({ room: 'settings-narrow-phone', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openSettingsByKey(page)

  await expect(nav(page)).toBeVisible()
  await expectRail(page)
  await expectNoSideScroll(page)
  // It opens on the hub; the active tab is marked by more than its colour: a tint and a bar.
  await expect(tab(page, 'customise')).toHaveAttribute('aria-selected', 'true')
  const marked = await tab(page, 'customise').evaluate((el) => {
    const css = getComputedStyle(el)
    return { bg: css.backgroundColor, bar: css.boxShadow }
  })
  expect(marked.bg).not.toBe('rgba(0, 0, 0, 0)')
  expect(marked.bar).toContain('inset')
  await expectAccessible(page, 'Settings › Customise at 360px, the rail')

  // One tab stop; the tooltip names the tab on keyboard focus.
  await tab(page, 'customise').focus()
  await expect(page.getByRole('tooltip')).toHaveText('Customise')
  await expectAccessible(page, 'the rail with a tooltip')
  await page.keyboard.press('ArrowDown')
  await expect(tab(page, 'editor')).toBeFocused()
  await expect(tab(page, 'editor')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('settings-section:editor')).toBeVisible()
  await expect(page.getByRole('tooltip')).toHaveText('Editor')
  await expect(tab(page, 'customise')).toHaveAttribute('tabindex', '-1')

  // Every section by tap; the section has the width the rail leaves.
  for (const [id] of SECTIONS) {
    await tab(page, id).click()
    await expect(page.getByTestId(`settings-section:${id}`)).toBeVisible()
    await expect(settingsView(page).getByTestId('settings')).toHaveAttribute('data-section', id)
    await expectNoSideScroll(page)
  }

  // Customise: each kind is a card, not a table row squeezed into 3 columns.
  await tab(page, 'customise').click()
  const table = page.getByTestId('customise-kinds')
  await expect(table).toBeVisible()
  expect(await table.evaluate((el) => getComputedStyle(el).display)).toBe('block')
  await expectAccessible(page, 'Settings › Customise at 360px')
})

test('in a split pane on a wide screen, Settings takes the rail too', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await openApp(page, 'settings-narrow-split')
  await openByQuickOpen(page, 'welcome')

  // One wide pane first: the labelled tree, Customise's parts under it, no tooltips.
  await openSettingsByKey(page)
  await expect(nav(page)).toBeVisible()
  expect(await nav(page).evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(150)
  await expect(tab(page, 'layout')).toHaveText('Layout')
  await expect(tab(page, 'layout').locator('span')).toBeVisible()
  await tab(page, 'layout').focus()
  await expect(page.getByRole('tooltip')).toBeHidden()

  // Split twice: Settings' pane is now a third of the editor area.
  await splitRight(page)
  await splitRight(page, 3)
  const width = await settingsView(page).evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeLessThan(32 * 16 + 64)
  await expectRail(page)

  await tab(page, 'customise').click()
  await expect(page.getByTestId('settings-section:customise')).toBeVisible()
  await expectNoSideScroll(page)
  await expectAccessible(page, 'Settings › Customise in a split pane')
})
