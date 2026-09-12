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
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openApp, seedReadNote, tabNamed } from './fixtures.js'
import { encodeDeviceLink } from '../src/lib/share-link.js'

const RELAY = 'ws://localhost:8799'

async function expectAccessible(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  const report = results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary?.split('\n').join('\n      ')}`).join('\n')
    )
    .join('\n')
  expect(results.violations, `${surface}\n${report}`).toEqual([])
}

test('the vault manager is accessible', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('open-folder').or(page.getByTestId('create-vault'))).toBeVisible()
  await expectAccessible(page, 'vault manager')
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
  await expect(page.getByTestId('mode-bar')).toBeVisible()
  await expectAccessible(page, 'pane mode bar')
  await page.keyboard.press('Escape')

  // A tab's context menu — the keyboard equivalent of every drag gesture —
  // now carrying W2's group rows.
  await page.locator('[data-slot-kind="tab"]').first().click({ button: 'right' })
  await expect(page.getByTestId('tab-menu')).toBeVisible()
  await expectAccessible(page, 'tab context menu')
  await page.keyboard.press('Escape')
})

test('the tab-group chrome is accessible', async ({ page }) => {
  await openApp(page, 'a11y-groups')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.getByTestId('file-item:notes/ideas.md').click()

  // The manage popover: a text field, a radiogroup of eight swatches and the
  // verb list, all inside one dialog.
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
  // it, and the panel's label still points at something real.
  await expect(page.getByRole('tablist').first()).toBeVisible()
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1)
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

  await page.getByTestId('open-settings').click()
  await expect(page.getByTestId('settings-panel')).toBeVisible()
  await expectAccessible(page, 'settings')
  // Only the open tab's panel is in the DOM, so the tab with the most controls
  // per row (Hotkeys: a field, a toggle and a reset for every command) has to
  // be opened to be scanned at all.
  await page.getByTestId('settings-tab:hotkeys').click()
  await expect(page.getByTestId('settings-hotkeys')).toBeVisible()
  await expectAccessible(page, 'settings hotkeys')
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-panel')).toHaveCount(0)

  await page.getByTestId('rail-collapse').click()
  await expect(page.getByTestId('right-rail')).toHaveAttribute('data-state', 'collapsed')
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

  // …and with both fields refused, so the error wiring is in the DOM too.
  await page.getByTestId('add-share-link').fill('not a link')
  await page.getByTestId('add-share-join').click()
  await expect(page.getByTestId('field-errors:link')).toBeVisible()
  await expectAccessible(page, 'add a shared folder (refused)')
})

test('the owner device-link dialog is accessible', async ({ page }) => {
  await openApp(page, 'a11y-device-link')
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('settings-tab:sync').click()
  // The mint button only exists once the relay operator secret is set.
  await page.getByTestId('settings-secret').fill('e2e-operator-secret')
  await page.getByTestId('settings-link-device').click()
  await expect(page.getByTestId('device-link-dialog')).toBeVisible()
  await expectAccessible(page, 'device link dialog')
})

test('the link-this-device dialog and the join progress panel are accessible', async ({ page }) => {
  // The manager with no vault open — where a NEW device starts.
  await page.goto('/')
  await page.getByTestId('manager-name').fill('Chris')
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
