/**
 * L2 smoke: the four blocking scenarios from shape D9 / docs/architecture/
 * testing.md — propagation, concurrent typing, offline→reconnect, and
 * sync-pill honesty (+ binary badge). Two browser contexts share one relay.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { encodeDeviceLink } from '../src/lib/share-link.js'
import { MANAGER_URL, RELAY, appUrl as url, paneContent, severableRelay } from './fixtures.js'

const ROOM = 'e2eroom'
const TOKEN = 'e2e-token'
const FILE = 'notes/welcome.md'

const appUrl = (role: 'seed' | 'join', user: string): string =>
  url({ room: ROOM, role, token: TOKEN, user })

async function openPeer(
  browser: Browser,
  role: 'seed' | 'join',
  user: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(appUrl(role, user))
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 15_000 })
  // *This note* is dissolved (sharing E6): presence is read in place (E1) and
  // the share state from the Shared view (E2).
  return { context, page }
}

async function openFile(page: Page, path = FILE): Promise<void> {
  await page.getByTestId(`file-item:${path}`).click()
  await expect(page.getByTestId('editor-pane')).toBeVisible()
}

async function typeAtTop(page: Page, text: string): Promise<void> {
  const content = paneContent(page)
  await content.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type(text)
}

test('a bad token fails fast with a real message, not eternal connecting', async ({ browser }) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(url({ room: ROOM, role: 'join', token: 'wrong-token', user: 'Mallory' }))
  // Boot failures land on the vault manager with the message — never a dead end (M2).
  await expect(page.getByTestId('manager-error')).toContainText('rejected', { timeout: 15_000 })
  await context.close()
})

test('link a device into OPFS: the panel, then materialize, co-edit and reopen', async ({ browser }) => {
  test.setTimeout(90_000) // reload + re-join is heavier than the memory paths

  // Alice seeds the room's content to the relay (memory backend).
  const alice = await openPeer(browser, 'seed', 'Alice')

  // Bob links this device (device-link N2, A1) → OPFS-backed vault. A DEVICE
  // link, not a folder link: it carries the whole vault, and it is the route
  // the vault manager offers for one.
  const link = encodeDeviceLink({ relay: RELAY, room: ROOM, token: TOKEN })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(MANAGER_URL)
  await page.getByTestId('manager-name').fill('Bob')
  await page.getByTestId('open-link-device').click()
  await expect(page.getByTestId('link-device-dialog')).toBeVisible()
  await page.getByTestId('link-device-input').fill(link)
  await page.getByTestId('link-device-submit').click()

  // The joiner is told what is happening while the vault arrives — including
  // the plain statement that images and PDFs will not (decision 6). No editor
  // surface until the boot resolves.
  await expect(page.getByTestId('join-progress')).toBeVisible()
  await expect(page.getByTestId('join-attachments')).toContainText('Images and PDFs')
  await expect(page.getByTestId('editor-pane')).toHaveCount(0)

  // Relay content materialized into the OPFS vault.
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 20_000 })
  // The vault is LINKED, not "shared": the Shared view says so in the vault's
  // own words (*This note* is dissolved — sharing E6).
  await page.keyboard.press('ControlOrMeta+Shift+S')
  await expect(page.getByTestId('shared-devices-linked')).toBeVisible()

  // Live propagation Alice → Bob over the joined OPFS vault.
  await openFile(alice.page)
  await openFile(page)
  await typeAtTop(alice.page, 'OPFS-JOIN ')
  await expect(paneContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })

  // The OPEN note's pill lives in the status bar (chrome U3: tree rows go
  // quiet once green — the folder's rollup vouches for them).
  // Wait for Bob's flush to settle (green = disk written, and Invariant D
  // means the durable doc blob was flushed BEFORE that LCA advance) so the
  // relay-less reload below must serve the edit from OPFS stores alone.
  await expect(page.getByTestId('sync-pill-note')).toHaveAttribute('data-status', 'green', {
    timeout: 15_000,
  })

  // Reopen with the RELAY UNREACHABLE (slice M1): the link was never in the
  // URL, so a reload rehydrates the persisted session — and with
  // durable stores the vault boots from OPFS alone. Only websockets are
  // severed (setOffline would block the dev server too); the pre-M1
  // wipe+re-pull path would show an empty vault here. A flag flips the route
  // between severed and pass-through: ws routes persist across unrouteAll
  // and only take effect after a navigation (verified empirically, PW 1.60).
  const relay = await severableRelay(page, { severed: true })
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 20_000 })
  await openFile(page)
  await expect(paneContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })

  // Reopen ONLINE: a second reload with the relay reachable again — the
  // durable boot catches up and returns honestly to green, with the file
  // singular (the pre-M1 re-pull is gone; nothing doubles, nothing is lost).
  relay.restore()
  await page.reload()
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 20_000 })
  await openFile(page)
  await expect(paneContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })
  await expect(page.getByTestId('sync-pill-note')).toHaveAttribute('data-status', 'green', {
    timeout: 30_000,
  })

  await alice.context.close()
  await ctx.close()
})

test('seed + join: edits propagate both ways and pills are honest', async ({ browser }) => {
  const alice = await openPeer(browser, 'seed', 'Alice')
  const bob = await openPeer(browser, 'join', 'Bob')

  // Binary handling: the seeded fake png is badged, never claimed as synced.
  await expect(alice.page.getByTestId('binary-badge:notes/img.png')).toBeVisible()

  await openFile(alice.page)
  await openFile(bob.page)

  // 1) Propagation A→B.
  await typeAtTop(alice.page, 'HELLO-FROM-ALICE ')
  await expect(paneContent(bob.page)).toContainText('HELLO-FROM-ALICE', {
    timeout: 10_000,
  })

  // Presence, in place (sharing E1): each sees the other on the note's row.
  await expect(alice.page.getByTestId(`tree-presence:${FILE}`).locator('[data-peer="Bob"]')).toBeVisible()
  await expect(bob.page.getByTestId(`tree-presence:${FILE}`).locator('[data-peer="Alice"]')).toBeVisible()

  // 2) Concurrent typing: both markers survive on both peers.
  await Promise.all([
    typeAtTop(alice.page, 'CONC-A '),
    typeAtTop(bob.page, 'CONC-B '),
  ])
  for (const page of [alice.page, bob.page]) {
    await expect(paneContent(page)).toContainText('CONC-A', { timeout: 10_000 })
    await expect(paneContent(page)).toContainText('CONC-B', { timeout: 10_000 })
  }

  // Idle → pills go green on both sides (green = synced with relay).
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId('sync-pill-note')).toHaveAttribute(
      'data-status',
      'green',
      { timeout: 15_000 }
    )
  }

  // 3) Offline → honest pill → reconnect → convergence.
  await bob.context.setOffline(true)
  await typeAtTop(bob.page, 'OFFLINE-EDIT ')
  // Green must drop immediately — pending local ops can't be claimed synced.
  await expect(bob.page.getByTestId('sync-pill-note')).not.toHaveAttribute(
    'data-status',
    'green',
    { timeout: 10_000 }
  )
  await bob.context.setOffline(false)
  await expect(paneContent(alice.page)).toContainText('OFFLINE-EDIT', {
    timeout: 30_000,
  })
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId('sync-pill-note')).toHaveAttribute(
      'data-status',
      'green',
      { timeout: 30_000 }
    )
  }

  // 4) Final convergence check: identical document text. Raw DOM text
  // includes the remote-cursor label widgets (positioned differently per
  // viewer), so strip selection widgets and zero-width joiners first.
  const documentText = (page: Page) =>
    page.evaluate(() => {
      const content = document.querySelector('[data-testid="editor-pane"] .cm-content')!
      const clone = content.cloneNode(true) as HTMLElement
      clone
        .querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo, .cm-widgetBuffer')
        .forEach((el) => el.remove())
      return (clone.textContent ?? '').replace(/[​-⁠﻿]/g, '')
    })
  expect(await documentText(alice.page)).toBe(await documentText(bob.page))

  await alice.context.close()
  await bob.context.close()
})

/**
 * Read R2.3: a checkbox click is a text edit like typing — same Y.Text, same
 * relay, same disk. The widget lives only in view state, so the only proof
 * that it edited the DOCUMENT is the peer seeing the character change.
 */
test('a checkbox click travels to the peer as text', async ({ browser }) => {
  const alice = await openPeer(browser, 'seed', 'Alice')
  const bob = await openPeer(browser, 'join', 'Bob')
  await openFile(alice.page)
  await openFile(bob.page)

  await typeAtTop(alice.page, '- [ ] a task\n')
  await expect(paneContent(bob.page)).toContainText('a task', { timeout: 10_000 })

  // Bob reads in Reading view, where the mode gates COMMANDS, not edits —
  // the checkbox is still a control there (R2.3).
  await bob.page.keyboard.press('ControlOrMeta+e')
  const box = bob.page.locator('[data-testid="editor-pane"] input.cm-task').first()
  await expect(box).not.toBeChecked()
  await box.click()

  // Alice sees the one character that changed, in Source where it is text.
  await alice.page.getByTestId('mode-menu').click()
  await alice.page.getByTestId('mode-menu:source').click()
  await expect(paneContent(alice.page)).toContainText('- [x] a task', { timeout: 10_000 })

  await alice.context.close()
  await bob.context.close()
})

/**
 * Sharing E1, presence in place: who is IN a note shows on that note's tree
 * row, on its tab and beside the pane lead — and leaves when they do. Alone,
 * not one presence node exists (R6). The memory vault's root room stands in
 * for the shared folder; `notes/ideas.md` for *Paxos*.
 */
test('presence in place: a peer in a note shows on its row and tab, and leaves with them', async ({
  browser,
}) => {
  const OTHER = 'notes/ideas.md'
  const PRESENCE_NODES =
    '[data-testid^="tree-presence:"], [data-testid^="mount-presence:"], [data-testid^="tab-presence:"], [data-testid$="-with"]'

  const alice = await openPeer(browser, 'seed', 'Alice')
  await openFile(alice.page)
  await openFile(alice.page, OTHER)

  // Alone: nothing drawn, anywhere — the sync icon is just the icon.
  await expect(alice.page.locator(PRESENCE_NODES)).toHaveCount(0)
  await expect(alice.page.locator('[data-testid^="sync-people"]')).toHaveCount(0)

  const bob = await openPeer(browser, 'join', 'Bob')
  // Bob is online but in no note yet: still nothing in place — only the
  // sync icon counts him (compact in the dense status bar, P5), and its
  // hover card says he is online, in no note.
  await expect(alice.page.getByTestId('sync-people-count')).toHaveText('1', { timeout: 10_000 })
  await expect(alice.page.locator(PRESENCE_NODES)).toHaveCount(0)
  await alice.page.getByTestId('sync-pill-note').hover()
  await expect(alice.page.getByTestId('sync-people-card').locator('[data-peer="Bob"]')).toContainText('online')
  await alice.page.mouse.move(0, 0)

  // Bob opens the note: his initial on its row, on Alice's tab for it, and
  // "with Bob" beside the lead of the pane that holds it.
  await openFile(bob.page, OTHER)
  const row = alice.page.getByTestId(`tree-presence:${OTHER}`)
  await expect(row.locator('[data-peer="Bob"]')).toBeVisible({ timeout: 10_000 })
  await expect(row.locator('[data-peer="Bob"]')).toHaveAttribute('aria-label', 'Bob')
  await expect(row).toContainText('B')
  // One chip (P7): his initial, no count beside it for one person, centred on the row.
  await expect(alice.page.getByTestId(`tree-presence:${OTHER}-count`)).toHaveCount(0)
  const rowBox = (await alice.page.getByTestId(`file-item:${OTHER}`).boundingBox())!
  const chipBox = (await row.boundingBox())!
  expect(Math.abs(chipBox.y + chipBox.height / 2 - (rowBox.y + rowBox.height / 2))).toBeLessThanOrEqual(1)
  await expect(alice.page.getByTestId(`tab-presence:${OTHER}`).locator('[data-peer="Bob"]')).toBeVisible()
  await expect(alice.page.getByTestId('status-bar-with')).toContainText('with Bob')
  await expect(alice.page.getByTestId(`tree-presence:${FILE}`)).toHaveCount(0)

  // He moves to another note: he leaves this one and appears there.
  await openFile(bob.page, FILE)
  await expect(alice.page.getByTestId(`tree-presence:${OTHER}`)).toHaveCount(0, { timeout: 10_000 })
  await expect(alice.page.getByTestId(`tree-presence:${FILE}`).locator('[data-peer="Bob"]')).toBeVisible()

  // He closes his tabs: gone from every row and tab.
  for (const path of [FILE, OTHER]) {
    await bob.page.locator(`[data-path="${path}"] [data-tab-close]`).click({ force: true })
  }
  await expect(alice.page.locator(PRESENCE_NODES)).toHaveCount(0, { timeout: 10_000 })

  await alice.context.close()
  await bob.context.close()
})

/**
 * foundations-plan P6: the drawer names the peer. A peer's Backspace arrives
 * as a delete-only update — no inserted client ids to look up in awareness —
 * and was logged "someone via <relay>", folded into a line of its own that
 * sat on top of theirs. It is theirs: the one person with the note open.
 */
test('the drawer names the peer for every edit, Backspace included, grouped per note', async ({ browser }) => {
  const alice = await openPeer(browser, 'seed', 'Alice')
  const bob = await openPeer(browser, 'join', 'Bob')
  await openFile(alice.page)
  await openFile(bob.page)

  await typeAtTop(alice.page, 'NAMED ')
  await alice.page.keyboard.press('Backspace')
  await alice.page.keyboard.press('Backspace')
  await expect(paneContent(bob.page)).toContainText('NAME', { timeout: 10_000 })
  await expect(paneContent(bob.page)).not.toContainText('NAMED', { timeout: 10_000 })

  await bob.page.getByTestId('drawer-bell').click()
  const drawer = bob.page.getByTestId('drawer')
  const group = drawer.getByTestId(`drawer-change:${FILE}`)
  await expect(group).toBeVisible()
  // One row for the note, by name — never "someone".
  await expect(group.getByTestId('drawer-change-who')).toHaveText('Alice')
  await expect(drawer).not.toContainText('someone')
  await expect(drawer.getByTestId('drawer-summary')).toContainText('by others')
  // No *Open Shared*; *See all N in the Log* opens the Log on the changes.
  await expect(drawer.getByTestId('drawer-open-shared')).toHaveCount(0)
  await drawer.getByTestId('drawer-open-log').click()
  await expect(bob.page.getByTestId('drawer')).toHaveCount(0)

  await alice.context.close()
  await bob.context.close()
})
