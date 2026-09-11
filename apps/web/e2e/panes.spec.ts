/**
 * Panes and tabs (tab-groups W1) — the slice's demo, driven the way Chris
 * drives it: his own pane keys, then the mouse for the two gestures a
 * keyboard cannot express (drag-to-split, drag a border), then the two panes
 * on one note that Spike S9 is about.
 *
 * Memory vault contract, like v2.spec.ts — no folder, no share.
 */
import { expect, test } from '@playwright/test'
import { dragTo, editors, openApp, panes, tabNamed } from './fixtures.js'

const WELCOME = 'notes/welcome.md'
const IDEAS = 'notes/ideas.md'

test('his pane keys rebuild a four-pane layout, and the arrows move between them', async ({
  page,
}) => {
  await openApp(page, 'panes-keys')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(panes(page)).toHaveCount(1)

  // Alt+- splits down, Alt+= splits right — his own Obsidian rebinds. Each
  // split duplicates the active note into the new pane, as Obsidian does.
  await page.keyboard.press('Alt+-')
  await expect(panes(page)).toHaveCount(2)
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(3)

  // Ctrl+Mod+Arrows move focus. Off mac that chord is Ctrl+Alt, so that it
  // stays distinct from his Mod+Arrows sidebar toggles (see commands.ts).
  // The focused pane is the one carrying the testids the rest of the shell
  // drives, so its status bar names it.
  await expect(page.getByTestId('status-bar')).toContainText('Pane 3')
  await page.keyboard.press('Control+Alt+ArrowLeft')
  await expect(page.getByTestId('status-bar')).toContainText('Pane 2')
  await page.keyboard.press('Control+Alt+ArrowUp')
  await expect(page.getByTestId('status-bar')).toContainText('Pane 1')

  // A fourth pane, and four live editors — one per pane on screen (R2.1).
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(4)
  await expect(editors(page)).toHaveCount(4)

  // Ctrl+Mod+Backspace closes the focused pane; its share goes to a neighbour.
  await page.keyboard.press('Control+Alt+Backspace')
  await expect(panes(page)).toHaveCount(3)
})

test('a tab dropped on a pane edge splits it; a tab dropped on a strip moves', async ({ page }) => {
  await openApp(page, 'panes-drag')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await expect(panes(page)).toHaveCount(1)
  // The first open fills the pane's empty tab; the second is a tab of its own.
  await expect(page.getByRole('tab')).toHaveCount(2)

  // Drag the *ideas* tab onto the left quarter of the pane: a new pane there.
  const pane = panes(page).first()
  const box = (await pane.boundingBox())!
  const ideas = tabNamed(page, 'ideas')
  await dragTo(page, ideas, box.x + box.width * 0.1, box.y + box.height * 0.6)
  await expect(panes(page)).toHaveCount(2)
  // The dragged note went with it, and the new pane took focus.
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')

  // Drop it back onto the other pane's strip: two panes become one again when
  // the source pane's last tab leaves.
  const other = panes(page).nth(1)
  const strip = (await other.locator('[data-strip]').boundingBox())!
  const moved = tabNamed(page, 'ideas')
  await dragTo(page, moved, strip.x + strip.width - 40, strip.y + strip.height / 2)
  await expect(panes(page)).toHaveCount(1)
})

test('a split border drags, and the sizes survive a reload', async ({ page }) => {
  await openApp(page, 'panes-resize')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(2)

  const first = panes(page).first()
  const before = (await first.boundingBox())!.width
  const handle = page.locator('[data-testid^="pane-resize:"]').first()
  const hbox = (await handle.boundingBox())!
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
  await page.mouse.down()
  await page.mouse.move(hbox.x + 160, hbox.y + hbox.height / 2, { steps: 10 })
  await page.mouse.up()
  const after = (await first.boundingBox())!.width
  expect(after).toBeGreaterThan(before + 100)

  // Device-local, versioned, and pruned against the vault at boot (B6).
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(panes(page)).toHaveCount(2)
  const restored = (await panes(page).first().boundingBox())!.width
  expect(Math.abs(restored - after)).toBeLessThan(8)
})

test('the same note in two panes edits both ways and shows one truth', async ({ page }) => {
  await openApp(page, 'panes-two-views')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  // A split duplicates the active note: one Y.Text, two views (Spike S9).
  await page.keyboard.press('Alt+=')
  await expect(editors(page)).toHaveCount(2)

  const left = editors(page).first()
  const right = editors(page).nth(1)
  await right.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('RIGHT-SIDE ')
  await expect(left).toContainText('RIGHT-SIDE')

  await left.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('LEFT-SIDE ')
  await expect(right).toContainText('LEFT-SIDE')

  // Two panes, one record, one pill state — golden rule 4 under N views (R4.2).
  const focused = page.getByTestId('status-bar').getByTestId('sync-pill-note')
  const other = page.locator('[data-testid^="sync-pill-pane:"]')
  await expect(focused).toBeVisible()
  await expect(other).toHaveCount(1)
  await expect
    .poll(async () => (await focused.getAttribute('data-status')) === (await other.getAttribute('data-status')))
    .toBe(true)
})

test('deleting a note in the tree closes its tabs, in every pane', async ({ page }) => {
  await openApp(page, 'panes-delete')
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await page.keyboard.press('Alt+=')
  await expect(editors(page)).toHaveCount(2)

  await page.getByTestId(`file-item:${IDEAS}`).click({ button: 'right' })
  await page.getByTestId('tree-menu:delete').click()
  await page.getByTestId('tree-op-confirm').click()

  // The tabs go with the note, the panes settle, and nothing crashes (R5).
  await expect(page.locator('[data-slot-kind="tab"]', { hasText: 'ideas' })).toHaveCount(0, {
    timeout: 10_000,
  })
  await expect(page.getByTestId('file-tree')).toBeVisible()
})

test('the pane mode zooms and resizes from the keyboard, and says what it does', async ({
  page,
}) => {
  await openApp(page, 'panes-mode')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(2)

  // Mod+P is the leader; the bar shows the live mode and what its keys do.
  await page.keyboard.press('ControlOrMeta+p')
  const bar = page.getByTestId('mode-bar')
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('mode-badge')).toHaveText('PANE')
  await expect(bar).toContainText('Split down')

  // `f` zooms: one pane on screen, one live editor, and the status bar says so.
  await page.keyboard.press('f')
  await expect(panes(page)).toHaveCount(1)
  await expect(editors(page)).toHaveCount(1)
  await expect(page.getByTestId('pane-zoomed')).toBeVisible()
  // Pane mode is one-shot — the action put us back in the editor.
  await expect(bar).toHaveCount(0)

  // ...and `f` again restores the layout that was never taken apart.
  await page.keyboard.press('ControlOrMeta+p')
  await page.keyboard.press('f')
  await expect(panes(page)).toHaveCount(2)

  // The resize sub-mode is STICKY: one `s`, then `l` as many times as it takes.
  const before = (await panes(page).first().boundingBox())!.width
  await page.keyboard.press('ControlOrMeta+p')
  await page.keyboard.press('s')
  await expect(page.getByTestId('mode-badge')).toHaveText('RESIZE')
  await page.keyboard.press('l')
  await page.keyboard.press('l')
  await expect(page.getByTestId('mode-bar')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mode-bar')).toHaveCount(0)
  const after = (await panes(page).first().boundingBox())!.width
  expect(after).toBeGreaterThan(before)
})

test('every open is a tab: the tree, Mod+click and the tab keys', async ({ page }) => {
  await openApp(page, 'panes-tabs')
  // The first open fills the empty tab a fresh pane starts with.
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(page.getByRole('tab')).toHaveCount(1)

  // Fork 1-B: a second note is a second tab, and it takes over.
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')

  // R3: opening it again activates the tab that is already there.
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(page.getByRole('tab')).toHaveCount(2)
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Welcome')

  // Ctrl+Tab / Ctrl+Shift+Tab — Obsidian's unrebound defaults.
  await page.keyboard.press('Control+Tab')
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')
  await page.keyboard.press('Control+Shift+Tab')
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Welcome')

  // Mod+W closes, Mod+Shift+T brings it back at its own place.
  await page.keyboard.press('ControlOrMeta+w')
  await expect(page.getByRole('tab')).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+Shift+t')
  await expect(page.getByRole('tab')).toHaveCount(2)

  // The strip is a real tablist: arrows move the roving tab stop.
  await page.getByRole('tab', { selected: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { selected: false })).toBeFocused()
})
