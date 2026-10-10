/**
 * Settings › Customise (settings-shaping ST4; quiet-shell F16): the demo — a
 * broken layout file in the vault's `.ohhi/layouts/` shows up under
 * Problems and stays there until it is fixed; *Reload files* runs
 * `app.reload-resources`. A browser vault: the file is written straight
 * into OPFS, as an agent's would land on disk (nothing watches OPFS, so the
 * reload is the way the app reads it again).
 */
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, openSettings } from './fixtures.js'

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
