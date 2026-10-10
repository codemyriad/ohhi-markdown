/**
 * Sharing E2/E3: the Shared view over a real relay, two contexts. B's vault
 * is a room A adds as a shared folder; A watches it from the Shared view —
 * the relay card, the room card with B in its stack, B's edit in Changes —
 * and when the relay goes away the card reads "Reconnecting…" while every
 * pill agrees (golden rule 4: all of it is f(records)). A vault that shares
 * nothing shows the onboarding instead, the relay card above its doors reading
 * the relay (first-run D1/D3), Settings › Sync checking the team's secret, and
 * one real first share from it (the e2e relay runs with an operator secret); a folder
 * share opened as its own vault is titled "Adding …" (F1). Axe over each
 * surface.
 */
import { expect, test, type Browser, type Page } from '@playwright/test'
import { encodeShareLink } from '../src/lib/share-link.js'
import { MANAGER_URL, RELAY, appUrl, createBrowserVault, expectAccessible, severableRelay } from './fixtures.js'

/**
 * Boot a memory vault whose websockets pass through a switch, so the RELAY
 * can be killed for this page alone while the app server stays up (the
 * testing skill: ws routes must be registered before the navigation).
 */
async function boot(browser: Browser, room: string, token: string, user: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const relay = await severableRelay(page)
  await page.goto(appUrl({ room, token, user, role: 'seed' }))
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  return { context, page, relay }
}

/**
 * The one sync icon (foundations-plan P5): its button carries `data-status`
 * whatever testid it wears (the note's pill, or the vault rollup).
 */
const syncIcon = (page: Page) => page.locator('[data-testid="sync-readout"] [data-status]').first()

async function openShared(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+S')
  await expect(page.getByTestId('shared-view')).toBeVisible()
}

test('the Shared view: relay, a shared folder with its people, changes by name, and an honest outage', async ({
  browser,
}) => {
  test.setTimeout(90_000)
  const bob = await boot(browser, 'shared-cs', 'shared-cs-token', 'Bob')
  const alice = await boot(browser, 'shared-a', 'shared-a-token', 'Alice')

  // Alice adds Bob's room as a shared folder, from the Shared view's own door.
  await openShared(alice.page)
  await alice.page.getByTestId('shared-view').getByTestId('shared-add').first().click()
  await alice.page
    .getByTestId('add-share-link')
    .fill(encodeShareLink({ relay: RELAY, room: 'shared-cs', token: 'shared-cs-token' }))
  await alice.page.getByTestId('add-share-dest').fill('CS')
  await alice.page.getByTestId('add-share-join').click()
  await expect(alice.page.getByTestId('file-item:CS/notes/welcome.md')).toBeVisible({ timeout: 20_000 })

  // The relay card first, connected; the room card with Bob in its stack.
  const relay = alice.page.getByTestId('relay-card')
  await expect(relay).toHaveAttribute('data-state', 'connected', { timeout: 15_000 })
  await expect(relay).toContainText('Connected')
  const room = alice.page.getByTestId('shared-room:CS')
  await expect(room).toContainText('Shared with you')
  await expect(alice.page.getByTestId('shared-room-stack:CS')).toHaveAttribute('title', /Bob/, { timeout: 15_000 })
  await expect(alice.page.getByTestId('shared-person:Bob')).toBeVisible()
  await expectAccessible(alice.page, 'shared view (connected)')

  // Bob edits a note; Alice's Changes card lists it, by name.
  await bob.page.getByTestId('file-item:notes/welcome.md').click()
  const content = bob.page.locator('[data-testid="editor-pane"] .cm-content')
  await content.click()
  await bob.page.keyboard.press('ControlOrMeta+Home')
  await bob.page.keyboard.type('FROM-BOB ')
  const line = alice.page.getByTestId('change-line').filter({ hasText: 'welcome' }).first()
  await expect(line).toBeVisible({ timeout: 15_000 })
  await expect(line).toContainText('Bob')

  // The relay goes away: the card says so in words, and every pill agrees.
  await expect(syncIcon(alice.page)).toHaveAttribute('data-status', 'green', { timeout: 20_000 })
  // Bob is online in a room Alice is in: his initial beside the icon (compact
  // in the dense status bar: a count), and in its name, in words.
  await expect(alice.page.getByTestId('sync-people-count')).toHaveText('1')
  await expect(syncIcon(alice.page)).toHaveAttribute('aria-label', /1 person online/)
  // Hover: who is where, per room — Bob, in the note he is editing.
  await syncIcon(alice.page).hover()
  const card = alice.page.getByTestId('sync-people-card')
  await expect(card.locator('[data-testid="people-row"][data-peer="Bob"]')).toContainText('in welcome')
  await alice.page.mouse.move(0, 0)
  await expect(card).toHaveCount(0)
  // Green is relay RECEIPT (golden rule 4): the card says "in sync", never "durable".
  await expect(relay).toContainText('in sync with the relay since', { timeout: 15_000 })
  await expect(relay).not.toContainText(/durable/i)
  await alice.relay.kill()
  await expect(relay).toHaveAttribute('data-state', 'reconnecting', { timeout: 15_000 })
  await expect(relay).toContainText('Reconnecting…')
  await expect(relay).toContainText('last in sync with the relay')
  await expect(relay).toContainText('your edits are safe on this device')
  await expect(syncIcon(alice.page)).not.toHaveAttribute('data-status', 'green')
  await expect(alice.page.getByTestId('shared-room-pill:CS')).not.toHaveAttribute('data-status', 'green')
  await expectAccessible(alice.page, 'shared view (reconnecting)')

  alice.relay.restore()
  await expect(relay).toHaveAttribute('data-state', 'connected', { timeout: 30_000 })
  await alice.context.close()
  await bob.context.close()
})

test('a vault that shares nothing opens Shared on its onboarding', async ({ page }) => {
  await page.goto(MANAGER_URL)
  await createBrowserVault(page, 'Lonely')
  // The sync icon is the door — here with no state to colour (nothing shared).
  await expect(page.getByTestId('toolbar-vault-summary')).not.toHaveAttribute('data-status')
  await page.getByTestId('toolbar-vault-summary').click()
  const empty = page.getByTestId('shared-empty')
  await expect(empty).toContainText('Nothing is shared yet')
  // The relay first, as a card (first-run D1/D3): it reads the RELAY, not the
  // secret. This build has no VITE_DEFAULT_RELAY and nothing is saved: none.
  const block = page.getByTestId('shared-empty-relay')
  const card = block.getByTestId('relay-card')
  await expect(card).toHaveAttribute('data-state', 'none')
  await expect(card).toContainText('No relay yet')
  await expect(card).toContainText('Shares need one relay per group')
  await expect(block.getByRole('link', { name: 'How to run a relay' })).toHaveAttribute('href', '/guide/relay.html')
  await expectAccessible(page, 'shared view (empty)')

  // A relay saved in Settings, still no secret: the card probes it, and the one thing still needed.
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:sync').click()
  await page.getByTestId('settings-relay').fill(RELAY)
  await page.getByTestId('settings-save-sync').click()
  await expect(page.getByTestId('settings-save-sync')).toBeDisabled()
  // Settings › Sync draws the same card: reachable is a health check, nothing more.
  await expect(page.getByTestId('settings-relay-card').getByTestId('relay-card')).toHaveAttribute('data-state', 'reachable', {
    timeout: 10_000,
  })
  await expect(page.getByTestId('settings-own-relay')).toContainText('One relay per group')
  // A wrong team's secret: the check says so, never "works".
  await page.getByTestId('settings-secret').fill('anything')
  await expect(page.getByTestId('settings-secret-check')).toContainText('doesn’t match this relay', { timeout: 10_000 })
  await expectAccessible(page, 'settings sync (secret checked)')
  await page.getByTestId('settings-close').click()
  await page.getByTestId('settings-discard').click()
  await expect(card).toHaveAttribute('data-state', 'reachable', { timeout: 10_000 })
  await expect(card).toContainText('localhost:8799')
  await expect(block).toContainText('you will need the team’s secret once')
  await expect(block).not.toContainText('No relay yet')
  await expectAccessible(page, 'shared view (empty, relay reachable)')

  // A folder to share (a new vault has none), made from the tree's own menu.
  await page.getByTestId('file-tree').click({ button: 'right' })
  await page.getByTestId('tree-menu:new-folder').click()
  await page.getByTestId('tree-op-name').fill('team')
  await page.getByTestId('tree-op-confirm').click()
  await expect(page.getByTestId('tree-op-dialog')).toHaveCount(0)

  // Share a folder… asks which folder first.
  await empty.getByTestId('shared-share').click()
  await expect(page.getByTestId('share-folder-picker')).toBeVisible()
  await expectAccessible(page, 'share folder picker')

  // One real first share, end to end: the folder, the sheet, the team's
  // secret, Share, the done block — then the Shared view lists it, by you.
  const folder = 'team'
  await page.getByTestId('share-folder-select').selectOption(folder)
  await page.getByTestId('share-folder-next').click()
  await expect(page.getByTestId('folder-share-dialog')).toBeVisible()
  await expect(page.getByTestId('relay-card').last()).toHaveAttribute('data-state', 'reachable', { timeout: 10_000 })
  await page.getByTestId('share-secret').fill('e2e-operator-secret')
  await expect(page.getByTestId('share-secret-check')).toContainText('works', { timeout: 10_000 })
  await page.getByTestId('share-your-name').fill('Lone')
  await page.getByTestId('confirm-share-folder').click()
  await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('share-done-link')).toHaveValue(/editor1:/)
  await page.getByTestId('close-folder-share').click()
  await expect(page.getByTestId('folder-share-dialog')).toHaveCount(0)
  const room = page.getByTestId(`shared-room:${folder}`)
  await expect(room).toBeVisible({ timeout: 15_000 })
  await expect(room).toContainText('Shared by you')
  await expect(page.locator('[data-testid^="shared-room:"]')).toHaveCount(1)
})

test('a folder share opened as its own vault is "Adding …", not "Linking this device" (first-run F1)', async ({ page }) => {
  await page.goto(MANAGER_URL)
  await page.getByTestId('join-share').click()
  await page.getByTestId('add-share-link').fill(encodeShareLink({ relay: RELAY, room: 'f1-folder', token: 'f1-token' }))
  // As its own vault (the manager's only choice): the browser says where it will live.
  await expect(page.getByTestId('add-share-where-own')).toBeChecked()
  await expect(page.getByTestId('add-share-own-platform')).toContainText('Kept in this browser')
  await page.getByTestId('add-share-join').click()

  // The panel names the folder (no label on this link: the relay's host), on a Folder row.
  const panel = page.getByTestId('join-progress')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading')).toHaveText('Adding Shared folder on localhost:8799')
  await expect(panel).toContainText('Folder')
  await expect(panel).not.toContainText('Linking this device')
  await expect(panel.getByTestId('join-attachments')).toBeVisible()
})
