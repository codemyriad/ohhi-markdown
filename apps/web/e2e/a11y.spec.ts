/**
 * Accessibility gate (chrome-shaping R1.4): axe over the shell's surfaces as a
 * person reaches them — the vault manager, the workspace with a note open,
 * the palette, a dialog, a menu, settings, and the sharing overlays (join a
 * share, link a device from either side, the join progress panel). Runs
 * against the memory vault contract like v2.spec.ts, so it needs no real
 * folder and no share.
 *
 * Not covered here: `add-link-dialog`. It only opens on a mount whose status
 * is `needs-token`, and nothing in the memory-vault contract can produce one
 * (it is written by the boot pass for a mount this device holds no key for).
 * Its ARIA is pinned by `AddLinkDialog.test.ts`, and it is the same
 * Dialog + Field + TextControl composition axe checks on `add-share-dialog`
 * below. Lift this when a spec can seed a mount without a live peer.
 *
 * A violation fails the run and prints the node and the rule, so the fix is
 * one grep away. Rules are not switched off to make the gate pass — if one
 * must be, it is listed here with the reason and the slice that lifts it.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  MANAGER_URL,
  RELAY,
  appUrl,
  closeSettings,
  createBrowserVault,
  expectAccessible,
  openApp,
  openManager,
  openSettings,
  paneContent,
  runCommand,
  seedProvider,
  seedReadNote,
  selectLine,
  settingsView,
  tabNamed,
  test as withMockLlm,
} from './fixtures.js'
import { encodeDeviceLink, encodeShareLink } from '../src/lib/share-link.js'

test('the default layout (no columns) is accessible', async ({ page }) => {
  // Every other scan boots `dense` (fixtures.ts); this is the shell a new
  // install sees until Stage 2 gives it a toolbar of its own.
  await page.goto(appUrl({ room: 'a11y-default-layout', layout: null }))
  await expect(page.getByTestId('toggle-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('navigator')).toHaveCount(0)
  // The unseeded room's relay-refusal toast is part of what a new install
  // sees, so it is scanned with the shell rather than closed first.
  await expect(page.getByTestId('toast').first()).toBeVisible()
  await expectAccessible(page, 'default layout')
})

test('the vault manager is accessible', async ({ page }) => {
  await page.goto(MANAGER_URL)
  // The welcome (first-run A1), with the browser door asking for its name.
  await expect(page.getByTestId('open-folder').or(page.getByTestId('start-browser-vault'))).toBeVisible()
  await expectAccessible(page, 'vault manager (welcome)')
  await page.getByTestId('start-browser-vault').click()
  await expect(page.getByTestId('new-vault-name')).toBeVisible()
  await expectAccessible(page, 'vault manager (welcome, naming a browser vault)')

  // The Import door (first-run F1), from the welcome's foot.
  await page.getByTestId('open-import').click()
  await expect(page.getByTestId('import-dialog')).toBeVisible()
  await expectAccessible(page, 'import dialog')
  await page.getByTestId('import-close').click()
  await expect(page.getByTestId('import-dialog')).toHaveCount(0)

  // The list with a vault in it (first-run B1).
  await createBrowserVault(page, 'A11y')
  await openManager(page)
  await expect(page.locator('[data-testid^="open-vault:"]')).toHaveCount(1)
  await expectAccessible(page, 'vault manager (list)')

  // The Add menu, and the dialog its browser entry opens.
  await page.getByTestId('manager-add').click()
  await expect(page.getByTestId('manager-add-menu')).toBeVisible()
  await expectAccessible(page, 'vault manager add menu')
  await page.getByTestId('add-browser-vault').click()
  await expect(page.getByTestId('new-vault-dialog')).toBeVisible()
  await expectAccessible(page, 'new browser vault dialog')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('new-vault-dialog')).toHaveCount(0)

  // The row's menu, its Rename dialog, and the inline confirm it arms.
  await page.locator('[data-testid^="vault-more:"]').click()
  await page.locator('[data-testid^="rename-vault:"]').click()
  await expect(page.getByTestId('rename-vault-dialog')).toBeVisible()
  await expectAccessible(page, 'rename vault dialog')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('rename-vault-dialog')).toHaveCount(0)
  await page.locator('[data-testid^="vault-more:"]').click()
  await expect(page.locator('[data-testid^="vault-menu:"]')).toBeVisible()
  await expectAccessible(page, 'vault row menu')
  await page.locator('[data-testid^="remove-vault:"]').click()
  await expect(page.locator('[data-testid^="remove-note:"]')).toBeVisible()
  await expectAccessible(page, 'vault remove confirm')
})

test('the workspace with a note open is accessible', async ({ page }) => {
  await openApp(page, 'a11y-workspace')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(page.locator('[data-testid="editor-pane"] .cm-content')).toBeVisible()
  await expectAccessible(page, 'workspace')

  // The pane tree (tab-groups W1): two panes, two tab strips, two status
  // bars, a separator between them — and a second tab, so the strip is
  // scanned with a roving tab stop rather than a single tab.
  await page.getByTestId('file-item:notes/ideas.md').click()
  await page.keyboard.press('Alt+=')
  await expect(page.locator('[data-pane-id]')).toHaveCount(2)
  await expectAccessible(page, 'pane tree')

  // The mode bar, docked while a mode is live.
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByTestId('mode-cue')).toBeVisible()
  await expectAccessible(page, 'pane mode cue')
  // `?`: every key of the mode, in the corner (E6).
  await page.keyboard.press('?')
  await expect(page.getByTestId('mode-cue-all')).toBeVisible()
  await expectAccessible(page, 'pane mode cue, every key')
  await page.keyboard.press('Escape')

  // A tab's context menu — the keyboard equivalent of every drag gesture —
  // now carrying W2's group rows.
  await page.locator('[data-slot-kind="tab"]').first().click({ button: 'right' })
  await expect(page.getByTestId('tab-menu')).toBeVisible()
  await expectAccessible(page, 'tab context menu')
  await page.keyboard.press('Escape')

  // The drawer (quiet-shell F13): the bell's popover, empty or not.
  await page.getByTestId('drawer-bell').click()
  await expect(page.getByTestId('drawer')).toBeVisible()
  await expectAccessible(page, 'notification drawer')
  // The Log view (F12): level chips, the scope picker, time chips, the rows.
  await page.getByTestId('drawer-open-log').click()
  await expect(page.getByTestId('log-view')).toBeVisible()
  await expectAccessible(page, 'log view')

  // The inspector tab (devtools-shaping D): a table, two filters, a scope nav.
  await openSettings(page, 'developer')
  await page.getByTestId('settings-devtools').check()
  await closeSettings(page)
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Open inspector')
  await page.getByTestId('command-palette-row').first().click()
  await expect(page.getByTestId('inspector-row:notes/welcome.md')).toBeVisible()
  await expectAccessible(page, 'inspector')
})

test('the tab-group chrome is accessible', async ({ page }) => {
  await openApp(page, 'a11y-groups')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.getByTestId('file-item:notes/ideas.md').click()

  // The manage popover: a text field, a radiogroup of eight swatches and the
  // verb list, in an anchored, NON-modal `role="dialog"` (P1.3) — so the page
  // behind it is scanned at the same time, trigger anchor included.
  await page.locator('[data-slot-kind="tab"]').first().click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await expect(page.getByTestId('group-manage')).toBeVisible()
  await page.getByTestId('group-name').fill('Edible')
  await expectAccessible(page, 'manage group popover')
  await page.keyboard.press('Escape')

  // The strip with a chip in it. A `tablist` may own nothing but tabs, so the
  // chip is a sibling of its group's tablist — this is the scan that says so.
  await expect(page.locator('[data-testid^="group-chip:"]')).toHaveCount(1)
  await expectAccessible(page, 'strip with a group chip')

  // A folded chip carries a count, which has to read as more than a number.
  await page.locator('[data-testid^="group-chip:"]').click()
  await expectAccessible(page, 'folded group chip')
  await page.locator('[data-testid^="group-chip:"]').click()

  // The strip-end list, with an open group ticked and the two make-a-group rows.
  await page.locator('[data-testid^="tab-more:"]').first().click()
  await expect(page.getByTestId('groups-menu:show-all')).toBeVisible()
  await expectAccessible(page, 'strip groups menu')

  // …and the dialog behind Show all.
  await page.getByTestId('groups-menu:show-all').click()
  await expect(page.getByTestId('groups-all')).toBeVisible()
  await expectAccessible(page, 'show all groups')
  await page.keyboard.press('Escape')

  // The popover again with somewhere to send the group: its *Move to pane*
  // section (the keyboard equivalent of a chip drag, R8) only exists when
  // there is a second pane.
  await page.keyboard.press('Alt+=')
  await expect(page.locator('[data-pane-id]')).toHaveCount(2)
  await page.locator('[data-testid^="group-chip:"]').first().click({ button: 'right' })
  await expect(page.getByTestId('group-manage')).toBeVisible()
  await expect(page.locator('[data-testid^="group-move:"]')).toHaveCount(1)
  await expectAccessible(page, 'manage group popover with a second pane')
  await page.keyboard.press('Escape')
})

/**
 * Two groups, both folded (R1 finding C2). This is the strip that used to
 * render two chips and zero tabs: no `role="tablist"` at all, nothing with
 * `tabindex="0"` for the roving focus (R8), and a `tabpanel` labelled by a
 * tab that was not in the document (`aria-valid-attr-value`). The invariant
 * is that the active tab is always on screen, so folding the last visible run
 * opens an empty tab — and the scan is what says the markup follows.
 */
test('a strip of nothing but folded groups is accessible', async ({ page }) => {
  await openApp(page, 'a11y-folds')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.getByTestId('file-item:notes/ideas.md').click()

  // One group per note, so folding both leaves the strip with only chips on it.
  // By NAME, not by position: grouping a tab moves it, and `.last()` twice
  // would make the same tab two groups and empty the first one.
  for (const [note, name] of [
    ['welcome', 'Welcome'],
    ['ideas', 'Ideas'],
  ]) {
    await tabNamed(page, note).click({ button: 'right' })
    await page.getByTestId('tab-menu:new-group').click()
    await expect(page.getByTestId('group-manage')).toBeVisible()
    await page.getByTestId('group-name').fill(name)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('group-manage')).toHaveCount(0)
  }
  await expect(page.locator('[data-testid^="group-chip:"]')).toHaveCount(2)

  const chips = page.locator('[data-testid^="group-chip:"]')
  await chips.nth(1).click()
  await chips.nth(0).click()
  await expect(page.locator('[data-folded="true"]')).toHaveCount(2)

  // Whatever the folds did, the strip still has a tablist with a tab stop in
  // it, and the panel's label still points at something real. (The editor
  // area's: the rail's own tab row has its own selected tab.)
  const area = page.getByTestId('editor-area')
  await expect(area.getByRole('tablist').first()).toBeVisible()
  await expect(area.getByRole('tab', { selected: true })).toHaveCount(1)
  await expectAccessible(page, 'strip of folded groups')
})

/**
 * The History rail section (W3, Minor 10). It is the one rail surface with a
 * LIST of controls in it — a Restore per version — and it only has anything to
 * scan once the journal holds a version, so the edit below is the setup, not
 * the subject.
 */
test('the History rail section and its restore confirm are accessible', async ({ page }) => {
  await openApp(page, 'a11y-history')
  // The rail opens on Links; its History tab puts the panel's tab row under axe.
  await page.getByTestId('rail-tab:history').click()
  await expectAccessible(page, 'expanded rail')
  await page.getByTestId('file-item:notes/welcome.md').click()
  const editor = page.locator('[data-testid="editor-pane"] .cm-content')
  await expect(editor).toContainText('Welcome to Editor')

  // Nothing written yet: the empty state is a surface too, and it is the one
  // a person meets first.
  await expect(page.getByTestId('history-empty')).toBeVisible()
  await expectAccessible(page, 'history (empty)')

  // One edit, one flush, one version — and a list with a row in it.
  await editor.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('AXECHECK\n')
  const rows = page.getByTestId('history-section').getByRole('listitem')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })
  await expectAccessible(page, 'history (listed)')

  // The confirm, which is where the consequence is explained.
  await rows.first().getByRole('button').click()
  await expect(page.getByTestId('history-confirm')).toBeVisible()
  await expectAccessible(page, 'history restore confirm')
  await page.keyboard.press('Escape')
})

/**
 * The Read surfaces (X1–X4). The Live surface is the one place in the app
 * where controls are rendered by CodeMirror rather than by Svelte — a
 * checkbox per task, a chip per tag, a placeholder per missing embed — so it
 * is the one place the primitives cannot carry the ARIA for us. Reading is
 * scanned too: `contenteditable=false` changes what a screen reader is
 * offered, and the mode menu is a `menuitemradio` group, which is only honest
 * if what is in force is announced rather than merely coloured.
 */
test('the Live surface, a Reading tab and the mode menu are accessible', async ({ page }) => {
  await seedReadNote(page, 'a11y-read')
  await expect(page.locator('input.cm-task')).toHaveCount(2)
  await expectAccessible(page, 'live preview')

  // The status bar's mode menu, open, with one row checked.
  await page.getByTestId('mode-menu').click()
  await expect(page.getByTestId('mode-menu-list')).toBeVisible()
  await expectAccessible(page, 'view mode menu')
  await page.keyboard.press('Escape')

  // Reading: same document, no editable surface, and a tab that says so.
  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.locator('[data-testid="editor-pane"] .cm-content[contenteditable="true"]')).toHaveCount(0)
  await expectAccessible(page, 'reading view')
})

test('the palette, a dialog, a menu and settings are accessible', async ({ page }) => {
  await openApp(page, 'a11y-overlays')

  await page.keyboard.press('ControlOrMeta+o')
  await expect(page.getByTestId('quick-open-input')).toBeVisible()
  await expectAccessible(page, 'quick-open')
  await page.keyboard.press('Escape')

  await page.getByTestId('file-item:notes/ideas.md').click({ button: 'right' })
  await expect(page.getByTestId('tree-context-menu')).toBeVisible()
  await expectAccessible(page, 'tree context menu')
  await page.getByTestId('tree-menu:rename').click()
  await expect(page.getByTestId('tree-op-dialog')).toBeVisible()
  await expectAccessible(page, 'rename dialog')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tree-op-dialog')).toHaveCount(0)

  await page.getByTestId('vault-switcher').click()
  await expect(page.getByTestId('vault-menu')).toBeVisible()
  await expectAccessible(page, 'vault menu')
  await page.keyboard.press('Escape')

  // Settings is a view tab (settings-shaping ST1). Only the open section is
  // in the DOM, so every section is opened to be scanned — Keys above all
  // (a chip, a remove and an add for every command).
  await page.getByTestId('open-settings').click()
  await expect(settingsView(page)).toBeVisible()
  await expectAccessible(page, 'settings view')
  for (const section of ['editor', 'layout', 'appearance', 'keys', 'sync', 'customise', 'agents', 'developer', 'about']) {
    await settingsView(page).getByTestId(`settings-tab:${section}`).click()
    await expect(page.getByTestId(`settings-section:${section}`)).toBeVisible()
    await expectAccessible(page, `settings ${section}`)
  }
  await closeSettings(page)

  // Unpinned, the column is gone: the floating strip is the dock (a pinned
  // column has no collapse — Chris, 2026-10-06). The strip is drawn over a
  // note only (devtools-shaping D7), so one is open.
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.getByTestId('rail-unpin').click()
  await expect(page.getByTestId('right-rail')).toHaveCount(0)
  await expect(page.getByTestId('dock')).toBeVisible()
  await expectAccessible(page, 'collapsed rail')
})

/**
 * The sharing overlays (device-link N1–N3). Each is a place a person is asked
 * to paste a credential or is made to wait, which is exactly where an
 * unlabelled field or an unannounced error costs the most.
 */
test('the join-a-share dialog is accessible', async ({ page }) => {
  await openApp(page, 'a11y-add-share')

  // The command palette reaches it from anywhere (chrome U3).
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('shared folder')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('add-share-dialog')).toBeVisible()
  await expectAccessible(page, 'add a shared folder')

  // A valid link pasted: the dialog says what it is and probes the relay.
  await page.getByTestId('add-share-link').fill(encodeShareLink({ relay: RELAY, room: 'join-page', token: 'join-token', label: 'team/notes', from: 'Sam' }))
  await expect(page.getByTestId('add-share-about')).toBeVisible()
  await expect(page.getByTestId('add-share-probe')).not.toHaveAttribute('data-check', 'pending', { timeout: 10_000 })
  await expectAccessible(page, 'add a shared folder (valid link)')

  // …and with both fields refused, so the error wiring is in the DOM too.
  await page.getByTestId('add-share-link').fill('not a link')
  await page.getByTestId('add-share-join').click()
  await expect(page.getByTestId('field-errors:link')).toBeVisible()
  await expectAccessible(page, 'add a shared folder (refused)')
})

/**
 * The join page (first-run C2): a full-screen surface, not a dialog, reached
 * from a `/join#editor1:…` link in a browser — scanned with the relay line
 * answered, after a copy, and in its error state.
 */
test('the join page is accessible', async ({ page }) => {
  const payload = encodeShareLink({ relay: RELAY, room: 'a11y-join', token: 'nope', label: 'team/notes', from: 'Sam' })
  await page.goto(`/join#${payload}`)
  await expect(page.getByTestId('join-relay')).not.toHaveAttribute('data-check', 'pending', { timeout: 10_000 })
  await expectAccessible(page, 'join page')

  await page.getByTestId('join-copy').click()
  await expect(page.getByTestId('join-copied').or(page.getByTestId('join-copy-failed'))).toBeVisible()
  await expectAccessible(page, 'join page (copied)')

  // about:blank first: /join#a → /join#b alone is a fragment change, not a load.
  await page.goto('about:blank')
  await page.goto('/join#editor1:damaged')
  await expect(page.getByTestId('join-error')).toBeVisible()
  await expectAccessible(page, 'join page (damaged link)')

  // A device link: the page says what it is and routes it to *Link this device*.
  await page.goto('about:blank')
  await page.goto(`/join#${encodeDeviceLink({ relay: RELAY, room: 'a11y-join-device', token: 'nope', label: 'Work', from: 'Sam' })}`)
  await expect(page.getByTestId('join-device-body')).toBeVisible()
  await expect(page.getByTestId('join-relay')).not.toHaveAttribute('data-check', 'pending', { timeout: 10_000 })
  await expectAccessible(page, 'join page (device link)')
})

/**
 * The share sheet's first run (sharing E4): with no team's secret yet, the
 * relay is met inline — two more fields and a refusal, in a dialog that also
 * carries the honesty paragraph — and then the share done block, after a real
 * first share (the e2e relay runs with `e2e-operator-secret`).
 */
test('the share sheet, first run, is accessible', async ({ page }) => {
  await openApp(page, 'a11y-share-sheet')
  await page.getByTestId('file-item:notes/welcome.md').click()

  // The palette opens it on the open note's folder.
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('share this folder')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('folder-share-dialog')).toBeVisible()
  await expect(page.getByTestId('share-where')).toBeVisible()
  await expect(page.getByTestId('share-honesty')).toContainText('Links, not people')
  await expectAccessible(page, 'share sheet (first run)')

  // First-run D1/D2: this build knows no relay, so the card says none and the
  // address field is open; typed, the card probes it. A wrong team's secret is
  // checked and refused, and Share stays disabled, with the reason, until a
  // secret works.
  await expect(page.getByTestId('relay-card')).toHaveAttribute('data-state', 'none')
  await page.getByTestId('share-relay').fill(RELAY)
  await expect(page.getByTestId('relay-card')).toHaveAttribute('data-state', 'reachable', { timeout: 10_000 })
  await page.getByTestId('share-secret').fill('not-the-secret')
  await expect(page.getByTestId('share-secret-check')).toContainText('doesn’t match this relay', { timeout: 10_000 })
  await expect(page.getByTestId('confirm-share-folder')).toBeDisabled()
  await expect(page.getByTestId('share-waits')).toBeVisible()
  await page.getByText('Where do I get this?').click()
  await expect(page.getByTestId('share-secret-where-body')).toBeVisible()
  await expectAccessible(page, 'share sheet (secret checked)')

  // The right secret works; Share enables and makes the first link.
  await page.getByTestId('share-secret').fill('e2e-operator-secret')
  await expect(page.getByTestId('share-secret-check')).toContainText('works', { timeout: 10_000 })
  await expect(page.getByTestId('confirm-share-folder')).toBeEnabled()
  await expect(page.getByTestId('share-waits')).toHaveCount(0)
  await page.getByTestId('confirm-share-folder').click()
  await expect(page.getByTestId('share-done')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('share-done-link')).toBeVisible()
  await expect(page.getByTestId('share-done-copy-message')).toBeVisible()
  await expectAccessible(page, 'share sheet (shared)')
})

test('the owner device-link dialog is accessible', async ({ page }) => {
  await openApp(page, 'a11y-device-link')
  await openSettings(page, 'sync')
  // Settings › Sync alone, its relay card drawn, before any dialog on top.
  await expect(page.getByTestId('settings-relay-card').getByTestId('relay-card')).toBeVisible()
  await expectAccessible(page, 'settings sync')
  // The mint button only exists once the team's secret is set.
  await page.getByTestId('settings-secret').fill('e2e-operator-secret')
  await page.getByTestId('settings-link-device').click()
  await expect(page.getByTestId('device-link-dialog')).toBeVisible()
  await expectAccessible(page, 'device link dialog')
})

/**
 * The browser-storage note and its Settings section, in a browser that refuses
 * persistence — the state with the most on screen (note, refusal, retry,
 * reminder).
 */
test('the browser-storage note and its Settings section are accessible', async ({ page }) => {
  await page.addInitScript(() => {
    const refuse = async (): Promise<boolean> => false
    Object.defineProperty(navigator.storage, 'persisted', { value: refuse })
    Object.defineProperty(navigator.storage, 'persist', { value: refuse })
  })
  await page.goto('/')
  await expect(page.getByTestId('storage-note')).toBeVisible()
  await expectAccessible(page, 'storage note')

  await page.getByTestId('storage-keep').click()
  await expect(page.getByTestId('storage-note-outcome')).toContainText('The browser said no')
  await expectAccessible(page, 'storage note (refused)')

  // Settings as the manager's page (settings-shaping ST1): every section,
  // the ones needing a vault saying so; storage sits in Sync & devices.
  await page.getByTestId('manager-settings').click()
  await expect(page.getByTestId('settings-page')).toBeVisible()
  await expectAccessible(page, 'settings page (no vault)')
  await page.getByTestId('settings-tab:sync').click()
  await expect(page.getByTestId('settings-storage-status')).toContainText('Not guaranteed')
  await expectAccessible(page, 'settings: storage in this browser')
  for (const section of ['editor', 'layout', 'appearance', 'keys', 'customise', 'agents', 'developer', 'about']) {
    await page.getByTestId(`settings-tab:${section}`).click()
    await expect(page.getByTestId(`settings-section:${section}`)).toBeVisible()
    await expectAccessible(page, `settings page ${section}`)
  }
  await expect(page.getByTestId('settings-needs-vault:keys')).toHaveCount(0)
  await page.getByTestId('settings-tab:keys').click()
  await expect(page.getByTestId('settings-needs-vault:keys')).toBeVisible()
})

test('the link-this-device dialog and the join progress panel are accessible', async ({ page }) => {
  // The manager with no vault open — where a NEW device starts.
  await page.goto('/')
  await page.getByTestId('open-link-device').click()
  await expect(page.getByTestId('link-device-dialog')).toBeVisible()
  await expectAccessible(page, 'link this device')

  // A device link for a room the relay does not know: the progress panel
  // comes up and settles into its failure state, which is the state with the
  // most to announce (an alert, a retry) — and it needs no live pull.
  await page
    .getByTestId('link-device-input')
    .fill(encodeDeviceLink({ relay: RELAY, room: 'a11y-unknown-room', token: 'nope' }))
  await page.getByTestId('link-device-submit').click()
  await expect(page.getByTestId('join-progress')).toBeVisible()
  await expectAccessible(page, 'join progress')
  await expect(page.getByTestId('join-error')).toBeVisible({ timeout: 20_000 })
  await expectAccessible(page, 'join progress (failed)')
})

test('the Help menu and the Report a problem dialog are accessible', async ({ page }) => {
  // First-run E1/E3: the default layout's toolbar ends with Help.
  await page.goto(appUrl({ room: 'a11y-help', layout: null }))
  await expect(page.getByTestId('help-menu')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('help-menu').click()
  await expect(page.getByTestId('help-menu-list')).toBeVisible()
  await expect(page.getByTestId('help-version')).toContainText('Version')
  await expectAccessible(page, 'help menu')

  await page.getByTestId('help:report').click()
  await expect(page.getByTestId('report-dialog')).toBeVisible()
  await expect(page.getByTestId('report-never')).toHaveText('Note contents are never included.')
  await page.getByTestId('report-what').fill('The pill stayed yellow')
  await expectAccessible(page, 'report a problem')
  await page.getByTestId('report-cancel').click()
  await expect(page.getByTestId('report-dialog')).toHaveCount(0)
})

/**
 * The writing harness's surfaces: Settings
 * › AI with both sub-tabs, a Session view with a message and a tool card in
 * it, and an open comment bubble with *Send to agent* — a provider exists
 * (the mock LLM), so every AI-gated control is on screen.
 */
withMockLlm('the writing harness — Settings › AI, a session, the comment bubble — is accessible', async ({ page, mockLlm }) => {
  const mock = await mockLlm([
    { toolCall: { name: 'ohhi_search', args: { query: 'relay', limit: 5 } } },
    { text: 'The **welcome** note says edits sync through the relay.' },
  ])
  await seedProvider(page, `${mock.url}/v1`)
  await openApp(page, 'a11y-harness')

  await openSettings(page, 'ai')
  await expect(page.getByTestId('ai-providers')).toBeVisible()
  await expectAccessible(page, 'settings › AI › providers')
  await page.getByTestId('ai-settings-tab:skills').click()
  await expect(page.getByTestId('ai-skills')).toBeVisible()
  await expectAccessible(page, 'settings › AI › skills')
  await closeSettings(page)

  await page.getByTestId('file-item:notes/welcome.md').click()
  await selectLine(page, 'CRDT and syncs through the relay')
  await page.keyboard.press('ControlOrMeta+Shift+m')
  await expect(page.getByTestId('comment-send-agent')).toBeVisible()
  await expectAccessible(page, 'comment bubble')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('comment-bubble')).toHaveCount(0)

  await paneContent(page).click()
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Open AI session')
  await expect(page.locator('[data-testid="command-palette-row"][data-row-id="app.session"]')).toBeVisible()
  await page.keyboard.press('Enter')
  const input = page.getByTestId('session-composer-input')
  await input.click()
  await page.keyboard.type('Where does sync happen?')
  await page.getByTestId('session-send').click()
  await expect(page.getByTestId('session-run-status')).toHaveAttribute('data-status', 'successful', { timeout: 15_000 })
  await expect(page.getByTestId('tool-card')).toHaveAttribute('data-state', 'output-available')
  await expectAccessible(page, 'session view with a message')
})

/**
 * The rest of the writing harness's surfaces, each scanned where a person
 * meets it: the skill import dialog, the `ai.run-skill` picker, the dock's
 * Comments tab, the session menu, the composer's open `@` listbox, a note
 * with a pending suggestion in it, and the `last-agent-write` readout once
 * that suggestion is accepted.
 */
withMockLlm('the writing harness — dialogs, menus, a suggestion, the Comments tab, the readout — is accessible', async ({ page, mockLlm }) => {
  const NOTE = 'notes/welcome.md'
  const OLD = 'the pill goes offline honestly'
  const mock = await mockLlm([
    { toolCall: { name: 'ohhi_patch', args: { path: NOTE, old: OLD, new: 'the pill goes offline, honestly' } } },
    { text: 'Proposed a comma.' },
  ])
  // The readout in the status bar (a device override, as Settings › Layout writes).
  await seedProvider(page, `${mock.url}/v1`, {
    layout: { overrides: { bars: { statusbar: ['pane.lead', '|', 'words', 'last-agent-write', 'sync'] } } },
  })
  await openApp(page, 'a11y-harness-more')

  // Settings › AI › Skills: the import dialog, then a skill of our own for the picker.
  await openSettings(page, 'ai')
  await page.getByTestId('ai-settings-tab:skills').click()
  await page.getByTestId('ai-skills-import').click()
  await expect(page.getByTestId('skill-import-dialog')).toBeVisible()
  await expectAccessible(page, 'skill import dialog')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('skill-import-dialog')).toHaveCount(0)
  await page.getByTestId('ai-skills-new').click()
  await page.getByTestId('ai-skills-create-name').fill('tighten')
  await page.getByTestId('ai-skills-create-submit').click()
  // The new SKILL.md opens in the pane, over the Settings tab (a view tab
  // since settings-shaping ST1); back in Settings › AI › Skills it is trusted.
  await expect(settingsView(page)).toBeHidden()
  await openSettings(page, 'ai')
  await page.getByTestId('ai-settings-tab:skills').click()
  await expect(page.getByTestId('ai-skill-trust:tighten')).toHaveAttribute('data-trusted', 'true')
  await closeSettings(page)

  // The skill picker, over a selection (the template takes one).
  await page.getByTestId(`file-item:${NOTE}`).click()
  await selectLine(page, 'CRDT and syncs through the relay')
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Run a skill')
  await expect(page.locator('[data-testid="command-palette-row"][data-row-id="ai.run-skill"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('skill-picker')).toBeVisible()
  await expectAccessible(page, 'skill picker')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('skill-picker')).toHaveCount(0)

  // The dock's Comments tab, on the open note.
  await page.getByTestId('rail-tab:comments').click()
  await expect(page.getByTestId('thread-list')).toBeVisible()
  await expectAccessible(page, 'comments dock tab')

  // A session: its menu, and the composer's `@` listbox open.
  await paneContent(page).click()
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Open AI session')
  await expect(page.locator('[data-testid="command-palette-row"][data-row-id="app.session"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await page.getByTestId('session-menu-trigger').click()
  await expect(page.getByTestId('session-new')).toBeVisible()
  await expectAccessible(page, 'session menu')
  await page.keyboard.press('Escape')
  const input = page.getByTestId('session-composer-input')
  await input.click()
  await page.keyboard.type('@wel')
  await expect(page.getByTestId('mention-menu')).toBeVisible()
  await expectAccessible(page, 'mention listbox')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mention-menu')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Add a comma before honestly.')
  await page.getByTestId('session-send').click()

  // The proposal, pending in the note.
  const card = page.locator('[data-testid="tool-card"][data-tool="ohhi_patch"]')
  await expect(card).toHaveAttribute('data-state', 'output-available', { timeout: 15_000 })
  await card.getByTestId('tool-open').click()
  const added = page.locator('[data-testid="editor-pane"] .ed-suggest-add')
  await expect(added.first()).toBeVisible()
  await expectAccessible(page, 'note with a pending suggestion')

  // Accepted: the readout names the agent's edit.
  await paneContent(page).evaluate((el, text) => {
    type View = { state: { doc: { toString(): string } }; dispatch(tr: unknown): void; focus(): void }
    const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view
    if (!view) throw new Error('no CodeMirror view')
    view.dispatch({ selection: { anchor: view.state.doc.toString().indexOf(text) + text.length } })
    view.focus()
  }, 'the pill goes offline')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(added).toHaveCount(0)
  await expect(page.getByTestId('last-agent-write')).toBeVisible()
  await expectAccessible(page, 'last-agent-write readout')
})

test('a collection tab is accessible', async ({ page }) => {
  // A collection over the vault root, created the way a person creates one
  // (bases-shaping DB2): every note is a row, the one table view is open.
  // The welcome note gets a property first, so the table has a cell to edit.
  await seedReadNote(page, 'a11y-collection', '---\nstatus: draft\n---\n\n# Welcome\n')
  await runCommand(page, 'New collection')
  await expect(page.getByTestId('collection-view')).toBeVisible()
  await expect(page.getByTestId('collection-table')).toBeVisible()
  await expectAccessible(page, 'collection tab')

  // The columns popover: a checkbox list anchored to its button. Adding a
  // column writes the view's node in the file; the table follows.
  await page.getByTestId('collection-columns').click()
  await expect(page.getByTestId('collection-columns-popover')).toBeVisible()
  await expectAccessible(page, 'collection columns popover')
  await page.getByTestId('collection-column:status').check()
  await expect(page.getByTestId('collection-header:status')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('collection-columns-popover')).toHaveCount(0)

  // A cell in edit: the text field with its suggestions.
  await page.locator('[data-testid^="collection-cell:"][data-testid$=":status"]').first().click()
  await expect(page.locator('[data-testid$=":status:input"]')).toBeVisible()
  await expectAccessible(page, 'collection cell editor')
  await page.keyboard.press('Escape')

  // A board view (DB3): added from the menu, grouped by the first property,
  // every card with its keyboard "Move to…".
  await page.getByTestId('collection-add-view').click()
  await page.getByTestId('collection-add-view:kanban').click()
  await expect(page.getByTestId('collection-board')).toBeVisible()
  await expectAccessible(page, 'collection board')
  await page.getByTestId('collection-add-view').click()
  await page.getByTestId('collection-add-view:list').click()
  await expect(page.getByTestId('collection-list')).toBeVisible()
  await expectAccessible(page, 'collection list')

  // A row-note (DB4, Fork 3-B): the collection over the root claims every
  // note, so the welcome note's frontmatter is the properties form — one
  // row, `status`, with the table's own text editor — and a key is a door
  // into the YAML, where the form gives way to the text (R4.1.1).
  await page.getByTestId('file-item:notes/welcome.md').click()
  await expect(page.getByTestId('properties-form')).toBeVisible()
  await expectAccessible(page, 'properties form')
  await page.getByTestId('property:status').click()
  await expect(page.getByTestId('property:status:input')).toBeVisible()
  await expectAccessible(page, 'properties form cell editor')
  await page.keyboard.press('Escape')
  await page.getByTestId('property-key:status').click()
  await expect(page.getByTestId('properties-form')).toHaveCount(0)
  await expect(paneContent(page).locator('.cm-live-frontmatter')).toHaveCount(3)

  // An embedded collection (A6): `![[Collection.base]]` on a line of its own
  // draws the collection's first view inside the note, cells and all, with
  // no view controls; the caret off its line, so the line is the widget.
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\n\n![[Collection.base]]\n')
  await expect(page.getByTestId('collection-embed')).toBeVisible()
  await expect(page.getByTestId('collection-embed').getByTestId('collection-table')).toBeVisible()
  await expect(page.getByTestId('collection-embed').getByTestId('collection-new')).toHaveCount(0)
  await expectAccessible(page, 'collection embed')
})
