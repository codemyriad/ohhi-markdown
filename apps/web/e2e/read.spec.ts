/**
 * Read (X1–X4) — the slice's demos, driven the way a note is actually read:
 * one fixture typed into the memory vault, then what the shaping doc promises.
 * Markers hide off the caret's line and come back on it; `Mod+E` is Reading
 * and back at the same scroll; the mode is the tab's own and survives a
 * reload; the status menu reaches Source; a checkbox is a text edit, in
 * Reading too; the frontmatter block is a strip until you enter it and stops
 * being one the moment it stops parsing (R4.1.1); a tag chip searches, and
 * `#` completes.
 *
 * The two-context half of R2.3 (the peer sees the checkbox) lives in
 * `collab.spec.ts`, with the other collab scenarios — the one-smoke rule.
 */
import { expect, test, type Page } from '@playwright/test'
import { READ_FIXTURE, READ_NOTE, seedReadNote } from './fixtures.js'

const content = (page: Page) => page.locator('[data-testid="editor-pane"] .cm-content')
const scroller = (page: Page) => page.locator('[data-testid="editor-pane"] .cm-scroller')

test('Live renders the constructs, and the caret line is where the markers live', async ({
  page,
}) => {
  await seedReadNote(page, 'read-live')
  const editor = content(page)

  // The line classes and widgets the construct table (B2) promises.
  await expect(page.locator('.cm-live-h1')).toHaveCount(1)
  await expect(page.locator('.cm-bullet')).not.toHaveCount(0)
  await expect(page.locator('.cm-live-quote')).not.toHaveCount(0)
  await expect(page.locator('.cm-live-code')).not.toHaveCount(0)
  await expect(page.locator('input.cm-task')).toHaveCount(2)

  // Off the caret's line, a marker is not in the document at all — it is a
  // replaced range, so it is not in the DOM either.
  await expect(editor).toContainText('Marks and Channels')
  await expect(editor).not.toContainText('# Marks and Channels')
  await expect(editor).not.toContainText('](https://example.com)')

  // On it, every marker is text again and can be edited like any other.
  await page.getByText('Marks and Channels').click()
  await expect(editor).toContainText('# Marks and Channels')
})

test('Mod+E is Reading and back — same note, same scroll, and the tab says so', async ({
  page,
}) => {
  // A document long enough to scroll, so "same scroll" means something.
  await seedReadNote(page, 'read-modes', `${READ_FIXTURE}\n${'- a line\n'.repeat(80)}`)
  // Mod+End left the view at the foot of the note; that number is the subject.
  const before = await scroller(page).evaluate((el) => el.scrollTop)
  expect(before).toBeGreaterThan(0)

  await page.keyboard.press('ControlOrMeta+e')
  // Reading is not editable — the whole of what the mode changes.
  await expect(page.locator('[data-testid="editor-pane"] .cm-content[contenteditable="true"]')).toHaveCount(0)
  // …and the tab carries the eye, named for a screen reader.
  await expect(page.getByRole('tab', { selected: true })).toContainText('Reading view')
  await expect(page.getByTestId('mode-menu')).toContainText('Reading')
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeCloseTo(before, -1)

  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.locator('[data-testid="editor-pane"] .cm-content[contenteditable="true"]')).toHaveCount(1)
  await expect(page.getByTestId('mode-menu')).toContainText('Live')
  expect(await scroller(page).evaluate((el) => el.scrollTop)).toBeCloseTo(before, -1)
})

test('the status bar menu reaches Source, where nothing hides', async ({ page }) => {
  await seedReadNote(page, 'read-source')
  await page.getByTestId('mode-menu').click()
  await expect(page.getByTestId('mode-menu-list')).toBeVisible()
  await page.getByTestId('mode-menu:source').click()

  await expect(page.getByTestId('mode-menu')).toContainText('Source')
  // Every marker is text, wherever the caret is.
  await expect(content(page)).toContainText('# Marks and Channels')
  await expect(content(page)).toContainText('](https://example.com)')
  await expect(page.locator('input.cm-task')).toHaveCount(0)
  // A Source tab says so too (the mock, v4).
  await expect(page.getByRole('tab', { selected: true })).toContainText('Source view')
})

test('the mode belongs to the tab — the strip button, the Settings default, a reload', async ({
  page,
}) => {
  await seedReadNote(page, 'read-tabs')
  await expect(page.getByTestId('mode-menu')).toContainText('Live')

  // The strip-end button is the pointer equivalent of Mod+E, and it says what
  // it will DO rather than where you are.
  const toggle = page.locator('[data-testid^="mode-toggle:"]')
  await toggle.click()
  await expect(page.getByTestId('mode-menu')).toContainText('Reading')
  await toggle.click()
  await expect(page.getByTestId('mode-menu')).toContainText('Live')

  // Source on THIS tab; a second tab is untouched by it.
  await page.getByTestId('mode-menu').click()
  await page.getByTestId('mode-menu:source').click()
  await page.getByTestId('file-item:notes/ideas.md').click()
  await expect(page.getByTestId('mode-menu')).toContainText('Live')

  // The Settings default moves every tab that never chose for itself, and
  // leaves the one that did alone — which is why `Tab.mode` is absent rather
  // than stamped at open time.
  await page.keyboard.press('ControlOrMeta+,')
  await page.getByTestId('default-mode:reading').click()
  await page.getByTestId('settings-close').click()
  await expect(page.getByTestId('mode-menu')).toContainText('Reading')
  await page.locator('[data-slot-kind="tab"]', { hasText: 'welcome' }).first().click()
  await expect(page.getByTestId('mode-menu')).toContainText('Source')

  // Reload: every tab remembers its mode (X2's demo). The layout write is
  // debounced, as panes.spec.ts also has to wait for.
  await page.waitForTimeout(600)
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('mode-menu')).toContainText('Source')
})

test('clicking a checkbox is a text edit, one line of it — in Reading too', async ({ page }) => {
  await seedReadNote(page, 'read-checkbox')
  const boxes = page.locator('input.cm-task')
  await expect(boxes.first()).not.toBeChecked()
  await boxes.first().click()
  await expect(boxes.first()).toBeChecked()

  // Still a control in Reading: the mode gates COMMANDS, not edits (R2.3) —
  // `readOnly` stops the keymap, `editable(false)` stops the contentEditable,
  // and a widget's own `view.dispatch` goes through either way.
  await page.keyboard.press('ControlOrMeta+e')
  await boxes.nth(1).click()
  await expect(boxes.nth(1)).not.toBeChecked()
  await page.keyboard.press('ControlOrMeta+e')

  // The document, not just the widget: Source shows the bytes that changed.
  await page.getByTestId('mode-menu').click()
  await page.getByTestId('mode-menu:source').click()
  await expect(content(page)).toContainText('- [x] a task')
})

test('the frontmatter block is a strip until you are in it — and stops being one when it stops parsing', async ({
  page,
}) => {
  await seedReadNote(page, 'read-frontmatter')
  const editor = content(page)

  // Collapsed: the vault's legacy `tags: [a b]` reads as two chips, beside a
  // count of what else is in there.
  await expect(page.locator('.cm-tag[data-tag="composition"]')).toBeVisible()
  await expect(page.locator('.cm-tag[data-tag="testing"]')).toBeVisible()
  await expect(editor).toContainText('properties')
  await expect(editor).not.toContainText('status: On deck')

  // Click the strip: the caret lands in the block and it is YAML again.
  await page.locator('.cm-tag[data-tag="composition"]').click()
  await expect(editor).toContainText('status: On deck')

  // R4.1.1: one blank line above it and it is not frontmatter any more — the
  // `---` is a rule, like any other `---`, and the keys are a paragraph.
  // Nothing prompts, nothing repairs, nothing is held together.
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+End')
  await expect(page.locator('.cm-content hr')).not.toHaveCount(0)
  await expect(page.locator('.cm-tag[data-tag="composition"]')).toHaveCount(0)
  await expect(editor).toContainText('status: On deck')

  // Take the line back out and it is a block again: YAML while the caret is
  // in it, and the strip the moment the caret leaves.
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('Delete')
  await expect(editor).toContainText('status: On deck')
  await expect(page.locator('.cm-content hr')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+End')
  await expect(page.locator('.cm-tag[data-tag="composition"]')).toBeVisible()
  await expect(editor).not.toContainText('status: On deck')
})

test('a tag chip searches for it, and `#` completes from the index', async ({ page }) => {
  await seedReadNote(page, 'read-tags')

  await page.locator('.cm-tag[data-tag="edible/roadmap"]').click()
  await expect(page.getByTestId('search-input')).toHaveValue('tag:#edible/roadmap')
  await expect(page.getByTestId('search-results')).toContainText(READ_NOTE)
  await page.keyboard.press('Escape')

  // The completion source is the index, so it knows the tag this note carries.
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\n#edi')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('edible/roadmap')
})
