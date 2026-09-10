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

const RELAY = 'ws://localhost:8799'

async function openApp(page: Page, room: string): Promise<void> {
  const params = new URLSearchParams({
    mode: 'memory',
    role: 'seed',
    relay: RELAY,
    room,
    token: 'e2e-token',
    user: 'Chris',
  })
  await page.goto(`/?${params.toString()}`)
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

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
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('settings-panel')).toHaveCount(0)
})
