/**
 * The dock (Round 2 P4, after Cursor's right edge): a small floating strip of
 * icons over the editor's right margin that opens a panel with its own tabs
 * (Links, History); pinned, the same panel is the right column when open,
 * and collapsed it is the same floating strip (Round 3 Q3). NOT forcing
 * `dense` — every test boots the device's own choice, `light`'s dock.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  appUrl,
  closeSettings,
  dismissToasts,
  expectAccessible,
  openByQuickOpen,
  openSettings,
  runCommand,
  seedProvider,
  test as withMockLlm,
  withObsidianKeys,
} from './fixtures.js'

async function boot(page: Page, room: string): Promise<void> {
  await page.goto(appUrl({ room, layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
}

async function axe(page: Page, surface: string): Promise<void> {
  await dismissToasts(page)
  await expectAccessible(page, surface)
}

const content = (page: Page) => page.locator('[data-testid="editor-pane"] .cm-content')

test('the strip floats top-right; an icon opens the panel on its tab; Escape and Mod+ArrowRight close it', async ({
  page,
}) => {
  await withObsidianKeys(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await boot(page, 'dock-float')
  // A link INTO welcome, so its Links tab has a backlink to show.
  await openByQuickOpen(page, 'ideas')
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nsee [[welcome]]\n')
  await openByQuickOpen(page, 'welcome')
  await expect(content(page)).toContainText('Welcome to Editor')

  const strip = page.getByTestId('dock')
  await expect(strip).toBeVisible()
  await expect(strip).toHaveAttribute('role', 'toolbar')
  await expect(strip).toHaveAttribute('data-position', 'top-right')
  await expect(strip).toHaveAttribute('data-compact', 'false')
  await expect(page.getByTestId('right-rail')).toHaveCount(0)
  // Top-right, in the margin beside the measure: never over the text.
  const area = (await page.getByTestId('editor-pane').boundingBox())!
  const box = (await strip.boundingBox())!
  const text = (await content(page).boundingBox())!
  expect(box.x + box.width).toBeGreaterThan(area.x + area.width - 40)
  expect(box.y).toBeLessThan(area.y + 20)
  expect(box.x).toBeGreaterThan(text.x + text.width - 16)
  await axe(page, 'the dock strip')

  // Roving focus: one tab stop, arrows move.
  await page.getByTestId('rail-icon:links').focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('rail-icon:history')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByTestId('rail-icon:links')).toBeFocused()
  await expect(page.getByTestId('rail-icon:history')).toHaveAttribute('tabindex', '-1')

  // Links: the panel opens on the Links tab with the note's backlinks.
  await page.getByTestId('rail-icon:links').click()
  const panel = page.getByTestId('dock-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-form', 'float')
  await expect(strip).toHaveCount(0)
  await expect(panel.getByTestId('rail-tab:links')).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByTestId('backlink-source:notes/ideas.md')).toBeVisible({ timeout: 10_000 })
  // The compact tab row (Round 3 Q3): the note tab strip's height, small
  // labels beside their icons, pin and collapse at its right end.
  const tablist = panel.getByRole('tablist')
  // (`light` draws no note strip for one tab: its height is `TabStrip`'s h-8.)
  const row = (await tablist.locator('..').boundingBox())!
  expect(Math.round(row.height)).toBe(32)
  await expect(panel.getByTestId('rail-tab:links')).toHaveCSS('font-size', '11px')
  await expect(panel.getByTestId('rail-tab:links').locator('svg')).toHaveCount(1)
  await expect(tablist.getByTestId('rail-collapse')).toHaveCount(0)
  const collapseBox = (await panel.getByTestId('rail-collapse').boundingBox())!
  expect(collapseBox.y).toBeGreaterThanOrEqual(row.y - 1)
  expect(collapseBox.y + collapseBox.height).toBeLessThanOrEqual(row.y + row.height + 1)
  await axe(page, 'the dock panel, Links')

  // The History tab: the journal list for the open note.
  await panel.getByTestId('rail-tab:history').click()
  await expect(panel.getByTestId('history-section')).toBeVisible()
  await expect(panel.getByTestId('links-panel')).toHaveCount(0)
  await axe(page, 'the dock panel, History')

  // Escape collapses, and focus goes back to the strip — on the tab it was on.
  await panel.getByTestId('rail-tab:history').focus()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.getByTestId('rail-icon:history')).toBeFocused()

  // Mod+ArrowRight toggles the same panel, on the same tab.
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('rail-tab:history')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(panel).toHaveCount(0)
  await expect(strip).toBeVisible()

  // The `»` collapses too.
  await page.getByTestId('rail-expand').click()
  await expect(panel).toBeVisible()
  await page.getByTestId('rail-collapse').click()
  await expect(panel).toHaveCount(0)
  await expect(strip).toBeVisible()
})

test('pin opens the dock as the rail column; pinned, it offers unpin only; unpinned, it is the floating strip again', async ({
  page,
}) => {
  await withObsidianKeys(page)
  await page.setViewportSize({ width: 1280, height: 800 })
  await boot(page, 'dock-pin')
  await openByQuickOpen(page, 'welcome')
  const editorWidth = async (): Promise<number> => (await page.getByTestId('editor-area').boundingBox())!.width
  const unpinnedWidth = await editorWidth()

  await page.getByTestId('rail-icon:history').click()
  await page.getByTestId('rail-pin').click()
  const rail = page.getByTestId('right-rail')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('dock')).toHaveCount(0)
  await expect(page.getByTestId('dock-region')).toHaveCount(0)
  // One open state, one tab: the column shows the tab the dock was on.
  await expect(rail.getByTestId('rail-tab:history')).toHaveAttribute('aria-selected', 'true')
  // Pinning the right side never pins the left (P7).
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  // The bug: a pinned column clicked open a popover beside itself.
  await rail.getByTestId('rail-tab:links').click()
  await expect(rail.getByTestId('links-panel')).toBeVisible()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  // Pinned = unpin only (Chris, 2026-10-06): no pin, and no collapse.
  await expect(rail.getByTestId('rail-pin')).toHaveCount(0)
  await expect(rail.getByTestId('rail-collapse')).toHaveCount(0)
  await expect(rail.getByTestId('rail-unpin')).toBeVisible()
  expect(await editorWidth()).toBeLessThan(unpinnedWidth - 200)
  await axe(page, 'the dock pinned as a column')

  // The sidebar key on a pinned column focuses it; it never collapses it.
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await expect(rail.getByTestId('rail-tab:links')).toBeFocused()

  // Unpinned, the column goes, the editor takes its width back, and the dock
  // is the floating strip with focus on it.
  await rail.getByTestId('rail-unpin').click()
  await expect(rail).toHaveCount(0)
  const strip = page.getByTestId('dock')
  await expect(strip).toBeVisible()
  await expect(strip).toHaveAttribute('data-form', 'float')
  await expect(page.getByTestId('rail-icon:links')).toBeFocused()
  await expect.poll(editorWidth).toBe(unpinnedWidth)
  await axe(page, 'the dock unpinned')

  // Unpinned, the strip's tab opens the floating panel, not a column.
  await page.getByTestId('rail-icon:history').click()
  await expect(page.getByTestId('dock-panel')).toHaveAttribute('data-form', 'float')
  await expect(rail).toHaveCount(0)
})

test('pinned, the format bar and the corner span the panes left of the column: the corner stays on the bar’s row, shifted over', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await boot(page, 'dock-pin-float')
  await openByQuickOpen(page, 'welcome')
  await page.getByTestId('rail-icon:links').click()
  await page.getByTestId('rail-pin').click()
  const rail = (await page.getByTestId('right-rail').boundingBox())!
  const area = (await page.getByTestId('editor-area').boundingBox())!
  expect(area.x + area.width).toBeLessThanOrEqual(rail.x + 1)
  const bar = (await page.getByTestId('format-bar').boundingBox())!
  const corner = (await page.getByTestId('corner-status').boundingBox())!
  // Both inside the pane area, never under the column.
  expect(bar.x).toBeGreaterThanOrEqual(area.x)
  expect(corner.x + corner.width).toBeLessThanOrEqual(rail.x)
  expect(corner.x + corner.width).toBeGreaterThan(rail.x - 24)
  // One row: the bar moved left to make room rather than the corner stacking.
  await expect(page.getByTestId('float-bottom')).toHaveAttribute('data-stacked', 'false')
  expect(Math.abs(corner.y + corner.height - (bar.y + bar.height))).toBeLessThan(6)
  expect(corner.x).toBeGreaterThanOrEqual(bar.x + bar.width)
})

test('bottom-right, the strip stands above the corner count at every width — and takes its place when the count is off', async ({
  page,
}) => {
  await boot(page, 'dock-bottom-right')
  await openByQuickOpen(page, 'welcome')
  await openSettings(page, 'layout')
  await page.getByTestId('layout-field:sidebar_position').selectOption('bottom-right')
  await closeSettings(page)
  const strip = page.getByTestId('dock')
  await expect(strip).toHaveAttribute('data-position', 'bottom-right')

  const apart = async (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y
  // Just above the corner, never on it or on the bar — polled, since the
  // strip re-measures its place a frame after a resize.
  const standsOnCorner = (width: number) =>
    expect
      .poll(async () => {
        const s = (await strip.boundingBox())!
        const c = (await page.getByTestId('corner-status').boundingBox())!
        const f = (await page.getByTestId('format-bar').boundingBox())!
        return (await apart(s, c)) && (await apart(s, f)) && s.y + s.height <= c.y && c.y - (s.y + s.height) < 16
      }, { message: `at ${width} px` })
      .toBe(true)
  for (const width of [1280, 900, 640, 480]) {
    await page.setViewportSize({ width, height: 720 })
    await standsOnCorner(width)
  }

  // The count off: the strip comes down into the corner's place. `before`
  // is read once the strip has left 480 px's compact form and settled.
  await page.setViewportSize({ width: 1280, height: 720 })
  await expect(strip).toHaveAttribute('data-compact', 'false')
  await standsOnCorner(1280)
  const before = (await strip.boundingBox())!
  await openSettings(page, 'layout')
  await page.getByTestId('layout-field:status').selectOption('off')
  await closeSettings(page)
  await expect(page.getByTestId('corner-status')).toHaveCount(0)
  const area = (await page.getByTestId('editor-area').boundingBox())!
  await expect.poll(async () => (await strip.boundingBox())!.y).toBeGreaterThan(before.y)
  const after = (await strip.boundingBox())!
  expect(area.y + area.height - (after.y + after.height)).toBeLessThan(16)
})

test('at a narrow width the strip shrinks to its expand button; Focus mode hides it', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 700 })
  await boot(page, 'dock-narrow')
  await openByQuickOpen(page, 'welcome')
  const strip = page.getByTestId('dock')
  await expect(strip).toHaveAttribute('data-compact', 'true')
  await expect(strip.getByTestId('rail-expand')).toBeVisible()
  await expect(strip.getByTestId('rail-icon:links')).toHaveCount(0)
  await strip.getByTestId('rail-expand').click()
  await expect(page.getByTestId('dock-panel')).toBeVisible()
  await expect(page.getByTestId('rail-tab:links')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(strip.getByTestId('rail-expand')).toBeFocused()

  // Focus mode keeps no rail in `light`: the dock goes with the rest.
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+.')
  await expect(page.getByTestId('dock')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+.')
  await expect(page.getByTestId('dock')).toBeVisible()
})

test('over a collection the strip keeps clear of the toolbar: "+ New" is never under it (QA round 1)', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 700 })
  await boot(page, 'dock-collection')
  await openByQuickOpen(page, 'welcome')
  await runCommand(page, 'New collection')
  await expect(page.getByTestId('collection-view')).toBeVisible()
  const strip = page.getByTestId('dock')
  await expect(strip).toBeVisible()
  const s = (await strip.boundingBox())!
  const n = (await page.getByTestId('collection-new').boundingBox())!
  // Side by side on the same row, the button wholly left of the strip.
  expect(n.y < s.y + s.height && s.y < n.y + n.height).toBe(true)
  expect(n.x + n.width).toBeLessThanOrEqual(s.x)
})

/**
 * QA feedback round 1: with several panes the dock says which note it is
 * about — the note's name and folder over the sections — and, while a
 * session has the focus, that it is still showing the note focused last.
 */
withMockLlm('the context line names the note the dock follows; a session focused, it says "last focused"', async ({
  page,
  mockLlm,
}) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  const mock = await mockLlm([])
  await seedProvider(page, `${mock.url}/v1`)
  await boot(page, 'dock-context')
  await openByQuickOpen(page, 'welcome')
  await expect(content(page)).toContainText('Welcome to Editor')

  // The note focused: the line names it and its folder, nothing more.
  await page.getByTestId('rail-icon:links').click()
  const line = page.getByTestId('dock-panel').getByTestId('dock-note')
  await expect(line).toHaveAttribute('data-path', 'notes/welcome.md')
  await expect(line).toHaveAttribute('data-last-focused', 'false')
  await expect(line).toContainText('welcome')
  await expect(line).toContainText('notes')
  await expect(line.getByTestId('dock-note-last')).toHaveCount(0)

  // A session beside the note, holding the focus: the open panel stays on
  // the note and says it is the one focused last.
  await runCommand(page, 'Open AI session')
  await expect(page.getByTestId('session-composer-input')).toBeVisible()
  await expect(page.locator('[data-pane-id]')).toHaveCount(2)
  await expect(line).toHaveAttribute('data-path', 'notes/welcome.md')
  await expect(line).toHaveAttribute('data-last-focused', 'true')
  await expect(line.getByTestId('dock-note-last')).toBeVisible()
  await expect(line.getByRole('button', { name: 'Go to welcome' })).toBeVisible()
  await axe(page, 'the dock panel, naming the last focused note')

  // Its button goes to the note: the pane holding it takes the focus.
  await line.getByTestId('dock-note-go').click()
  await expect(line).toHaveAttribute('data-last-focused', 'false')
  await expect(line.getByTestId('dock-note-last')).toHaveCount(0)

  // A second note focused: the dock names it.
  await openByQuickOpen(page, 'ideas')
  if ((await page.getByTestId('dock-panel').count()) === 0) await page.getByTestId('rail-icon:links').click()
  await expect(line).toHaveAttribute('data-path', 'notes/ideas.md')
  await expect(line).toHaveAttribute('data-last-focused', 'false')
})
