/**
 * Sharing the folder of the note you are writing in: the note stays open
 * through the share, and what is typed after it reaches the person the link
 * is for. The share moves the folder's docs into a new mount (a carve) and
 * destroys the instances the vault held; the pane used to keep its old one,
 * so everything typed after the share went into a doc nobody synced (the
 * workaround was to close the note first).
 */
import { expect, test } from '@playwright/test'
import { decodeShareLink } from '../src/lib/share-link.js'
import { RELAY, appUrl, openApp, paneContent } from './fixtures.js'

test('a note open while its folder is shared keeps syncing what is typed after the share', async ({ browser }) => {
  test.setTimeout(120_000)
  const seeder = await browser.newContext()
  const page = await seeder.newPage()
  // A vault of its own (the relay does not know this room: the root stays
  // local); only the folder is shared.
  await openApp(page, 'share-open-note', { user: 'Ada' })
  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(paneContent(page)).toBeVisible()

  // Share the open note's folder from the palette, with the note still open.
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('share this folder')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('folder-share-dialog')).toBeVisible()
  await page.getByTestId('share-relay').fill(RELAY)
  await expect(page.getByTestId('relay-card')).toHaveAttribute('data-state', 'reachable', { timeout: 10_000 })
  await page.getByTestId('share-secret').fill('e2e-operator-secret')
  await expect(page.getByTestId('share-secret-check')).toContainText('works', { timeout: 10_000 })
  await page.getByTestId('confirm-share-folder').click()
  await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 15_000 })
  const link = decodeShareLink(await page.getByTestId('share-done-link').inputValue())
  await page.getByTestId('close-folder-share').click()
  await expect(page.getByTestId('folder-share-dialog')).toHaveCount(0)

  // Type into the SAME pane, never reopened.
  const content = paneContent(page)
  await content.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' TYPED-AFTER-SHARE')
  await expect(content).toContainText('TYPED-AFTER-SHARE')

  // Someone opens the share link: the folder, with what was typed after it.
  const joiner = await browser.newContext()
  const other = await joiner.newPage()
  await other.goto(appUrl({ room: link.room, token: link.token, role: 'join', user: 'Bo' }))
  await expect(other.getByTestId('file-item:welcome.md')).toBeVisible({ timeout: 20_000 })
  await other.getByTestId('file-item:welcome.md').click()
  await expect(paneContent(other)).toContainText('TYPED-AFTER-SHARE', { timeout: 20_000 })

  // And the other way: the seeder's open pane is live on the room.
  const theirs = paneContent(other)
  await theirs.click()
  await other.keyboard.press('ControlOrMeta+End')
  await other.keyboard.type(' FROM-THE-JOINER')
  await expect(content).toContainText('FROM-THE-JOINER', { timeout: 20_000 })

  await joiner.close()
  await seeder.close()
})
