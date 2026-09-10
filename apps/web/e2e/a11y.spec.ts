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
import { encodeDeviceLink } from '../src/lib/share-link.js'

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

  await page.getByTestId('manager-settings').click()
  await page.getByTestId('settings-tab:vaults').click()
  await expect(page.getByTestId('settings-storage-status')).toContainText('Not guaranteed')
  await expectAccessible(page, 'settings: storage in this browser')
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
