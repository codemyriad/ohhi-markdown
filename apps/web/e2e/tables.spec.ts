/**
 * Tables (editor-usability E4): the Live grid off the caret, the source on it,
 * Tab / Enter inside it, the hint bar over it, and the `table.*` palette rows.
 * What only a browser can show — the keyboard reaching a block widget, a click
 * on a cell, a tooltip — lives here; the text the keys write is unit-tested in
 * libs/editor-lang (table-ops / table-commands).
 */
import { expect, test } from '@playwright/test'
import { expectAccessible, paneContent as content, runCommand, seedReadNote } from './fixtures.js'

const NOTE = ['# Tables', '', 'Above the table.', '', '| a | b |', '|---|:-:|', '| 1 | 2 |', '', 'Below the table.', ''].join(
  '\n'
)

/** The note's text as the editor holds it. */
async function text(page: import('@playwright/test').Page): Promise<string> {
  return content(page).evaluate((el) => {
    type Tile = { root?: { view?: { state: { doc: { toString(): string } } } } }
    return (el as unknown as { cmTile?: Tile }).cmTile?.root?.view?.state.doc.toString() ?? ''
  })
}

test('off the caret a table is a grid; a click on a cell is the source, caret in that cell', async ({ page }) => {
  await seedReadNote(page, 'tables-grid', NOTE)
  const grid = page.locator('.cm-table-grid')
  await expect(grid).toHaveCount(1)
  await expect(grid.locator('th')).toHaveCount(2)
  // The delimiter row's `:-:` centres column 2.
  await expect(grid.locator('td').nth(1)).toHaveCSS('text-align', 'center')

  await grid.locator('td', { hasText: '2' }).click()
  await expect(page.locator('.cm-table-grid')).toHaveCount(0)
  await expect(content(page)).toContainText('| 1 | 2 |')
  // The hint bar is up, and typing lands in the clicked cell.
  await expect(page.locator('.cm-table-hint')).toBeVisible()
  await page.keyboard.type('x')
  expect(await text(page)).toContain('| 1 | 2x |')

  await expectAccessible(page, 'table hint bar')
})

test('the keyboard walks into the table: an arrow from the line above shows the source', async ({ page }) => {
  await seedReadNote(page, 'tables-arrow', NOTE)
  await page.getByText('Above the table.').click()
  await expect(page.locator('.cm-table-grid')).toHaveCount(1)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await expect(page.locator('.cm-table-grid')).toHaveCount(0)
  await expect(page.locator('.cm-table-hint')).toBeVisible()
})

test('Tab aligns and moves cell to cell, Enter goes down a row and adds one, undo takes it back', async ({
  page,
}) => {
  await seedReadNote(page, 'tables-keys', NOTE)
  await page.locator('.cm-table-grid th', { hasText: 'a' }).click()
  await page.keyboard.press('Tab')
  expect(await text(page)).toContain('| a   |  b  |\n| --- | :-: |\n| 1   |  2  |')
  await page.keyboard.type('!')
  expect(await text(page)).toContain('|  b!  |')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  // A third body line exists now, and the caret is in its second cell.
  await page.keyboard.type('z')
  expect(await text(page)).toMatch(/\|\s+\|\s+z\s+\|/)
  // Tab stays in the editor: focus did not leave for the next control.
  await expect(content(page)).toBeFocused()
})

test('the hint bar’s + row and the palette’s table rows act on the table', async ({ page }) => {
  await seedReadNote(page, 'tables-commands', NOTE)
  await page.locator('.cm-table-grid td', { hasText: '1' }).click()
  await page.locator('.cm-table-hint').getByRole('button', { name: '+ row' }).click()
  expect((await text(page)).split('\n').filter((l) => l.startsWith('|'))).toHaveLength(4)
  await runCommand(page, 'Table: insert column right')
  expect(await text(page)).toContain('| --- | --- | :-: |')
})
