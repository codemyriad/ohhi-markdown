/** Screenshot pass — not a gate; run manually to eyeball the themes. */
import { test, type Page } from '@playwright/test'

const OUT = process.env.SHOT_DIR ?? 'test-results/shots'

async function boot(page: Page, room: string): Promise<void> {
  const params = new URLSearchParams({
    mode: 'memory', role: 'seed', relay: 'ws://localhost:8799',
    room, token: 'e2e-token', user: 'Chris',
  })
  await page.goto(`/?${params.toString()}`)
  await page.getByTestId('file-tree').waitFor({ timeout: 15_000 })
  await page.getByTestId('file-item:notes/welcome.md').click()
  const content = page.locator('[data-testid="editor-pane"] .cm-content')
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(
    [
      '# Welcome to Editor',
      '',
      'A **collaborative**, agent-native markdown editor over a *plain* vault.',
      'Files on disk stay canonical; CRDTs handle sync. See [[ideas]] and',
      'the not-yet-written [[Design System]].',
      '',
      '## What V2 adds',
      '',
      '- [ ] quick-open, search, backlinks',
      '- [x] a design system with real tokens',
      '- inline `code` and a #tag',
      '',
      '### Try it',
      '',
      '```ts',
      'const index = new MemoryIndex()',
      "index.rebuild(docs) // 253ms over 1,029 notes",
      '```',
      '',
      '> The pill never lies.',
    ].join('\n')
  )
  await page.waitForTimeout(400)
}

for (const theme of ['editor-dark', 'editor-light', 'nord-dark', 'nord-light']) {
  test(`shot ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await boot(page, `shot-${theme}`)
    await page.getByTestId('open-settings').click()
    await page.getByTestId('settings-tab:appearance').click()
    await page.getByTestId(`theme-${theme}`).click()
    await page.getByTestId('settings-close').click()
    await page.waitForTimeout(250)
    await page.screenshot({ path: `${OUT}/${theme}.png` })
  })
}

test('shot quick-open', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await boot(page, 'shot-qo')
  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab:appearance').click()
  await page.getByTestId('theme-nord-dark').click()
  await page.getByTestId('settings-close').click()
  await page.keyboard.press('ControlOrMeta+o')
  await page.getByTestId('quick-open-input').fill('note')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/quick-open.png` })
})

test('shot search', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await boot(page, 'shot-search')
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await page.getByTestId('search-input').fill('editor')
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${OUT}/search.png` })
})
