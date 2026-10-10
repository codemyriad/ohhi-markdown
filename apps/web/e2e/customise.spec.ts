/**
 * Settings › Customise (settings-shaping ST4; quiet-shell F16): the demo — a
 * broken layout file in the vault's `.ohhi/layouts/` shows up under
 * Problems and stays there until it is fixed; *Reload files* runs
 * `app.reload-resources`. A browser vault: the file is written straight
 * into OPFS, as an agent's would land on disk (nothing watches OPFS, so the
 * reload is the way the app reads it again).
 */
import { expect, test, type Page } from '@playwright/test'
import { dismissToasts, expectAccessible, openSettings, runCommand } from './fixtures.js'

/** Write `.ohhi/layouts/<file>` into every browser vault's OPFS folder. */
async function writeLayoutFile(page: Page, file: string, text: string): Promise<void> {
  await page.evaluate(
    async ({ file, text }) => {
      const root = await navigator.storage.getDirectory()
      const vaults = await root.getDirectoryHandle('vaults')
      for await (const [, vault] of (vaults as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
        if (vault.kind !== 'directory') continue
        let dir = vault as FileSystemDirectoryHandle
        for (const seg of ['.ohhi', 'layouts']) dir = await dir.getDirectoryHandle(seg, { create: true })
        const handle = await dir.getFileHandle(file, { create: true })
        const w = await handle.createWritable()
        await w.write(text)
        await w.close()
      }
    },
    { file, text }
  )
}

test('a broken layout file shows up under Problems and stays until it is fixed (ST4 demo)', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start-browser-vault').click()
  await page.getByTestId('new-vault-name').fill('Customise')
  await page.getByTestId('create-vault').click()
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })

  await openSettings(page, 'customise')
  const section = page.getByTestId('settings-section:customise')
  await expect(section.getByTestId('customise-problems-none')).toBeVisible()
  await expect(section.getByTestId('customise-root:vault')).toContainText('.ohhi, in this browser')
  await expect(section.getByTestId('customise-in-use:layouts')).toContainText('default')

  // An agent's file that is not JSON.
  await writeLayoutFile(page, 'focus.json', '{ "$schema": "ohhi.layout.v1", "extends": "default",')
  await section.getByTestId('customise-reload').click()
  const problem = section.getByTestId('customise-problem:.ohhi/layouts/focus.json')
  await expect(problem).toBeVisible()
  await expect(problem).toContainText('not JSON')
  await expect(section.getByTestId('customise-entry:layouts:focus')).toBeVisible()
  await expectAccessible(page, 'Settings › Customise with a problem listed')

  // Another section and back: still listed — it is read from the files, not a notice.
  await page.getByTestId('settings-tab:layout').click()
  await page.getByTestId('settings-tab:customise').click()
  await expect(problem).toBeVisible()

  // Fixed: gone on the next reload.
  await writeLayoutFile(page, 'focus.json', JSON.stringify({ $schema: 'ohhi.layout.v1', extends: 'default' }))
  await section.getByTestId('customise-reload').click()
  await expect(section.getByTestId('customise-problems-none')).toBeVisible()
  await expect(problem).toHaveCount(0)
  await expect(section.getByTestId('customise-entry:layouts:focus')).toBeVisible()
})

/** A browser vault in the default layout, shell on screen. */
async function browserVault(page: Page, name: string): Promise<void> {
  await page.goto('/')
  await page.getByTestId('start-browser-vault').click()
  await page.getByTestId('new-vault-name').fill(name)
  await page.getByTestId('create-vault').click()
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
}

const RELOAD = 'Reload layouts and resources'

test('the palette names each layout file’s root, and a broken one says it can’t be used (ST6)', async ({ page }) => {
  await browserVault(page, 'Doors')
  await writeLayoutFile(page, 'focus.json', JSON.stringify({ $schema: 'ohhi.layout.v1', extends: 'default' }))
  await writeLayoutFile(page, 'broken.json', '{ "extends": ')
  await runCommand(page, RELOAD)
  await dismissToasts(page)

  await runCommand(page, 'Use layout file')
  const rows = page.getByTestId('layout-picker-row')
  await expect(rows).toHaveCount(3)
  const row = (id: string) => page.locator(`[data-testid="layout-picker-row"][data-row-id="${id}"]`)
  await expect(row('default').getByTestId('layout-picker-source')).toHaveText('built in')
  await expect(row('custom:focus').getByTestId('layout-picker-source')).toHaveText('this vault')
  await expect(row('custom:broken').getByTestId('layout-picker-source')).toContainText('this vault')
  await expect(row('custom:broken').getByTestId('layout-picker-source')).toContainText('can’t be used')
  await expectAccessible(page, 'the layout picker with source labels')
})

test('a reloaded layout says so with Undo, which goes back for this session only (ST6)', async ({ page }) => {
  await browserVault(page, 'Reloads')
  const column = JSON.stringify({ $schema: 'ohhi.layout.v1', extends: 'default', regions: { navigator: 'column' } })
  await writeLayoutFile(page, 'focus.json', column)
  await runCommand(page, RELOAD)
  await runCommand(page, 'Use layout file')
  await page.locator('[data-testid="layout-picker-row"][data-row-id="custom:focus"]').click()
  await expect(page.getByTestId('navigator')).toBeVisible()
  await dismissToasts(page)

  // An agent changes the file in use; Reload files reads it.
  await writeLayoutFile(page, 'focus.json', JSON.stringify({ $schema: 'ohhi.layout.v1', extends: 'default' }))
  await runCommand(page, RELOAD)
  const toast = page.getByTestId('toast').filter({ hasText: 'Layout focus.json reloaded from this vault' })
  await expect(toast).toHaveCount(1)
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await expectAccessible(page, 'the reload toast')

  await toast.getByTestId('toast-action').click()
  await expect(page.getByTestId('navigator')).toBeVisible()
  await expect(page.getByTestId('toast').filter({ hasText: /Back to the layout you had/ })).toHaveCount(1)

  // Settings › Customise says the layout is held; the Log's Customise chip keeps the reload.
  await openSettings(page, 'customise')
  await expect(page.getByTestId('customise-held')).toBeVisible()
  await page.getByTestId('customise-show-log').click()
  await expect(page.getByTestId('log-customise')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('log-rows')).toContainText('Layout focus.json reloaded from this vault')
})

test('the empty tab’s launcher opens Settings › Customise; a browser shows no agent door (ST6)', async ({ page }) => {
  await browserVault(page, 'Launcher')
  await runCommand(page, 'New tab')
  const customise = page.locator('[data-testid^="empty-tab:"][data-testid$="-customise"]').first()
  await expect(customise).toBeVisible()
  await expect(page.locator('[data-testid^="empty-tab:"][data-testid$="-agents"]')).toHaveCount(0)
  await expectAccessible(page, 'the launcher with its Settings doors')
  await customise.click()
  await expect(page.getByTestId('settings-section:customise')).toBeVisible()
  await expect(page.getByTestId('customise-guide')).toBeVisible()
})
