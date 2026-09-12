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
 * The note the Read specs (and the axe scan over the Live surface) type: one
 * of everything the construct table decorates, in the shapes the measured
 * vault holds — a legacy space-separated `tags:` flow list, a nested inline
 * tag, tasks in both states, a fenced block with a language.
 */
export const READ_FIXTURE = [
  '---',
  'tags: [composition testing]',
  'status: On deck',
  '---',
  '',
  '# Marks and Channels',
  '',
  'A note with a #edible/roadmap tag and a [link](https://example.com).',
  '',
  '- a bullet',
  '- [ ] a task',
  '- [x] a done task',
  '',
  '> a quote',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
].join('\n')

/** The seeded note the Read specs write into. */
export const READ_NOTE = 'notes/welcome.md'

/** Boot, open the note, replace it with `text`, and leave the caret at the end. */
export async function seedReadNote(
  page: Page,
  room: string,
  text: string = READ_FIXTURE
): Promise<void> {
  await openApp(page, room)
  await page.getByTestId(`file-item:${READ_NOTE}`).click()
  const content = page.locator('[data-testid="editor-pane"] .cm-content')
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+End')
}

export const panes = (page: Page): Locator => page.locator('[data-pane-id]')
export const editors = (page: Page): Locator => page.locator('[data-pane-id] .cm-content')
export const chips = (page: Page): Locator => page.locator('[data-testid^="group-chip:"]')
/** A tab by the note name it prints; `.first()` because a note can be in two panes. */
export const tabNamed = (page: Page, name: string): Locator =>
  page.locator('[data-slot-kind="tab"]', { hasText: name }).first()
