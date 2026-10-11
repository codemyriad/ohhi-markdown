/**
 * The join page (first-run C2/C3, Fork 1-A): a link in its URL form,
 * `/join#editor1:…`, opened in a browser. One context seeds a room on the e2e
 * relay; a fresh context opens the link, reads who sent it ("the name they
 * typed") and that the relay answered its health check, chooses *Add here*,
 * and lands in the manager's Add dialog with the link prefilled — then joins
 * it as its own (browser) vault and the workspace opens with the room's
 * notes, named after the folder. A link to a relay nobody runs says it can't
 * be reached, and why.
 */
import { expect, test } from '@playwright/test'
import { encodeShareLink } from '../src/lib/share-link.js'
import { RELAY, appUrl } from './fixtures.js'

const ROOM = 'join-page'
const TOKEN = 'join-token'

test('a /join link: who sent it, the relay answers, Add here → the Add dialog → the workspace', async ({ browser }) => {
  test.setTimeout(90_000)

  // The sharer's side: the room exists on the relay, with notes in it.
  const seeder = await browser.newContext()
  const seed = await seeder.newPage()
  await seed.goto(appUrl({ room: ROOM, token: TOKEN, user: 'Sam', role: 'seed' }))
  await expect(seed.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })

  // The receiver: a fresh browser, the link clicked from a chat.
  const context = await browser.newContext()
  const page = await context.newPage()
  const payload = encodeShareLink({ relay: RELAY, room: ROOM, token: TOKEN, label: 'team/notes', from: 'Sam' })
  // `?layout=dense` only so the workspace's tree is a column the spec can see.
  await page.goto(`/join?layout=dense#${payload}`)

  const join = page.getByTestId('join-page')
  await expect(join).toBeVisible()
  // The token leaves the address bar (and Back's history) as the page shows,
  // not only on *Add here*: *Copy* and closing the tab is the desktop path (R2).
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).hash).toBe('/join')
  await expect(join.getByRole('heading', { level: 1 })).toHaveText('Sam shared team/notes with you')
  await expect(join).toContainText('“Sam” is the name they typed, not a verified account.')
  await expect(join.getByTestId('join-syncs-through')).toContainText('localhost:8799, a relay run by whoever shared this.')
  await expect(join.getByTestId('join-relay')).toHaveText('The relay answered.', { timeout: 10_000 })

  // In this browser: the manager's Add dialog, the link in it, the address cleared.
  await join.getByRole('button', { name: 'Add here' }).click()
  await expect(page.getByTestId('join-page')).toHaveCount(0)
  const dialog = page.getByTestId('add-share-dialog')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('add-share-link')).toHaveValue(new RegExp(`/join\\?layout=dense#${payload}$`))
  expect(new URL(page.url()).hash).toBe('')
  await expect(dialog.getByTestId('add-share-about')).toHaveText(
    'team/notes, shared by “Sam” (the name they typed) · syncs through localhost:8799'
  )
  await expect(dialog.getByTestId('add-share-probe')).toHaveText('relay reachable', { timeout: 10_000 })
  await expect(page.getByTestId('add-share-where-own')).toBeChecked()
  await page.getByTestId('add-share-name').fill('Robin')
  await page.getByTestId('add-share-join').click()

  // The folder arrives as its own browser vault, named after the folder: the
  // link's label `team/notes` → `notes` (never a literal "Shared vault").
  await expect(page.getByTestId('file-item:notes/welcome.md')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('vault-switcher')).toHaveText('notes')
  const names = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('editor:config') ?? '{}') as { vaults?: { room: string; name: string }[] }).vaults ?? []
  )
  expect(names.find((v) => v.room === 'join-page')?.name).toBe('notes')
  // "Your name" (Fork 5-A): the dialog's answer is the one remembered.
  expect(await page.evaluate(() => localStorage.getItem('editor:user'))).toBe('Robin')

  await seeder.close()
  await context.close()
})

test('a /join link to a relay nobody runs says it cannot be reached from here', async ({ page }) => {
  const payload = encodeShareLink({ relay: 'ws://localhost:1', room: 'nowhere', token: 'nope' })
  await page.goto(`/join#${payload}`)
  const join = page.getByTestId('join-page')
  await expect(join.getByRole('heading', { level: 1 })).toHaveText('Someone shared a folder with you')
  await expect(join.getByTestId('join-relay')).toContainText('Can’t reach the relay from here.', { timeout: 10_000 })
  await expect(join.getByTestId('join-relay')).toContainText('Ask whoever shared this how to reach their relay.')
  await expect(join.getByTestId('join-relay')).toContainText('Reload this page once you can reach it.')
  await expect(join.getByTestId('join-relay')).not.toContainText('The relay answered.')
})

test('a reload of /join, once the token has left the address bar, shows the same link', async ({ page }) => {
  const payload = encodeShareLink({ relay: 'ws://localhost:1', room: 'nowhere', token: 'nope', from: 'Sam' })
  await page.goto(`/join#${payload}`)
  await expect(page.getByTestId('join-page').getByRole('heading', { level: 1 })).toHaveText('Sam shared a folder with you')
  await expect.poll(() => new URL(page.url()).hash).toBe('')
  await page.reload()
  await expect(page.getByTestId('join-page').getByRole('heading', { level: 1 })).toHaveText('Sam shared a folder with you')
})

test('a damaged /join link shows why, and how to paste it in the app instead', async ({ page }) => {
  await page.goto('/join#editor1:damaged')
  const error = page.getByTestId('join-error')
  await expect(error).toBeVisible()
  await expect(error.getByRole('alert')).toHaveText('That link is damaged — copy it again from the device that made it.')
  await expect(error).toContainText('paste it in the app')
})
