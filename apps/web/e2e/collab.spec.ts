/**
 * L2 smoke: the four blocking scenarios from shape D9 / docs/architecture/
 * testing.md — propagation, concurrent typing, offline→reconnect, and
 * sync-pill honesty (+ binary badge). Two browser contexts share one relay.
 */
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { encodeShareLink } from '../src/lib/share-link.js'

const RELAY = 'ws://localhost:8799'
const ROOM = 'e2eroom'
const TOKEN = 'e2e-token'
const FILE = 'notes/welcome.md'

function appUrl(role: 'seed' | 'join', user: string): string {
  const params = new URLSearchParams({
    mode: 'memory',
    role,
    relay: RELAY,
    room: ROOM,
    token: TOKEN,
    user,
  })
  return `/?${params.toString()}`
}

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
  const params = new URLSearchParams({
    mode: 'memory',
    role: 'join',
    relay: RELAY,
    room: ROOM,
    token: 'wrong-token',
    user: 'Mallory',
  })
  await page.goto(`/?${params.toString()}`)
  await expect(page.getByTestId('boot-error')).toContainText('rejected', { timeout: 15_000 })
  await context.close()
})

test('join via share link into OPFS: materializes, co-edits, and reopens', async ({ browser }) => {
  test.setTimeout(90_000) // reload + re-join is heavier than the memory paths

  // Alice seeds the room's content to the relay (memory backend).
  const alice = await openPeer(browser, 'seed', 'Alice')

  // Bob joins through a share link → OPFS-backed vault (the O3 path). The link
  // is a deep-link into the landing screen; he names himself and joins.
  const link = encodeShareLink({ relay: RELAY, room: ROOM, token: TOKEN })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(`/?share=${encodeURIComponent(link)}`)
  await page.getByTestId('landing-name').fill('Bob')
  await page.getByTestId('join-share').click()

  // Relay content materialized into the OPFS vault.
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId(`file-item:${FILE}`)).toBeVisible({ timeout: 20_000 })

  // Live propagation Alice → Bob over the joined OPFS vault.
  await openFile(alice.page)
  await openFile(page)
  await typeAtTop(alice.page, 'OPFS-JOIN ')
  await expect(editorContent(page)).toContainText('OPFS-JOIN', { timeout: 10_000 })

  // Wait for Bob's flush to settle (green = disk written, and Invariant D
  // means the durable doc blob was flushed BEFORE that LCA advance) so the
  // relay-less reload below must serve the edit from OPFS stores alone.
  await expect(page.getByTestId(`sync-pill:${FILE}`)).toHaveAttribute('data-status', 'green', {
    timeout: 15_000,
  })

  // Reopen with the RELAY UNREACHABLE (slice M1): the ?share= param was
  // cleared on join, so a reload rehydrates the persisted session — and with
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
  await expect(page.getByTestId(`sync-pill:${FILE}`)).toHaveAttribute('data-status', 'green', {
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
    await expect(page.getByTestId(`sync-pill:${FILE}`)).toHaveAttribute(
      'data-status',
      'green',
      { timeout: 15_000 }
    )
  }

  // 3) Offline → honest pill → reconnect → convergence.
  await bob.context.setOffline(true)
  await typeAtTop(bob.page, 'OFFLINE-EDIT ')
  // Green must drop immediately — pending local ops can't be claimed synced.
  await expect(bob.page.getByTestId(`sync-pill:${FILE}`)).not.toHaveAttribute(
    'data-status',
    'green',
    { timeout: 10_000 }
  )
  await bob.context.setOffline(false)
  await expect(editorContent(alice.page)).toContainText('OFFLINE-EDIT', {
    timeout: 30_000,
  })
  for (const page of [alice.page, bob.page]) {
    await expect(page.getByTestId(`sync-pill:${FILE}`)).toHaveAttribute(
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
