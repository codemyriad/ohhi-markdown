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
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { encodeShareLink } from '../src/lib/share-link.js'
import { MANAGER_URL, RELAY, appUrl, createBrowserVault } from './fixtures.js'

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
  // Said as a SHARED vault (join-share-brief P2): nothing in it is private.
  await expect(dialog.getByText('As a shared vault of its own')).toBeVisible()
  await expect(dialog.getByText('Everything you put in it is shared with whoever holds a link.')).toBeVisible()
  await page.getByTestId('add-share-name').fill('Robin')
  await page.getByTestId('add-share-join').click()

  // The folder arrives as its own browser vault, named after the folder: the
  // link's label `team/notes` → `notes` (never a literal "Shared vault").
  await expect(page.getByTestId('file-item:notes/welcome.md')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('vault-switcher')).toHaveText('notes')
  // And the vault says what it is, afterwards: the switcher's badge, the Shared view's first row.
  await expect(page.getByTestId('vault-badge')).toHaveText('Shared with you')
  await page.keyboard.press('ControlOrMeta+Shift+s')
  await expect(page.getByTestId('shared-root')).toContainText('This whole vault')
  await expect(page.getByTestId('shared-devices-linked')).toHaveCount(0)
  const names = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('editor:config') ?? '{}') as { vaults?: { room: string; name: string }[] }).vaults ?? []
  )
  expect(names.find((v) => v.room === 'join-page')?.name).toBe('notes')
  // "Your name" (Fork 5-A): the dialog's answer is the one remembered.
  expect(await page.evaluate(() => localStorage.getItem('editor:user'))).toBe('Robin')

  await seeder.close()
  await context.close()
})

/** A room on the e2e relay with notes in it, seeded by a sharer's context. */
async function seedRoom(context: BrowserContext, room: string, token: string): Promise<Page> {
  const seed = await context.newPage()
  await seed.goto(appUrl({ room, token, user: 'Sam', role: 'seed' }))
  await expect(seed.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  return seed
}

test('a link opened in a browser that already has a vault lands the folder INSIDE it — in the tab that holds the vault', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const seeder = await browser.newContext()
  await seedRoom(seeder, 'join-inside', 'join-inside-token')

  // Tab 1: the person's own browser vault, open.
  const context = await browser.newContext()
  const mine = await context.newPage()
  await mine.goto(MANAGER_URL)
  await createBrowserVault(mine, 'Mine')

  // Tab 2: the link, clicked from a chat. The browser has a vault, so the page
  // offers it, preselected, with the folder taken from the link's label.
  const page = await context.newPage()
  const payload = encodeShareLink({ relay: RELAY, room: 'join-inside', token: 'join-inside-token', label: 'team/HackMD notes', from: 'Sam' })
  await page.goto(`/join?layout=dense#${payload}`)
  const join = page.getByTestId('join-page')
  await expect(join.getByTestId('join-relay')).toHaveText('The relay answered.', { timeout: 10_000 })
  await expect(page.getByTestId('join-where-vault')).toBeChecked()
  await expect(page.getByTestId('join-where-own')).not.toBeChecked()
  await expect(join.getByText('Inside Mine')).toBeVisible()
  await expect(page.getByTestId('join-vault-picker')).toHaveCount(0) // one vault: nothing to pick
  await expect(page.getByTestId('join-dest')).toHaveValue('HackMD notes')
  // Own-vault is one click away, and says it is a shared vault.
  await expect(join.getByText('As a shared vault of its own')).toBeVisible()
  await page.getByTestId('join-name').fill('Robin')
  await page.getByRole('button', { name: 'Add to Mine' }).click()

  // Tab 1 holds the vault (one tab per browser vault), so it takes the join:
  // the folder lands there, under the name the page proposed (the room's own
  // tree — `notes/welcome.md` — inside it).
  await expect(mine.getByTestId('dir-item:HackMD notes')).toBeVisible({ timeout: 30_000 })
  await expect(mine.getByTestId('file-item:HackMD notes/notes/welcome.md')).toBeVisible({ timeout: 30_000 })
  await expect(mine.getByTestId('mount-badge:HackMD notes')).toHaveText('Shared with you')
  // Tab 2 says so, and is done.
  await expect(page.getByTestId('join-page')).toHaveCount(0)
  await expect(page.getByText('Added inside Mine, in the tab where it is open.')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('file-tree')).toHaveCount(0)

  await seeder.close()
  await context.close()
})

test('a link opened with a vault remembered but open nowhere: the page opens the vault and lands the folder in it', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const seeder = await browser.newContext()
  await seedRoom(seeder, 'join-closed', 'join-closed-token')

  const context = await browser.newContext()
  const first = await context.newPage()
  await first.goto(MANAGER_URL)
  await createBrowserVault(first, 'Mine')
  await first.close() // the vault is remembered, and held by no tab

  const page = await context.newPage()
  const payload = encodeShareLink({ relay: RELAY, room: 'join-closed', token: 'join-closed-token', label: 'team/notes', from: 'Sam' })
  await page.goto(`/join?layout=dense#${payload}`)
  await expect(page.getByTestId('join-relay')).toHaveText('The relay answered.', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Add to Mine' }).click()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('vault-switcher')).toHaveText('Mine')
  await expect(page.getByTestId('file-item:notes/notes/welcome.md')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('mount-badge:notes')).toHaveText('Shared with you')
  await expect(page.getByTestId('vault-badge')).toHaveCount(0) // the vault itself is not a share

  // The same link again, into the same vault: refused by the vault once open,
  // and the Add dialog reopens with the link, the folder and the reason.
  await page.goto(`/join?layout=dense#${payload}`)
  await expect(page.getByTestId('join-relay')).toHaveText('The relay answered.', { timeout: 10_000 })
  await page.getByRole('button', { name: 'Add to Mine' }).click()
  const dialog = page.getByTestId('add-share-dialog')
  await expect(dialog).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('add-share-error')).toContainText('this share is already part of this vault', { timeout: 10_000 })
  await expect(page.getByTestId('add-share-dest')).toHaveValue('notes')
  await expect(page.getByTestId('add-share-where-vault')).toBeChecked()

  await seeder.close()
  await context.close()
})

test('one tab per browser vault: a second tab on an open vault is told so, and opens it once the first tab is gone', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const first = await context.newPage()
  await first.goto(MANAGER_URL)
  await createBrowserVault(first, 'Mine')
  const room = await first.evaluate(() => (JSON.parse(localStorage.getItem('editor:config') ?? '{}') as { lastRoom: string }).lastRoom)

  // A second tab: the plain launch would reopen the last vault — refused, with the reason on its row.
  const second = await context.newPage()
  await second.goto(MANAGER_URL)
  await expect(second.getByTestId(`vault-error:${room}`)).toContainText('Mine is open in another tab of this browser', { timeout: 15_000 })
  await expect(second.getByTestId('file-tree')).toHaveCount(0)

  // The first tab goes away: the lock with it, and the row opens.
  await first.close()
  await second.getByTestId(`open-vault:${room}`).click()
  await expect(second.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
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
