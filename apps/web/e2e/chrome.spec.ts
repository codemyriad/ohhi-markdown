/**
 * Chrome (chrome-shaping U2+): the shell around the editor, driven the way a
 * person drives it — rails, navigator width, breadcrumb, status bar. Memory
 * vault contract, like v2.spec.ts.
 */
import { expect, test } from '@playwright/test'
import { encodeDeviceLink, encodeShareLink } from '../src/lib/share-link.js'
import { MANAGER_URL, RELAY, createBrowserVault, dragTo, openApp, openByQuickOpen, openManager, paneContent, runCommand } from './fixtures.js'

test('the pinned rail is the dock panel: tabs, unpin only (no collapse), one open state and one tab, Mod+ArrowRight', async ({
  page,
}) => {
  await openApp(page, 'chrome-rail')
  // A note open: the floating strip sits in the margin beside its measure
  // (over a view or an empty pane there is no margin, and it is `«` alone).
  await openByQuickOpen(page, 'welcome')
  const rail = page.getByTestId('right-rail')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('rail-section:links')).toBeVisible()
  await expect(page.getByTestId('rail-tab:links')).toHaveAttribute('aria-selected', 'true')
  // Pinned = unpin only (Chris, 2026-10-06): a column is never collapsed,
  // it is unpinned — even `dense`'s, a column by its own file. An open
  // column never also floats a strip over the editor.
  await expect(rail.getByTestId('rail-unpin')).toBeVisible()
  await expect(page.getByTestId('rail-collapse')).toHaveCount(0)
  await expect(page.getByTestId('rail-pin')).toHaveCount(0)
  await expect(page.getByTestId('dock')).toHaveCount(0)

  // One tab at a time — one section, never a stack.
  await rail.getByTestId('rail-tab:history').click()
  await expect(page.getByTestId('history-section')).toBeVisible()
  await expect(page.getByTestId('links-panel')).toHaveCount(0)

  // Chris's own Obsidian key for the right sidebar, on a pinned column:
  // it does not collapse it — it puts focus on the column's tab.
  await paneContent(page).click()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(rail).toHaveAttribute('data-state', 'expanded')
  await expect(page.getByTestId('rail-tab:history')).toBeFocused()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)

  // Unpinned, the column is gone and the dock is its floating strip — the
  // same strip as everywhere (Round 3 Q3); focus lands on it.
  await rail.getByTestId('rail-unpin').click()
  await expect(rail).toHaveCount(0)
  await expect(page.getByTestId('dock')).toHaveAttribute('data-form', 'float')
  await expect(page.getByTestId('rail-icon:history')).toBeFocused()
  await expect(page.getByTestId('links-panel')).toHaveCount(0)

  // Now a dock: an icon opens the floating panel on ITS tab, with pin and collapse.
  await page.getByTestId('rail-icon:links').click()
  const panel = page.getByTestId('dock-panel')
  await expect(panel).toHaveAttribute('data-form', 'float')
  await expect(page.getByTestId('rail-tab:links')).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByTestId('rail-pin')).toBeVisible()
  await expect(panel.getByTestId('rail-collapse')).toBeVisible()
  await panel.getByTestId('rail-collapse').click()
  await expect(page.getByTestId('rail-icon:links')).toBeFocused()

  // Unpinned is this device's override: it survives a reload.
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(rail).toHaveCount(0)
  await page.getByTestId('rail-expand').click()
  await expect(page.getByTestId('dock-panel')).toBeVisible()
})

test('the navigator resizes from the keyboard, collapses by drag, hides on Mod+ArrowLeft, and the layout survives a reload', async ({
  page,
}) => {
  await openApp(page, 'chrome-nav')
  const navigator = page.getByTestId('navigator')
  await expect(navigator).toHaveCSS('width', '288px')

  // The vault's sync pill left the navigator's foot (Round 2, P7): the `sync`
  // readout is the one door to Shared. The vault switcher and settings stay.
  await expect(navigator.getByTestId('sync-pill-global')).toHaveCount(0)
  await expect(navigator.getByTestId('open-settings')).toBeVisible()

  await page.getByTestId('tree-resize').focus()
  await page.keyboard.press('End')
  await expect(navigator).toHaveCSS('width', '640px')
  await page.keyboard.press('ArrowLeft')
  await expect(navigator).toHaveCSS('width', '624px')

  await page.getByTestId('rail-unpin').click()
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCSS('width', '624px')
  await expect(page.getByTestId('right-rail')).toHaveCount(0)
  await expect(page.getByTestId('dock')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+ArrowLeft')
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await page.getByTestId('toggle-tree').click()
  await expect(page.getByTestId('navigator')).toBeVisible()

  // Drag the handle well past the minimum and the navigator CLOSES rather
  // than pinning itself to a 192 px sliver — and reopening restores the
  // width the drag started from (P3).
  await dragTo(page, page.getByTestId('tree-resize'), 40, 300)
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  await page.getByTestId('toggle-tree').click()
  await expect(page.getByTestId('navigator')).toHaveCSS('width', '624px')
})

/**
 * The two halves of "where am I in this vault" (P3): the toolbar stays put
 * while the tree scrolls under it, and whatever you just made is brought into
 * view — Obsidian's reveal-active-file, which is what makes a note created in
 * a folded folder findable at all.
 */
test('the tree scrolls under a sticky toolbar, and a note created in a collapsed folder is revealed', async ({
  page,
}) => {
  // Short viewport + a pile of notes: a tree that genuinely overflows.
  await page.setViewportSize({ width: 1000, height: 420 })
  await openApp(page, 'chrome-sticky')

  for (let i = 1; i <= 12; i++) {
    await page.getByTestId('new-file').click()
    await expect(page.getByTestId(`file-item:untitled-${i}.md`)).toBeAttached()
  }

  const treeRoot = page.getByTestId('tree-root')
  const toBottom = (): Promise<void> =>
    treeRoot.evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
  await expect
    .poll(() => treeRoot.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0)
  await toBottom()
  await expect.poll(() => treeRoot.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  // The TREE scrolled, not the nav — so the toolbar is still on screen.
  expect(await page.getByTestId('file-tree').evaluate((el) => el.scrollTop)).toBe(0)
  await expect(page.getByTestId('new-file')).toBeInViewport()
  await expect(page.getByTestId('tree-filter')).toBeInViewport()

  // Reveal the active file: opening a note from the palette — never touching
  // the tree — scrolls its row back into view from the far end of the list.
  await openByQuickOpen(page, 'welcome')
  const welcome = page.getByTestId('file-item:notes/welcome.md')
  await expect(welcome).toHaveAttribute('aria-current', 'true')
  await expect(welcome).toBeInViewport()

  // Fold `notes` away, then create a note inside it from its own menu: the
  // folder unfolds, the row scrolls back into view from the bottom of the
  // tree, and it is the current note.
  await page.getByTestId('dir-item:notes').click()
  await page.getByTestId('dir-item:notes').click()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'false')
  await toBottom()

  await page.getByTestId('dir-item:notes').click({ button: 'right' })
  await page.getByTestId('tree-menu:new-file').click()
  const created = page.getByTestId('file-item:notes/untitled-1.md')
  await expect(created).toBeAttached()
  await expect(page.getByTestId('dir-item:notes')).toHaveAttribute('aria-expanded', 'true')
  await expect(created).toHaveAttribute('aria-current', 'true')
  await expect(created).toBeInViewport()
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
  // A crumb opens the folder's popover (sharing E6); revealing is one click in it.
  await page.getByTestId('crumb-reveal').click()
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
  await openApp(page, 'chrome-tree', { token: 'chrome-token' })

  // Quiet when good: the open note is green in the status bar and carries no dot in the tree.
  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(page.getByTestId('sync-pill-note')).toHaveAttribute('data-status', 'green', {
    timeout: 15_000,
  })
  await expect(page.getByTestId('sync-pill:notes/welcome.md')).toHaveCount(0)

  // No vault pill in the navigator's foot any more (Round 2, P7).
  await expect(page.getByTestId('navigator').getByTestId('sync-pill-global')).toHaveCount(0)

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
  await runCommand(page, 'shared folder')
  await expect(page.getByTestId('add-share-dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('add-share-dialog')).toHaveCount(0)
})

test('the breadcrumb and the Shared view say where the open note lives (This note dissolved, sharing E6)', async ({
  page,
}) => {
  await openApp(page, 'chrome-note')
  // *This note* is gone from the rail: its facts moved (sharing Fork 6-B).
  await expect(page.getByTestId('rail-icon:note')).toHaveCount(0)

  // The folder crumb's popover: the relay is on the ROOT mount, so this vault
  // is LINKED — "On your devices", never "shared" (device-link N2).
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.getByTestId('crumb:notes').click()
  await expect(page.getByTestId('crumb-share-state')).toContainText('On your devices')
  await page.keyboard.press('Escape')

  // The note's sync readout is the door (Round 2, P5/P7); the linked vault is a device fact.
  await page.getByTestId('sync-pill-note').first().click()
  await expect(page.getByTestId('shared-view')).toBeVisible()
  await expect(page.getByTestId('shared-devices-linked')).toContainText('syncs to your devices')
  await expect(page.locator('header').getByTestId('presence')).toHaveCount(0)

  // Sharing this folder is still offered (device-link-shaping A5, depth 1):
  // the picker lists exactly what the tree menu would let you share.
  await page.getByTestId('shared-view').getByTestId('shared-share').click()
  await expect(page.getByTestId('share-folder-select')).toContainText('notes')
  await page.keyboard.press('Escape')
})

test('a workspace error toasts once, badges the drawer until it is opened, and stays in the Log view with its scope; devtools toggle in Settings', async ({
  page,
}) => {
  // An unseeded room: the relay rejects the token, which is a real error the
  // workspace raises — exactly what used to be one truncated header string.
  await openApp(page, 'chrome-notice')
  await expect(page.getByTestId('toast')).toContainText('The relay refused the link for this folder')
  await expect(page.getByTestId('toast')).toHaveCount(1)

  // The drawer (quiet-shell F13): the bell carries the unread count until opened.
  const bell = page.getByTestId('drawer-bell')
  // Developer tools are off: no inspector door beside it.
  await expect(page.getByTestId('inspector-open')).toHaveCount(0)
  await expect(page.getByTestId('drawer-badge')).toHaveText('1')
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread')
  await bell.click()
  const drawer = page.getByTestId('drawer')
  await expect(drawer).toContainText('The relay refused the link for this folder')
  await expect(page.getByTestId('drawer-badge')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(page.getByTestId('drawer-badge')).toHaveCount(0)

  // *Open the Log* (Round 3 Q1: no count, the badge counts): the Log view
  // (F12) lists it with where it happened.
  await bell.click()
  await expect(drawer.getByTestId('drawer-open-log')).toHaveText('Open the Log')
  await drawer.getByTestId('drawer-open-log').click()
  const log = page.getByTestId('log-view')
  await expect(log).toBeVisible()
  const row = log.locator('[data-testid^="event:"]').first()
  await expect(row).toContainText('The relay refused the link for this folder')
  await expect(row.getByTestId('event-where')).toContainText('room')
  await expect(row.locator('time')).toHaveCount(1)
  // One per pane: opening it again focuses the one already there.
  await bell.click()
  await drawer.getByTestId('drawer-open-log').click()
  await expect(page.getByTestId('log-view')).toHaveCount(1)

  // Filters. The drawer held only problems, so its *Open the Log* opened it
  // on the `problems` argument (round 2, P6): errors and warnings pressed,
  // info not. Errors only keeps it; no level at all → nothing matches.
  await expect(log.getByTestId('log-level:info')).toHaveAttribute('aria-pressed', 'false')
  await expect(log.getByTestId('log-level:warn')).toHaveAttribute('aria-pressed', 'true')
  await log.getByTestId('log-level:warn').click()
  await expect(log.getByTestId('log-level:warn')).toHaveAttribute('aria-pressed', 'false')
  await expect(log.locator('[data-testid^="event:"]').first()).toContainText('The relay refused the link for this folder')
  await log.getByTestId('log-level:error').click()
  await expect(log.getByTestId('log-empty')).toContainText('Nothing matches')
  for (const level of ['error', 'warn', 'info']) await log.getByTestId(`log-level:${level}`).click()

  // Developer tools on (Settings › Developer) → the palette opens the
  // inspector as a regular tab (devtools-shaping D1-A), one per pane.
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:developer').click()
  await page.getByTestId('settings-devtools').check()
  await page.getByTestId('settings-close').click()
  for (let i = 0; i < 2; i++) {
    await runCommand(page, 'Open inspector')
  }
  await expect(page.getByTestId('inspector')).toHaveCount(1)
  // …and its door sits right of the bell (Chris, 2026-10-06): one click, the
  // same one-per-pane tab.
  const door = page.getByTestId('inspector-open')
  await expect(door).toHaveAccessibleName('Open the inspector')
  const bellBox = (await bell.boundingBox())!
  const doorBox = (await door.boundingBox())!
  expect(doorBox.x).toBeGreaterThanOrEqual(bellBox.x + bellBox.width)
  await runCommand(page, 'Open log')
  await door.click()
  await expect(page.getByTestId('inspector')).toHaveCount(1)
  await expect(page.getByTestId('inspector')).toBeVisible()
  await expect(page.getByTestId('inspector-row:notes/welcome.md')).toBeVisible()

  // Clear asks first, then forgets the session's events.
  await runCommand(page, 'Open log')
  await page.getByTestId('log-clear').click()
  await page.getByTestId('log-clear-confirm').getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByTestId('log-empty')).toContainText('Nothing to report')
})

test('settings are tabs: keyboard between them, validated forms with their own Save, and an unsaved-changes guard on close', async ({
  page,
}) => {
  await openApp(page, 'chrome-settings')
  await page.keyboard.press('ControlOrMeta+,')
  const dialog = page.getByTestId('settings-panel')
  await expect(dialog).toBeVisible()
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')

  // Arrow keys move between tabs (vertical list → down). Three steps now:
  // General, Appearance, Hotkeys, Sync (the Hotkeys tab landed with R1.3).
  await page.getByRole('tab', { name: 'General' }).focus()
  await page.keyboard.press('ArrowDown')
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
  // A relay is known now: the card shows it, and Change… opens its address (first-run D1).
  const sync = page.getByTestId('settings-relay-card')
  await expect(sync.getByTestId('relay-card')).toContainText('relay.example.test')
  await sync.getByTestId('relay-change').click()
  await expect(page.getByTestId('settings-relay')).toHaveValue('wss://relay.example.test')
  await page.getByTestId('settings-close').click()
})

test('link a device: the manager refuses a folder link, and the panel reports a failure with a retry', async ({
  page,
}) => {
  // The manager, with no vault remembered — where a NEW device starts.
  await page.goto('/')
  await expect(page.getByTestId('open-link-device')).toBeVisible()
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

  // Back on the manager, which now lists the half-linked vault: its Add menu
  // still offers the device link (first-run B1).
  await page.getByTestId('join-cancel').click()
  await expect(page.getByTestId('manager-add')).toBeVisible()
})

test('settings › sync offers device linking, and asks for the operator secret first', async ({
  page,
}) => {
  await openApp(page, 'chrome-device-link')
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:sync').click()
  const section = page.getByTestId('settings-device-link')
  await expect(section).toContainText('Your devices')

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
  await runCommand(page, 'Link a device')
  await expect(page.getByTestId('device-link-dialog')).toBeVisible()
})

test('the manager reaches Link a device from inside itself, without a trip through Back', async ({
  page,
}) => {
  await openApp(page, 'chrome-manager-link')

  // Into the manager the way a person gets there: the switcher, not a URL.
  await openManager(page)
  await expect(page.getByTestId('manager-back')).toBeVisible()

  // The bug (shell-polish P4): Settings opens from INSIDE the manager, and its
  // "Link a device" set a flag whose dialog was mounted in the workspace
  // branch — so nothing appeared until you pressed Back.
  await page.getByTestId('manager-settings').click()
  await page.getByTestId('settings-tab:sync').click()
  await page.getByTestId('settings-secret').fill('e2e-operator-secret')
  await page.getByTestId('settings-link-device').click()
  await expect(page.getByTestId('device-link-dialog')).toBeVisible()
  await expect(page.getByTestId('create-device-link')).toBeVisible()
  // Still in the manager: the dialog did not wait for the workspace.
  await expect(page.getByTestId('manager-back')).toBeVisible()
  await page.getByTestId('close-device-link').click()
  await expect(page.getByTestId('device-link-dialog')).toHaveCount(0)
})

test('the vault manager welcomes, then lists its vaults with their facts, and removes one in two clicks', async ({
  page,
}) => {
  // A fresh install: the welcome, which asks for no name (first-run A1, Fork 5-A).
  await page.goto(MANAGER_URL)
  await expect(page.getByRole('heading', { name: 'Oh hi.' })).toBeVisible()
  await expect(page.getByTestId('manager-name')).toHaveCount(0)
  await createBrowserVault(page, 'Polish')
  await openManager(page)
  const row = page.locator('[data-testid^="open-vault:"]')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('Polish')
  await expect(row).toContainText('in this browser')
  // The vault open behind the manager is the current one, marked "open now",
  // with what its mount table says (first-run B1).
  await expect(row).toHaveAttribute('aria-current', 'true')
  await expect(row).toContainText('open now')
  await expect(page.locator('[data-testid^="vault-facts:"]')).toContainText('nothing shared')
  await expect(page.getByTestId('manager-identity')).toContainText('see you as Anonymous')

  // Remove is never one click: the row menu arms an inline confirm that says
  // what removal costs, and Cancel leaves the list alone.
  await page.locator('[data-testid^="vault-more:"]').click()
  await page.locator('[data-testid^="remove-vault:"]').click()
  await expect(page.locator('[data-testid^="remove-note:"]')).toContainText('only in this browser')
  await page.locator('[data-testid^="remove-cancel:"]').click()
  await expect(page.locator('[data-testid^="remove-note:"]')).toHaveCount(0)
  await expect(row).toHaveCount(1)

  await page.locator('[data-testid^="vault-more:"]').click()
  await page.locator('[data-testid^="remove-vault:"]').click()
  await page.locator('[data-testid^="remove-confirm:"]').click()
  await expect(row).toHaveCount(0)
  // The last vault gone: the welcome again.
  await expect(page.getByTestId('start-browser-vault')).toBeVisible()
})

test('every chrome surface renders in the interface token: the file tree is Public Sans, code is JetBrains Mono (P9, Q7)', async ({
  page,
}) => {
  await openApp(page, 'chrome-fonts')
  const row = page.getByTestId('file-item:notes/welcome.md')
  await expect(row).toBeVisible()
  const family = (sel: string) =>
    page.evaluate((s) => getComputedStyle(document.querySelector(s)!).fontFamily, sel)
  expect(await row.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"Public Sans"/)
  // Tailwind's preflight families are the tokens too: <html> (whatever does
  // not inherit from <body>) and code, kbd, samp, pre.
  expect(await family('html')).toMatch(/^"Public Sans"/)
  const mono = await page.evaluate(() => {
    const code = document.body.appendChild(document.createElement('code'))
    const f = getComputedStyle(code).fontFamily
    code.remove()
    return f
  })
  expect(mono).toMatch(/^"JetBrains Mono"/)
  // The face is the bundled one, actually loaded — not a fallback with its name.
  expect(await page.evaluate(async () => (await document.fonts.load('14px "Public Sans"')).length)).toBeGreaterThan(0)
})
