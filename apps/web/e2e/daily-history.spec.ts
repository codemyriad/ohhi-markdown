/**
 * W3's demo, in Playwright: daily notes over Obsidian's `daily-notes.json`,
 * and the History rail section over the pre-image journal that already exists.
 *
 * The memory vault carries no `.obsidian/`, so the daily config is Obsidian's
 * own default — `YYYY-MM-DD` at the vault root. Chris's `DD-M-Y` / `Daily/` is
 * covered by `src/lib/daily-notes.test.ts` against his real filenames; what
 * needs a browser is the wiring: the key creates and opens a note, the walk
 * moves between the ones that exist, and a restore reaches disk and the editor.
 */
import { expect, test } from '@playwright/test'
import { openApp } from './fixtures.js'

/** Today in Obsidian's default format, computed the way the app does. */
function todayName(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

test("Mod+\\ opens today's daily note, creating it once, and Mod+- walks to an older one", async ({
  page,
}) => {
  await openApp(page, 'daily-today')
  const today = `${todayName()}.md`

  await page.keyboard.press('ControlOrMeta+\\')
  await expect(page.getByTestId(`file-item:${today}`)).toBeVisible()
  // The breadcrumb prints a note's name without its extension.
  await expect(page.getByTestId('crumb-note')).toHaveText(todayName())

  // Idempotent: pressing it again opens the same note, never a second one.
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.keyboard.press('ControlOrMeta+\\')
  await expect(page.getByTestId('crumb-note')).toHaveText(todayName())
  await expect(page.getByTestId(`file-item:${today}`)).toHaveCount(1)

  // Give the vault an OLDER daily, through the affordances a person has, and
  // walk back to it: prev/next order by date, not by filename.
  await page.getByTestId('file-tree').click({ button: 'right' })
  await page.getByTestId('tree-menu:new-file').click()
  await expect(page.getByTestId('file-item:untitled-1.md')).toBeVisible()
  await page.getByTestId('file-item:untitled-1.md').click({ button: 'right' })
  await page.getByTestId('tree-menu:rename').click()
  await page.getByTestId('tree-op-name').fill('2020-01-01.md')
  await page.getByTestId('tree-op-confirm').click()
  await expect(page.getByTestId('file-item:2020-01-01.md')).toBeVisible()

  await page.getByTestId(`file-item:${today}`).click()
  await page.keyboard.press('ControlOrMeta+-')
  await expect(page.getByTestId('crumb-note')).toHaveText('2020-01-01')
  // And forward again, from the older note's own date.
  await page.keyboard.press('ControlOrMeta+=')
  await expect(page.getByTestId('crumb-note')).toHaveText(todayName())
})

test('History lists the versions the journal already holds, and restores one', async ({ page }) => {
  await openApp(page, 'daily-history')
  await page.getByTestId('file-item:notes/welcome.md').click()
  const editor = page.locator('[data-testid="editor-pane"] .cm-content')
  await expect(editor).toContainText('Welcome to Editor')

  // Nothing has been written yet, so there is nothing to show — said in words.
  await expect(page.getByTestId('history-empty')).toBeVisible()

  // One edit, one flush, one pre-image: the version this note was before.
  await editor.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('ZEBRACROSSING\n')
  await expect(editor).toContainText('ZEBRACROSSING')

  const rows = page.getByTestId('history-section').getByRole('listitem')
  await expect(rows.first()).toBeVisible({ timeout: 15_000 })

  await rows.first().getByRole('button').click()
  await expect(page.getByTestId('history-confirm')).toBeVisible()
  await page.getByTestId('history-confirm-confirm').click()

  // The restore lands in the editor, because it went through the CRDT.
  await expect(editor).not.toContainText('ZEBRACROSSING')
  await expect(editor).toContainText('Welcome to Editor')
  // And it journaled what it replaced, so the list grew rather than shrank.
  await expect(rows).not.toHaveCount(0)
})
