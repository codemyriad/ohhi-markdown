/**
 * Chrome (chrome-shaping U2+): the shell around the editor, driven the way a
 * person drives it — rails, navigator width, breadcrumb, status bar. Memory
 * vault contract, like v2.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test'

const RELAY = 'ws://localhost:8799'

async function openApp(page: Page, room: string): Promise<void> {
  const params = new URLSearchParams({
    mode: 'memory',
    role: 'seed',
    relay: RELAY,
    room,
    token: 'e2e-token',
    user: 'Chris',
  })
  await page.goto(`/?${params.toString()}`)
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

test('the right rail collapses to icons, reopens to the section clicked, and Mod+ArrowRight toggles it', async ({
  page,
}) => {
  await openApp(page, 'chrome-rail')
  const rail = page.getByTestId('right-rail')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('rail-section:links')).toBeVisible()

  await page.getByTestId('rail-collapse').click()
  await expect(rail).toHaveAttribute('data-state', 'collapsed')
  await expect(page.getByTestId('rail-icon:links')).toBeVisible()
  await expect(page.getByTestId('links-panel')).toHaveCount(0)

  // Fold the section, collapse, then click its icon: the rail opens AND the section unfolds.
  await page.getByTestId('rail-icon:links').click()
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await page.getByTestId('rail-fold:links').click()
  await expect(page.getByTestId('rail-fold:links')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('rail-collapse').click()
  await page.getByTestId('rail-icon:links').click()
  await expect(page.getByTestId('rail-fold:links')).toHaveAttribute('aria-expanded', 'true')

  // Chris's own Obsidian key for the right sidebar.
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(rail).toHaveAttribute('data-state', 'collapsed')
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
})

test('the navigator resizes from the keyboard, hides on Mod+ArrowLeft, and the layout survives a reload', async ({
  page,
}) => {
  await openApp(page, 'chrome-nav')
  const navigator = page.getByTestId('navigator')
  await expect(navigator).toHaveCSS('width', '288px')

  await page.getByTestId('tree-resize').focus()
  await page.keyboard.press('End')
  await expect(navigator).toHaveCSS('width', '640px')
  await page.keyboard.press('ArrowLeft')
  await expect(navigator).toHaveCSS('width', '624px')

  await page.getByTestId('rail-collapse').click()
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCSS('width', '624px')
  await expect(page.getByTestId('right-rail')).toHaveAttribute('data-state', 'collapsed')

  await page.keyboard.press('ControlOrMeta+ArrowLeft')
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await page.getByTestId('toggle-tree').click()
  await expect(page.getByTestId('navigator')).toBeVisible()
})

test('the breadcrumb names the open note and reveals its folder; the status bar carries the word count and the note pill', async ({
  page,
}) => {
  await openApp(page, 'chrome-crumb')
  await expect(page.getByTestId('breadcrumb')).toHaveText('No note open')
  await expect(page.getByTestId('word-count')).toHaveCount(0)

  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(page.getByTestId('crumb:notes')).toBeVisible()
  await expect(page.getByTestId('crumb-note')).toHaveText('welcome')
  await expect(page.getByTestId('status-bar').getByTestId('word-count')).toBeVisible()
  await expect(page.getByTestId('sync-pill-note')).toBeVisible()

  // Collapse the folder in the tree, then ask the breadcrumb to reveal it.
  await page.getByTestId('dir-item:notes').click()
  await page.getByTestId('dir-item:notes').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('crumb:notes').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-selected', 'true')

  // The ways in live in the navigator now, with their keys beside them.
  await expect(page.getByTestId('actions').getByTestId('open-search')).toContainText('Search')
  await page.getByTestId('open-quick-open').click()
  await expect(page.getByTestId('quick-open-input')).toBeVisible()
})
