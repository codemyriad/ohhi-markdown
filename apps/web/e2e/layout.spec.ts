/**
 * The layout (foundations Stage 1, quiet-shell F1/F2; round 3 Q6): the shell
 * renders from a layout file. A new install runs `default` — one toolbar, the
 * navigator as a drawer, the dock, the format bar at the bottom — and
 * Settings › Layout edits THIS DEVICE's overrides over it, live: the shell
 * changes under the open dialog, the change persists, and closing never asks
 * about it. Choosing a layout FILE is the palette's *Use layout file…*. Every
 * other spec boots the `dense` example (fixtures.ts forces `?layout=dense`).
 */
import { expect, test, type Page } from '@playwright/test'
import { appUrl, closeSettings, dismissToasts, expectAccessible, openByQuickOpen, openSettings, settingsView } from './fixtures.js'

const openLayoutSettings = async (page: Page): Promise<void> => {
  await openSettings(page, 'layout')
  await expect(page.getByTestId('settings-layout')).toBeVisible()
}

test('a new install boots the default layout: no navigator column, the rail closed, the format bar at the bottom', async ({
  page,
}) => {
  await page.goto(appUrl({ room: 'layout-default', layout: null }))
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await expect(page.getByTestId('toggle-tree')).toHaveAttribute('aria-pressed', 'false')
  // `rail: "dock"`: the note sections float over the editor, not a column.
  await expect(page.getByTestId('right-rail')).toHaveCount(0)
  // P1/P2: the header is arrows, a title and the readouts; formatting is its own bar.
  await expect(page.getByRole('banner').getByTestId('nav')).toBeVisible()
  await expect(page.getByRole('banner').getByTestId('toolbar-format')).toHaveCount(0)
  await expect(page.getByTestId('format-bar')).toHaveCount(1)
  // Round 3 (Q4, Q5): no mode menu and no word count in the toolbar.
  await expect(page.getByTestId('toolbar').locator('[data-testid$="mode-menu"]')).toHaveCount(0)
  await expect(page.getByTestId('toolbar').locator('[data-testid$="word-count"]')).toHaveCount(0)

  // Nothing is lost, only closed: the column is one toggle away.
  await page.getByTestId('toggle-tree').click()
  await expect(page.getByTestId('file-tree')).toBeVisible()
})

test('Settings › Layout applies live beside the shell, closes without asking, persists, and Reset to default restores (Q6)', async ({
  page,
}) => {
  await page.goto(appUrl({ room: 'layout-live', layout: null }))
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('toolbar')).toHaveAttribute('data-position', 'top')

  await openLayoutSettings(page)
  // One form: no layout cards, no names, no Save.
  await expect(page.locator('[data-testid^="layout-card:"]')).toHaveCount(0)
  await expect(page.getByTestId('layout-save')).toHaveCount(0)
  await expect(page.getByTestId('layout-reset')).toBeDisabled()

  // The toolbar moves while Settings is still open (a tab, not a dialog).
  await page.getByTestId('layout-field:toolbar').selectOption('bottom')
  await expect(settingsView(page)).toBeVisible()
  await expect(page.getByTestId('toolbar')).toHaveAttribute('data-position', 'bottom')

  // Closing the tab asks nothing: there is nothing to save.
  await closeSettings(page)

  // The choice is this device's: it survives a reload (the memory boot URL has no `?layout=`).
  await page.reload()
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('toolbar')).toHaveAttribute('data-position', 'bottom')

  // Reset to default puts the file's own settings back, at once.
  await openLayoutSettings(page)
  await expect(page.getByTestId('layout-field:toolbar')).toHaveValue('bottom')
  await page.getByTestId('layout-reset').click()
  await expect(page.getByTestId('layout-field:toolbar')).toHaveValue('top')
  await expect(page.getByTestId('toolbar')).toHaveAttribute('data-position', 'top')
  await expect(page.getByTestId('layout-reset')).toBeDisabled()
})

test('the Files field turns the drawer into a column at once; a pin reads "(pinned)" with Unpin beside it', async ({
  page,
}) => {
  await page.goto(appUrl({ room: 'layout-files', layout: null }))
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCount(0)

  await openLayoutSettings(page)
  await page.getByTestId('layout-field:files').selectOption('column')
  await expect(page.getByTestId('navigator')).toBeVisible()
  await page.getByTestId('layout-field:files').selectOption('drawer')
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await closeSettings(page)

  // A pin (the dock's icon) wins over the field, and the form says so.
  await page.getByTestId('rail-expand').click()
  await page.getByTestId('rail-pin').click()
  await expect(page.getByTestId('right-rail')).toBeVisible()
  await openLayoutSettings(page)
  await expect(page.getByTestId('layout-field:sidebar')).toHaveCount(0)
  await expect(page.getByTestId('layout-pinned:sidebar')).toContainText('(pinned)')
  await page.getByTestId('layout-unpin:sidebar').click()
  await expect(page.getByTestId('layout-field:sidebar')).toHaveValue('dock')
  await expect(page.getByTestId('right-rail')).toHaveCount(0)
})

test('Customise cannot hide the note pill: the word count off and the toolbar at the bottom keep sync on screen (golden rule 4)', async ({
  page,
}) => {
  await page.goto(appUrl({ room: 'layout-pill', layout: null }))
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')

  await openLayoutSettings(page)
  await page.getByTestId('layout-field:status').selectOption('off')
  await page.getByTestId('layout-field:toolbar').selectOption('bottom')
  await closeSettings(page)
  await expect(page.getByTestId('sync-pill-note')).toBeVisible()
})

test('the palette’s Use layout file… lists a vault file beside Default and applies it (Q6)', async ({ page }) => {
  // A browser vault in the default layout (the fixture's helper waits for dense's column).
  await page.goto('/')
  await page.getByTestId('start-browser-vault').click()
  await page.getByTestId('new-vault-name').fill('Layouts')
  await page.getByTestId('create-vault').click()
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCount(0)

  // An agent's file in the vault: `.ohhi/layouts/columns.json`.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const vaults = await root.getDirectoryHandle('vaults')
    for await (const [, vault] of (vaults as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (vault.kind !== 'directory') continue
      let dir = vault as FileSystemDirectoryHandle
      for (const seg of ['.ohhi', 'layouts']) dir = await dir.getDirectoryHandle(seg, { create: true })
      const file = await dir.getFileHandle('columns.json', { create: true })
      const w = await file.createWritable()
      await w.write(
        JSON.stringify({ $schema: 'ohhi.layout.v1', extends: 'default', regions: { navigator: 'column' } })
      )
      await w.close()
    }
  })

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Use layout file')
  await expect(page.getByTestId('command-palette-row').first()).toContainText('Use layout file')
  await page.keyboard.press('Enter')

  const rows = page.getByTestId('layout-picker-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Default')
  await expect(rows.nth(0)).toContainText('in use')
  await expect(rows.nth(1)).toContainText('columns')
  await expect(rows.nth(1)).toContainText('.ohhi/layouts/columns.json')
  await rows.nth(1).click()
  await expect(page.getByTestId('navigator')).toBeVisible()

  // Settings never names the file: its form edits the overrides over whichever is in use.
  await openLayoutSettings(page)
  await expect(page.getByTestId('layout-field:files')).toHaveValue('column')
  await expect(page.getByTestId('settings-layout')).not.toContainText('columns')
})

test('the navigator’s pin lives in a header row the tab strip’s height, in the drawer and as a column (Chris, 2026-10-06)', async ({
  page,
}) => {
  await page.goto(appUrl({ room: 'layout-nav-header', layout: null }))
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')
  await dismissToasts(page)
  const strip = (await page.locator('[data-strip]').first().boundingBox())!

  // The drawer: pin at the header's right end, nothing pinned in the foot.
  await page.keyboard.press('ControlOrMeta+ArrowLeft')
  const drawer = page.getByTestId('navigator-drawer')
  const header = drawer.getByTestId('navigator-header')
  await expect(header.getByTestId('navigator-pin')).toBeVisible()
  expect((await header.boundingBox())!.height).toBe(strip.height)
  const settings = (await drawer.getByTestId('open-settings').boundingBox())!
  const pin = (await header.getByTestId('navigator-pin').boundingBox())!
  expect(pin.y).toBeLessThan(settings.y)
  await expectAccessible(page, 'the navigator drawer with its header')

  // Pinned: a column, the same header now offering unpin, level with the strip.
  await header.getByTestId('navigator-pin').click()
  const column = page.getByTestId('navigator')
  await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
  const colHeader = column.getByTestId('navigator-header')
  await expect(colHeader.getByTestId('navigator-unpin')).toBeVisible()
  await expect(column.getByTestId('navigator-pin')).toHaveCount(0)
  const box = (await colHeader.boundingBox())!
  const stripNow = (await page.locator('[data-strip]').first().boundingBox())!
  expect(box.y).toBe(stripNow.y)
  expect(box.height).toBe(stripNow.height)
  await colHeader.getByTestId('navigator-unpin').click()
  await expect(column).toHaveCount(0)
})
