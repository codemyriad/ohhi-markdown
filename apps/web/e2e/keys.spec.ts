/**
 * Settings › Keys, K1 (settings-shaping ST3) — the slice's demo: find what
 * Ctrl+E runs by pressing it, rebind another command onto it, see the clash
 * on the row, and Undo it. Every change writes through: the first one
 * creates `.ohhi/keymaps/mine.json` extending the built-in `default`.
 */
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, openApp, openSettings, settingsView } from './fixtures.js'

test('Keys: find what Ctrl+E runs, rebind onto it, see the clash, undo', async ({ page }) => {
  await openApp(page, 'keys-demo')
  await openSettings(page, 'keys')
  const view = settingsView(page)
  const rows = view.locator('[data-testid^="hotkey-row:"]')

  // Press keys: the chord is a search, and runs nothing.
  await view.getByTestId('hotkey-press-keys').click()
  await expect(view.getByTestId('hotkey-search')).toBeFocused()
  await page.keyboard.press('Control+e')
  await expect(view.getByTestId('hotkey-search')).toHaveValue('Ctrl+E')
  await expect(rows).toHaveCount(1)
  await expect(view.getByTestId('hotkey-row:view.toggle-reading')).toBeVisible()
  await expect(view).toBeVisible()
  // Escape clears the chord, a second leaves the mode.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(view.getByTestId('hotkey-press-keys')).toHaveAttribute('aria-pressed', 'false')

  // Rebind Quick open onto Ctrl+E: click its chip, press the keys.
  await view.getByTestId('hotkey-search').fill('nav.quick-open')
  await expect(rows).toHaveCount(1)
  await view.getByTestId('hotkey-chip:nav.quick-open:0').click()
  await expect(view.getByTestId('hotkey-recorder:nav.quick-open')).toBeFocused()
  await page.keyboard.press('Control+e')

  // Written at once, into a new mine.json, and the clash is on the row.
  await expect(view.getByTestId('keymap-saved')).toContainText('.ohhi/keymaps/mine.json')
  await expect(view.getByTestId('hotkey-chip:nav.quick-open:0')).toHaveText('Ctrl+E')
  await expect(view.getByTestId('hotkey-warning:nav.quick-open')).toBeVisible()
  await expect(view.getByTestId('hotkey-default:nav.quick-open')).toContainText('Ctrl+O')
  await expect(view.getByTestId('keymap-source')).toContainText('.ohhi/keymaps/mine.json')
  await expectAccessible(page, 'settings keys after a change')

  // Undo: the key, the default and the keymap in use all come back.
  await view.getByTestId('keymap-undo').click()
  await expect(view.getByTestId('hotkey-chip:nav.quick-open:0')).toHaveText('Ctrl+O')
  await expect(view.getByTestId('hotkey-warning:nav.quick-open')).toHaveCount(0)
  await expect(view.getByTestId('hotkey-default:nav.quick-open')).toHaveCount(0)
  await expect(view.getByTestId('keymap-source')).not.toContainText('mine.json')
})

/** `.ohhi/keymaps/<file>` from the browser vault's OPFS folder, as an agent on disk would read it. */
async function readKeymapFile(page: Page, file: string): Promise<string | null> {
  return page.evaluate(async (file) => {
    const root = await navigator.storage.getDirectory()
    const vaults = await root.getDirectoryHandle('vaults')
    for await (const [, vault] of (vaults as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      if (vault.kind !== 'directory') continue
      try {
        let dir = vault as FileSystemDirectoryHandle
        for (const seg of ['.ohhi', 'keymaps']) dir = await dir.getDirectoryHandle(seg)
        return await (await (await dir.getFileHandle(file)).getFile()).text()
      } catch {
        // Not in this vault.
      }
    }
    return null
  }, file)
}

test('Keys: a change lands in mine.json as one binding over default, and the new key works at once', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('start-browser-vault').click()
  await page.getByTestId('new-vault-name').fill('Keys')
  await page.getByTestId('create-vault').click()
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })

  await openSettings(page, 'keys')
  const view = settingsView(page)
  await view.getByTestId('hotkey-search').fill('nav.quick-open')
  await view.getByTestId('hotkey-chip:nav.quick-open:0').click()
  await expect(view.getByTestId('hotkey-recorder:nav.quick-open')).toBeFocused()
  // A letter alone is refused, and recording goes on.
  await page.keyboard.press('q')
  await expect(view.getByTestId('keymap-save-error')).not.toBeEmpty()
  await expect(view.getByTestId('hotkey-recorder:nav.quick-open')).toBeFocused()
  await page.keyboard.press('Alt+q')
  await expect(view.getByTestId('keymap-saved')).toContainText('.ohhi/keymaps/mine.json')
  // The focus is back on the row's chip, not the page.
  await expect(view.getByTestId('hotkey-chip:nav.quick-open:0')).toBeFocused()

  // The file: extends the built-in default and holds exactly the one change.
  await expect.poll(async () => JSON.parse((await readKeymapFile(page, 'mine.json')) ?? 'null')).toMatchObject({
    extends: 'default',
    bindings: { 'nav.quick-open': 'Alt+q' },
  })
  const file = JSON.parse((await readKeymapFile(page, 'mine.json'))!) as { bindings: Record<string, unknown> }
  expect(Object.keys(file.bindings)).toEqual(['nav.quick-open'])

  // The new key runs Quick open straight away.
  await page.keyboard.press('Alt+q')
  await expect(page.getByTestId('quick-open-input')).toBeVisible()
})
