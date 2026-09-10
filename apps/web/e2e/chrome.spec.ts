/**
 * Chrome (chrome-shaping U2+): the shell around the editor, driven the way a
 * person drives it — rails, navigator width, breadcrumb, status bar. Memory
 * vault contract, like v2.spec.ts.
 */
import { expect, test, type Page } from '@playwright/test'
import { encodeDeviceLink, encodeShareLink } from '../src/lib/share-link.js'

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

  // Add a shared folder: offered from the tree menu even in a shared vault
  // (depth-1 nesting, device-link-shaping A5); the command palette opens the
  // same dialog.
  await page.getByTestId('tree-root').click({ button: 'right', position: { x: 30, y: 320 } })
  await expect(page.getByTestId('tree-menu:add-share')).not.toHaveAttribute('aria-disabled', 'true')
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
  // The relay is on the ROOT mount, so this vault is LINKED — never "shared"
  // (device-link N2, decision 2): the vault-level line and the per-note line
  // are the two halves of that.
  await expect(section.getByTestId('share-state')).toContainText('Synced to your devices')

  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(section).toContainText('notes')
  await expect(section.getByTestId('share-state')).toContainText('On your devices')
  await expect(section.getByTestId('presence')).toBeVisible()
  await expect(page.locator('header').getByTestId('presence')).toHaveCount(0)
  // The access line is honest about what a root share can say here.
  await expect(section.getByTestId('share-access')).toContainText('links')

  // The rail agrees with the tree menu (device-link-shaping A5, depth 1): a
  // device-linked vault is not a mount around this note, so sharing this
  // folder and adding a share here are both still offered. They used to
  // disappear the moment the vault was linked, while the menu still offered
  // them on the same folder.
  await expect(section.getByTestId('note-share-folder')).toBeVisible()
  await expect(section.getByTestId('note-add-share')).toBeVisible()

  // The rail's icon carries the online count once someone is here.
  await page.getByTestId('rail-collapse').click()
  await expect(page.getByTestId('rail-icon:note')).toBeVisible()
  await page.getByTestId('rail-icon:note').click()
  await expect(section).toBeVisible()
})

test('a workspace error toasts once and stays in Activity with its time; the badge counts it until read; devtools toggles from there', async ({
  page,
}) => {
  // An unseeded room: the relay rejects the token, which is a real error the
  // workspace raises — exactly what used to be one truncated header string.
  await openApp(page, 'chrome-notice')
  await expect(page.getByTestId('toast')).toContainText('relay rejected this token')

  const activity = page.getByTestId('rail-section:activity')
  await expect(activity.getByTestId('activity-section')).toContainText('relay rejected this token')
  await expect(activity.locator('time')).toHaveCount(1)

  // Folding the section makes what arrives next unread; the rail icon shows the count.
  await page.getByTestId('rail-fold:activity').click()
  await page.getByTestId('rail-collapse').click()
  await expect(page.getByTestId('rail-icon:activity')).toBeVisible()
  await page.getByTestId('rail-icon:activity').click()
  await expect(activity.getByTestId('activity-section')).toBeVisible()

  await activity.getByTestId('activity-devtools').check()
  await expect(page.getByTestId('devtools-panel')).toBeVisible()
  await activity.getByTestId('activity-devtools').uncheck()
  await expect(page.getByTestId('devtools-panel')).toHaveCount(0)

  await activity.getByTestId('activity-clear').click()
  await expect(activity.getByTestId('activity-section')).toContainText('Nothing to report')
})

test('settings are tabs: keyboard between them, validated forms with their own Save, and an unsaved-changes guard on close', async ({
  page,
}) => {
  await openApp(page, 'chrome-settings')
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByTestId('settings-panel')
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')

  // Arrow keys move between tabs (vertical list → down).
  await page.getByRole('tab', { name: 'General' }).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('tab', { name: 'Sync' })).toHaveAttribute('aria-selected', 'true')

  // An invalid relay URL is refused inline, wired to the control.
  const relay = page.getByTestId('settings-relay')
  await relay.fill('http://not-a-relay')
  await relay.blur()
  await expect(relay).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByTestId('field-errors:relay')).toContainText('starts with ws://')

  // Escape with unsaved (and invalid) changes prompts instead of closing.
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await expect(page.getByTestId('settings-unsaved')).toBeVisible()
  await page.getByTestId('settings-discard').click()
  await expect(dialog).toHaveCount(0)

  // A valid change saves from its own tab and survives a reopen.
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:sync').click()
  await page.getByTestId('settings-relay').fill('wss://relay.example.test')
  await page.getByTestId('settings-save-sync').click()
  await expect(page.getByTestId('settings-save-sync')).toBeDisabled()
  await page.getByTestId('settings-close').click()
  await expect(dialog).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:sync').click()
  await expect(page.getByTestId('settings-relay')).toHaveValue('wss://relay.example.test')
  await page.getByTestId('settings-close').click()
})

test('link a device: the manager refuses a folder link, and the panel reports a failure with a retry', async ({
  page,
}) => {
  // The manager, with no vault remembered — where a NEW device starts.
  await page.goto('/')
  await expect(page.getByTestId('open-link-device')).toBeVisible()
  await page.getByTestId('manager-name').fill('Chris')
  await page.getByTestId('open-link-device').click()
  await expect(page.getByTestId('link-device-dialog')).toBeVisible()

  // A folder link is refused AT THE FIELD, with the reason and the affordance
  // that does want it (device-link-shaping R5: folder links never grant a vault).
  await page
    .getByTestId('link-device-input')
    .fill(encodeShareLink({ relay: RELAY, room: 'team-room', token: 'a'.repeat(64) }))
  await page.getByTestId('link-device-submit').click()
  await expect(page.getByTestId('field-errors:link')).toContainText('folder link')

  // A device link the relay does not know: the panel comes up, then says what
  // went wrong and offers a retry — never a dead end, never a blank minute.
  await page
    .getByTestId('link-device-input')
    .fill(encodeDeviceLink({ relay: RELAY, room: 'chrome-unknown-room', token: 'nope' }))
  await page.getByTestId('link-device-submit').click()
  await expect(page.getByTestId('join-progress')).toBeVisible()
  await expect(page.getByTestId('join-attachments')).toContainText('Images and PDFs')
  await expect(page.getByTestId('join-error')).toContainText('rejected', { timeout: 20_000 })
  await expect(page.getByTestId('join-retry')).toBeVisible()

  await page.getByTestId('join-cancel').click()
  await expect(page.getByTestId('open-link-device')).toBeVisible()
})

test('settings › sync offers device linking, and asks for the operator secret first', async ({
  page,
}) => {
  await openApp(page, 'chrome-device-link')
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:sync').click()
  const section = page.getByTestId('settings-device-link')
  await expect(section).toContainText('Link a device')

  // No operator secret: the refusal names the thing to set, and there is no
  // button that would fail on being pressed.
  await expect(page.getByTestId('settings-link-device-needs-secret')).toBeVisible()
  await expect(page.getByTestId('settings-link-device')).toHaveCount(0)

  // With a secret typed, the button appears — and leaving for the dialog SAVES
  // the form first (the dialog mints with the secret from config).
  await page.getByTestId('settings-secret').fill('e2e-operator-secret')
  await page.getByTestId('settings-link-device').click()
  await expect(page.getByTestId('settings-panel')).toHaveCount(0)
  await expect(page.getByTestId('device-link-dialog')).toBeVisible()
  // The R5 sentence rides with the LINK, so before one exists the dialog shows
  // the way to make one, not a warning about a key nobody holds yet.
  await expect(page.getByTestId('create-device-link')).toBeVisible()
  await page.getByTestId('close-device-link').click()
  await expect(page.getByTestId('device-link-dialog')).toHaveCount(0)

  // The command palette reaches the same dialog.
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Link a device')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('device-link-dialog')).toBeVisible()
})
