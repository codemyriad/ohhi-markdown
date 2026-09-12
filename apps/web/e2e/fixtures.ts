/**
 * The e2e setup every spec shares: the memory-vault boot URL, the app opener,
 * and the two gestures/locators the pane specs all reach for.
 *
 * Centralised because the testing skill asks for it — seven specs had the same
 * `URLSearchParams` block, and a change to the boot contract (a param, the
 * readiness signal) has to land in one place or the run rots one spec at a time.
 *
 * Not a `*.spec.ts`, so Playwright's `testMatch` leaves it alone.
 */
import { expect, type Locator, type Page } from '@playwright/test'

export const RELAY = 'ws://localhost:8799'

export interface AppParams {
  room: string
  /** `seed` writes the sample vault; `join` expects the room to exist. */
  role?: 'seed' | 'join'
  token?: string
  user?: string
}

/** The memory-vault URL the specs boot from — no real folder, no share. */
export function appUrl({
  room,
  role = 'seed',
  token = 'e2e-token',
  user = 'Chris',
}: AppParams): string {
  const params = new URLSearchParams({ mode: 'memory', role, relay: RELAY, room, token, user })
  return `/?${params.toString()}`
}

/** Boot the app and wait until the vault is actually on screen. */
export async function openApp(
  page: Page,
  room: string,
  opts: Omit<AppParams, 'room'> = {}
): Promise<void> {
  await page.goto(appUrl({ room, ...opts }))
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

/** A pointer drag with enough steps to cross the 6 px threshold and settle. */
export async function dragTo(page: Page, from: Locator, x: number, y: number): Promise<void> {
  const box = (await from.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.move(x, y)
  await page.mouse.up()
}

/**
 * A NATIVE (HTML5) drag from a file-tree row to a point (P1.2).
 *
 * Not `dragTo`: the tree is a `draggable` element, so Chromium starts a real
 * drag session instead of dispatching pointer moves — and it only begins
 * dispatching `dragover` from the *second* move on, which is why the first
 * one is a short nudge off the row.
 */
export async function dragRowTo(page: Page, from: Locator, x: number, y: number): Promise<void> {
  const box = (await from.boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 12, startY + 12)
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.move(x, y)
  await page.mouse.up()
}

/** A note through the affordance a person has: the tree's own New note. */
export async function newNote(page: Page, n: number): Promise<string> {
  await page.getByTestId('file-tree').click({ button: 'right' })
  await page.getByTestId('tree-menu:new-file').click()
  const path = `untitled-${n}.md`
  await expect(page.getByTestId(`file-item:${path}`)).toBeVisible()
  return path
}

/**
 * A BROWSER (OPFS) vault, made the way the manager offers one. The memory
 * contract the specs boot registers no vault at all, so anything that needs a
 * vault the manager can LIST has to make one first. Assumes the manager is
 * already on screen.
 */
export async function createBrowserVault(page: Page, name: string): Promise<void> {
  await page.getByTestId('new-vault-name').fill(name)
  await page.getByTestId('create-vault').click()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

/** Back into the manager the way a person gets there: the vault switcher. */
export async function openManager(page: Page): Promise<void> {
  await page.getByTestId('vault-switcher').click()
  await page.getByTestId('manage-vaults').click()
}

export const panes = (page: Page): Locator => page.locator('[data-pane-id]')
export const editors = (page: Page): Locator => page.locator('[data-pane-id] .cm-content')
export const chips = (page: Page): Locator => page.locator('[data-testid^="group-chip:"]')
/** A tab by the note name it prints; `.first()` because a note can be in two panes. */
export const tabNamed = (page: Page, name: string): Locator =>
  page.locator('[data-slot-kind="tab"]', { hasText: name }).first()
