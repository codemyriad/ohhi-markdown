/**
 * Chrome (chrome-shaping U2+): the shell around the editor, driven the way a
 * person drives it — rails, navigator width, breadcrumb, status bar. Memory
 * vault contract, like v2.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test'

const RELAY = 'ws://localhost:8799'

async function openApp(page: Page, room: string, token = 'e2e-token'): Promise<void> {
  const params = new URLSearchParams({
    mode: 'memory',
    role: 'seed',
    relay: RELAY,
    room,
    token,
    user: 'Chris',
  })
  await page.goto(`/?${params.toString()}`)
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

test('the right rail collapses to icons, reopens to the section clicked, and Mod+ArrowRight toggles it', async ({
  page,
}) => {
  await openApp(page, 'chrome-rail')
  const rail = page.getByTestId('right-rail')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('rail-section:links')).toBeVisible()

  await page.getByTestId('rail-collapse').click()
  await expect(rail).toHaveAttribute('data-state', 'collapsed')
  await expect(page.getByTestId('rail-icon:links')).toBeVisible()
  await expect(page.getByTestId('links-panel')).toHaveCount(0)

  // Fold the section, collapse, then click its icon: the rail opens AND the section unfolds.
  await page.getByTestId('rail-icon:links').click()
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await page.getByTestId('rail-fold:links').click()
  await expect(page.getByTestId('rail-fold:links')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('rail-collapse').click()
  await page.getByTestId('rail-icon:links').click()
  await expect(page.getByTestId('rail-fold:links')).toHaveAttribute('aria-expanded', 'true')

  // Chris's own Obsidian key for the right sidebar.
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(rail).toHaveAttribute('data-state', 'collapsed')
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
})

test('the navigator resizes from the keyboard, hides on Mod+ArrowLeft, and the layout survives a reload', async ({
  page,
}) => {
  await openApp(page, 'chrome-nav')
  const navigator = page.getByTestId('navigator')
  await expect(navigator).toHaveCSS('width', '288px')

  await page.getByTestId('tree-resize').focus()
  await page.keyboard.press('End')
  await expect(navigator).toHaveCSS('width', '640px')
  await page.keyboard.press('ArrowLeft')
  await expect(navigator).toHaveCSS('width', '624px')

  await page.getByTestId('rail-collapse').click()
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCSS('width', '624px')
  await expect(page.getByTestId('right-rail')).toHaveAttribute('data-state', 'collapsed')

  await page.keyboard.press('ControlOrMeta+ArrowLeft')
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await page.getByTestId('toggle-tree').click()
  await expect(page.getByTestId('navigator')).toBeVisible()
})

test('the breadcrumb names the open note and reveals its folder; the status bar carries the word count and the note pill', async ({
  page,
}) => {
  await openApp(page, 'chrome-crumb')
  await expect(page.getByTestId('breadcrumb')).toHaveText('No note open')
  await expect(page.getByTestId('word-count')).toHaveCount(0)

  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(page.getByTestId('crumb:notes')).toBeVisible()
  await expect(page.getByTestId('crumb-note')).toHaveText('welcome')
  await expect(page.getByTestId('status-bar').getByTestId('word-count')).toBeVisible()
  await expect(page.getByTestId('sync-pill-note')).toBeVisible()

  // Collapse the folder in the tree, then ask the breadcrumb to reveal it.
  await page.getByTestId('dir-item:notes').click()
  await page.getByTestId('dir-item:notes').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('crumb:notes').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-selected', 'true')

  // The ways in live in the navigator now, with their keys beside them.
  await expect(page.getByTestId('actions').getByTestId('open-search')).toContainText('Search')
  await page.getByTestId('open-quick-open').click()
  await expect(page.getByTestId('quick-open-input')).toBeVisible()
})

test('the tree: icon toolbar, collapse all, a filter menu, quiet rows, F2 / Mod+Shift+R, a refused drop that says why, and add-share from the menu or palette', async ({
  page,
}) => {
  // An authorised room (seeded by start-relay.mjs), so the note can actually go green.
  await openApp(page, 'chrome-tree', 'chrome-token')

  // Quiet when good: the open note is green in the status bar and carries no dot in the tree.
  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(page.getByTestId('sync-pill-note')).toHaveAttribute('data-status', 'green', {
    timeout: 15_000,
  })
  await expect(page.getByTestId('sync-pill:notes/welcome.md')).toHaveCount(0)

  // Icons with names; collapse all at once.
  await expect(page.getByRole('button', { name: /New note/ })).toBeVisible()
  await page.getByTestId('collapse-all').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'false')
  await page.getByTestId('dir-item:notes').click()
  await page.getByTestId('dir-item:notes').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'true')

  // The filter is a menu of radio items. This memory vault is root-shared, so Local empties it.
  await page.getByTestId('tree-filter').click()
  await expect(page.getByTestId('tree-filter:all')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('tree-filter:local').click()
  await expect(page.getByTestId('file-item:notes/welcome.md')).toHaveCount(0)
  await page.getByTestId('tree-filter').click()
  await page.getByTestId('tree-filter:all').click()
  await expect(page.getByTestId('file-item:notes/welcome.md')).toBeVisible()

  // F2 on a row renames through the same dialog the menu uses. (Click, not
  // focus(): the filter menu hands focus back to its trigger a tick after
  // closing, which would race a bare focus() call.)
  await page.getByTestId('file-item:notes/ideas.md').click()
  await page.keyboard.press('F2')
  await expect(page.getByTestId('tree-op-dialog')).toContainText('Rename ideas.md')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tree-op-dialog')).toHaveCount(0)

  // Chris's Mod+Shift+R: delete the OPEN note — it asks first.
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.keyboard.press('ControlOrMeta+Shift+r')
  await expect(page.getByTestId('tree-op-dialog')).toContainText('Delete file welcome.md?')
  await page.getByTestId('tree-op-cancel').click()

  // A refused drop (same parent) says why ON THE ROW while the pointer is
  // there — browsers show no title mid-drag, so the reason is rendered.
  // Driven by hand: dragAndDrop() completes the gesture before anything can
  // be asserted mid-flight.
  const source = (await page.getByTestId('file-item:notes/ideas.md').boundingBox())!
  const target = (await page.getByTestId('dir-item:notes').boundingBox())!
  await page.mouse.move(source.x + 40, source.y + source.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 6 })
  await page.mouse.move(target.x + 42, target.y + target.height / 2)
  await expect(page.getByTestId('drop-refusal')).toContainText("'ideas.md' is already there")
  await page.mouse.up()
  // The trailing notice rides on `dragend`, which a real browser fires on the
  // source when any drag ends; Playwright's intercepted drag does not
  // synthesise it, so the toast is not asserted here.
  await expect(page.getByTestId('drop-refusal')).toHaveCount(0)

  // Add a shared folder: the tree menu states the rule (this vault is shared as a whole);
  // the command palette opens the dialog regardless.
  await page.getByTestId('tree-root').click({ button: 'right', position: { x: 30, y: 320 } })
  await expect(page.getByTestId('tree-menu:add-share')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('tree-menu-reason:add-share')).toContainText('shared as a whole')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('shared folder')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('add-share-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('add-share-dialog')).toHaveCount(0)
})

test('the rail says where the open note lives, who is online there, and the header no longer carries presence', async ({
  page,
}) => {
  await openApp(page, 'chrome-note', 'e2e-token')
  const section = page.getByTestId('rail-section:note')
  await expect(section).toContainText('No note open')
  // This memory vault is shared as a whole (the relay is on the root mount).
  await expect(section.getByTestId('share-state')).toContainText('Shared as a whole')

  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(section).toContainText('notes')
  await expect(section.getByTestId('share-state')).toContainText('Shared as a whole')
  await expect(section.getByTestId('presence')).toBeVisible()
  await expect(page.locator('header').getByTestId('presence')).toHaveCount(0)
  // The access line is honest about what a root share can say here.
  await expect(section.getByTestId('share-access')).toContainText('links')

  // The rail's icon carries the online count once someone is here.
  await page.getByTestId('rail-collapse').click()
  await expect(page.getByTestId('rail-icon:note')).toBeVisible()
  await page.getByTestId('rail-icon:note').click()
  await expect(section).toBeVisible()
})
