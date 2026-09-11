/**
 * Accessibility gate (chrome-shaping R1.4): axe over the shell's surfaces as a
 * person reaches them — the vault manager, the workspace with a note open,
 * the palette, a dialog, a menu, settings. Runs against the memory vault
 * contract like v2.spec.ts, so it needs no real folder and no share.
 *
 * A violation fails the run and prints the node and the rule, so the fix is
 * one grep away. Rules are not switched off to make the gate pass — if one
 * must be, it is listed here with the reason and the slice that lifts it.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openApp } from './fixtures.js'

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
