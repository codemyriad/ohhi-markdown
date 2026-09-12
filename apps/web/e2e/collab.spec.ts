/**
 * L2 smoke: the four blocking scenarios from shape D9 / docs/architecture/
 * testing.md — propagation, concurrent typing, offline→reconnect, and
 * sync-pill honesty (+ binary badge). Two browser contexts share one relay.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { encodeDeviceLink } from '../src/lib/share-link.js'
import { RELAY, appUrl as url } from './fixtures.js'

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
  return { context, page }
}

async function openFile(page: Page, path = FILE): Promise<void> {
  await page.getByTestId(`file-item:${path}`).click()
  await expect(page.getByTestId('editor-pane')).toBeVisible()
}

function editorContent(page: Page) {
  return page.locator('[data-testid="editor-pane"] .cm-content')
}

async function typeAtTop(page: Page, text: string): Promise<void> {
  const content = editorContent(page)
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
  await page.goto('/')
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
  // The vault is LINKED, not "shared": the rail says so in the vault's own words.
  await expect(page.getByTestId('rail-section:note').getByTestId('share-state')).toContainText(
    'Synced to your devices'
  )

  // Live propagation Alice → Bob over the joined OPFS vault.
  await openFile(alice.page)
  await openFile(page)
  await typeAtTop(alice.page, 'OPFS-JOIN ')
  await expect(editorContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })

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
  let relaySevered = true
  await page.routeWebSocket(/.*/, (ws) => {
    if (relaySevered) ws.close()
    else ws.connectToServer()
  })
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 20_000 })
  await openFile(page)
  await expect(editorContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })

  // Reopen ONLINE: a second reload with the relay reachable again — the
  // durable boot catches up and returns honestly to green, with the file
  // singular (the pre-M1 re-pull is gone; nothing doubles, nothing is lost).
  relaySevered = false
  await page.reload()
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 20_000 })
  await openFile(page)
  await expect(editorContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })
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
  await expect(editorContent(bob.page)).toContainText('HELLO-FROM-ALICE', {
    timeout: 10_000,
  })

  // Presence: both names visible on both sides.
  await expect(alice.page.getByTestId('presence')).toContainText('Bob')
  await expect(bob.page.getByTestId('presence')).toContainText('Alice')

  // 2) Concurrent typing: both markers survive on both peers.
  await Promise.all([
    typeAtTop(alice.page, 'CONC-A '),
    typeAtTop(bob.page, 'CONC-B '),
  ])
  for (const page of [alice.page, bob.page]) {
    await expect(editorContent(page)).toContainText('CONC-A', { timeout: 10_000 })
    await expect(editorContent(page)).toContainText('CONC-B', { timeout: 10_000 })
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
  await expect(editorContent(alice.page)).toContainText('OFFLINE-EDIT', {
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
  await expect(editorContent(bob.page)).toContainText('a task', { timeout: 10_000 })

  // Bob reads in Reading view, where the mode gates COMMANDS, not edits —
  // the checkbox is still a control there (R2.3).
  await bob.page.keyboard.press('ControlOrMeta+e')
  const box = bob.page.locator('[data-testid="editor-pane"] input.cm-task').first()
  await expect(box).not.toBeChecked()
  await box.click()

  // Alice sees the one character that changed, in Source where it is text.
  await alice.page.getByTestId('mode-menu').click()
  await alice.page.getByTestId('mode-menu:source').click()
  await expect(editorContent(alice.page)).toContainText('- [x] a task', { timeout: 10_000 })

  await alice.context.close()
  await bob.context.close()
})
