/**
 * Read (X1–X4) — the slice's demos, driven the way a note is actually read:
 * one fixture typed into the memory vault, then what the shaping doc promises.
 * Markers hide off the caret's line and come back on it; `Mod+E` is Reading
 * and back at the same scroll; the mode is the tab's own and survives a
 * reload; the status menu and the tab strip's mode menu reach Source; a checkbox is a text edit, in
 * Reading too; the frontmatter block is a strip until you enter it and stops
 * being one the moment it stops parsing (R4.1.1); a tag chip searches, and
 * `#` completes.
 *
 * The two-context half of R2.3 (the peer sees the checkbox) lives in
 * `collab.spec.ts`, with the other collab scenarios — the one-smoke rule.
 */
import { expect, test } from '@playwright/test'
import {
  closeSettings,
  expectAccessible,
  openSettings,
  openApp,
  tabNamed,
  paneContent as content,
  paneScroller as scroller,
  READ_FIXTURE,
  READ_NOTE,
  seedReadNote,
  paneTabs,
} from './fixtures.js'

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
  await expect(paneTabs(page, { selected: true })).toContainText('Reading view')
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
  await expect(paneTabs(page, { selected: true })).toContainText('Source view')
})

test('the mode menu on the tab strip offers all three modes, by pointer and by keyboard', async ({ page }) => {
  await seedReadNote(page, 'read-strip-menu')
  // Round 3, Q5: one menu on the strip, for the active tab — Live, Source, Reading.
  const trigger = page.locator('[data-testid^="tab-mode:"][data-mode]')
  await expect(trigger).toHaveAttribute('data-mode', 'live')
  await expect(trigger).toHaveAccessibleName('View mode: Live')
  await trigger.click()
  const list = page.locator('[data-testid^="tab-mode-list:"]')
  await expect(list.getByRole('menuitemradio')).toHaveText(['Live', 'Source', 'Reading'])
  await expectAccessible(page, 'the tab strip mode menu')
  await list.locator('[data-testid$=":source"]').click()
  await expect(trigger).toHaveAttribute('data-mode', 'source')
  await expect(content(page)).toContainText('# Marks and Channels')
  await expect(paneTabs(page, { selected: true })).toContainText('Source view')

  // The keyboard: focus the trigger, Enter opens, arrows walk, Enter picks.
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(list).toBeVisible()
  // Opened from the keyboard, focus lands on the first row; arrows walk them.
  const rows = list.getByRole('menuitemradio')
  await expect(rows.first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(rows.last()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('data-mode', 'reading')
  await expect(page.getByTestId('mode-menu')).toContainText('Reading')

  // Mod+E is unchanged: Obsidian's pair, editing ↔ Reading.
  await page.keyboard.press('ControlOrMeta+e')
  await expect(trigger).not.toHaveAttribute('data-mode', 'reading')
})

test('the mode belongs to the tab — the strip menu, the Settings default, a reload', async ({
  page,
}) => {
  await seedReadNote(page, 'read-tabs')
  await expect(page.getByTestId('mode-menu')).toContainText('Live')

  // The strip-end menu is the active tab's.
  const trigger = page.locator('[data-testid^="tab-mode:"][data-mode]')
  await trigger.click()
  await page.locator('[data-testid^="tab-mode:"][data-testid$=":reading"]').click()
  await expect(page.getByTestId('mode-menu')).toContainText('Reading')
  await trigger.click()
  await page.locator('[data-testid^="tab-mode:"][data-testid$=":live"]').click()
  await expect(page.getByTestId('mode-menu')).toContainText('Live')

  // Source on THIS tab; a second tab is untouched by it.
  await page.getByTestId('mode-menu').click()
  await page.getByTestId('mode-menu:source').click()
  await page.getByTestId('file-item:notes/ideas.md').click()
  await expect(page.getByTestId('mode-menu')).toContainText('Live')

  // The Settings default moves every tab that never chose for itself, and
  // leaves the one that did alone — which is why `Tab.mode` is absent rather
  // than stamped at open time.
  await openSettings(page, 'editor')
  await page.getByTestId('default-mode:reading').click()
  await closeSettings(page)
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

  // Click the strip — anywhere but a chip, which searches for itself (B4.2):
  // the caret lands in the block and it is YAML again.
  await page.locator('.cm-frontmatter-count').click()
  await expect(editor).toContainText('status: On deck')

  // …and the keyboard gets in too: the strip is a block widget over an atomic
  // range, so `Mod+Home` landing at offset 0 is what makes the block reachable
  // without a pointer.
  await page.keyboard.press('ControlOrMeta+End')
  await expect(editor).not.toContainText('status: On deck')
  await page.keyboard.press('ControlOrMeta+Home')
  await expect(editor).toContainText('status: On deck')

  // R4.1.1: one blank line above it and it is not frontmatter any more — the
  // `---` is a rule, like any other `---`, and the keys are a paragraph.
  // Nothing prompts, nothing repairs, nothing is held together.
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

/**
 * R2.2 in the one place a caret can actually meet hidden text: a checkbox
 * stays drawn on the caret's own line, where every other marker is given back
 * as text. Everything else about the invariant is a unit test over every
 * offset in a note (preview.test.ts); this is the half that needs a browser —
 * real key presses, real atomic ranges, and a real undo manager.
 */
test('the caret steps over a checkbox instead of into it, and undo puts it back', async ({
  page,
}) => {
  await seedReadNote(page, 'read-caret', '# Head\n\n- [ ] one\n- [ ] two\n')
  const editor = content(page)
  const box = page.locator('input.cm-task')
  await expect(box).toHaveCount(2)

  // Rightwards: `-`, the space, then the WHOLE `[ ]` in one step — it is one
  // atomic range, not three characters — and one more onto the `o` of `one`.
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Home')
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight')
  await page.keyboard.type('X')

  // Leftwards on the next task, which is the direction that would land between
  // the brackets if the range were three ordinary characters.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('Y')

  // Source is where the document says where the characters went.
  await page.getByTestId('mode-menu').click()
  await page.getByTestId('mode-menu:source').click()
  await expect(editor).toContainText('- [ ] Xone')
  await expect(editor).toContainText('- Y[ ] two')
  await page.getByTestId('mode-menu').click()
  await page.getByTestId('mode-menu:live').click()

  // A checkbox click is an edit like any other, so ONE undo takes it back —
  // the widget is view state, and the undo manager only ever saw the character.
  // The wait is the undo manager's own 500 ms capture window: inside it, Yjs
  // merges the click into the edit before it (as it merges consecutive
  // keystrokes), and this test is about one undo item, not about grouping.
  await page.waitForTimeout(600)
  await expect(box.first()).not.toBeChecked()
  await box.first().click()
  await expect(box.first()).toBeChecked()
  await editor.press('ControlOrMeta+z')
  await expect(box.first()).not.toBeChecked()
  await expect(editor).toContainText('Xone')
})

test('a tag chip searches for it, and `#` completes from the index', async ({ page }) => {
  await seedReadNote(page, 'read-tags')

  await page.locator('.cm-tag[data-tag="edible/roadmap"]').click()
  await expect(page.getByTestId('search-input')).toHaveValue('tag:#edible/roadmap')
  await expect(page.getByTestId('search-results')).toContainText(READ_NOTE)
  await page.keyboard.press('Escape')

  // The chips in the frontmatter strip are the same chip and do the same
  // thing — the one place a click is on a widget rather than on the document.
  await page.locator('.cm-frontmatter-strip .cm-tag[data-tag="composition"]').click()
  await expect(page.getByTestId('search-input')).toHaveValue('tag:#composition')
  await page.keyboard.press('Escape')

  // The completion source is the index, so it knows the tag this note carries.
  await content(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\n#edi')
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('edible/roadmap')
})

test('the inline title is the note\'s name above its text; renaming it renames the tab, the tree row and the file', async ({
  page,
}) => {
  await openApp(page, 'read-title')
  await page.getByTestId(`file-item:${READ_NOTE}`).click()
  const title = page.getByTestId('inline-title-input')
  // Inside the note's scroller, above the text — not part of the document.
  await expect(scroller(page).getByTestId('inline-title-input')).toHaveValue('welcome')
  await expect(page.getByRole('heading', { level: 1, name: 'welcome' })).toBeVisible()
  const doc = () =>
    content(page).evaluate((el) => {
      type Tile = { root?: { view?: { state: { doc: { toString(): string } } } } }
      return (el as unknown as { cmTile?: Tile }).cmTile?.root?.view?.state.doc.toString() ?? null
    })
  const body = await doc()
  expect(body).toBeTruthy()
  // The title is not in the document.
  expect(body!.startsWith('welcome')).toBe(false)

  // A taken name is refused with the tree's wording and the title goes back.
  await title.click()
  await title.fill('ideas')
  await title.press('Enter')
  await expect(page.getByTestId('toast').filter({ hasText: '“ideas.md” already exists in this folder' })).toHaveCount(1)
  await expect(title).toHaveValue('welcome')
  // Escape puts the name back.
  await title.fill('never mind')
  await title.press('Escape')
  await expect(title).toHaveValue('welcome')
  await expect(page.getByTestId('file-item:notes/never mind.md')).toHaveCount(0)

  // Enter renames: the tree row, the tab and the file move; the text comes along.
  await title.click()
  await title.fill('Weekly plan')
  await title.press('Enter')
  await expect(page.getByTestId('file-item:notes/Weekly plan.md')).toBeVisible()
  await expect(page.getByTestId(`file-item:${READ_NOTE}`)).toHaveCount(0)
  await expect(tabNamed(page, 'Weekly plan')).toBeVisible()
  await expect(page.getByTestId('inline-title-input')).toHaveValue('Weekly plan')
  await expect.poll(doc).toBe(body)
  // …and the caret is in the note's first line.
  await expect(content(page)).toBeFocused()

  // ArrowDown from the title is the line below it.
  await page.getByTestId('inline-title-input').click()
  await page.keyboard.press('ArrowDown')
  await expect(content(page)).toBeFocused()

  // Reading keeps it; the layout's `editor.inlineTitle` is what hides it.
  await page.keyboard.press('ControlOrMeta+e')
  await expect(page.locator('[data-testid="editor-pane"] .cm-content[contenteditable="true"]')).toHaveCount(0)
  await expect(page.getByTestId('inline-title-input')).toHaveValue('Weekly plan')
})

test('a bullet is drawn the moment `- ` is typed; Backspace gives the marker back, then takes it; nesting draws guides', async ({
  page,
}) => {
  // Chris, 2026-10-06: "the space live previews it, not the new line".
  await seedReadNote(page, 'read-lists', '# Lists\n\n')
  const editor = content(page)
  const line = (text: string) => editor.locator('.cm-line', { hasText: text })

  await page.keyboard.type('-')
  await expect(editor.locator('.cm-bullet')).toHaveCount(0)
  await page.keyboard.type(' ')
  // On the caret's own line, before a word of the item exists.
  await expect(editor.locator('.cm-bullet')).toHaveCount(1)
  await page.keyboard.type('item')
  await expect(line('item').locator('.cm-bullet')).toHaveCount(1)
  await expect(line('item')).toHaveText('item')

  // From the start of the text: the first Backspace selects the marker, which
  // is raw text again; the second deletes it.
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Backspace')
  await expect(line('item').locator('.cm-bullet')).toHaveCount(0)
  await expect(line('item')).toHaveText('- item')
  await page.keyboard.press('Backspace')
  await expect(line('item')).toHaveText('item')
  await expect(editor.locator('.cm-bullet')).toHaveCount(0)

  // Nesting: every list line carries its depth, and the guide band is one
  // indent wide per level — two levels on the grandchild.
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\n\n- top\n\t- child\n\t\t- grandchild\n\nafter')
  await expect(editor.locator('.cm-bullet')).toHaveCount(3)
  await expect(line('grandchild')).toHaveAttribute('style', /--cm-list-depth: 2/)
  await expect(line('child').first()).toHaveAttribute('style', /--cm-list-depth: 1/)
  const band = (text: string) =>
    line(text).first().evaluate((el) => parseFloat(getComputedStyle(el).backgroundSize))
  const one = await band('child') // the first match is the child itself
  expect(one).toBeGreaterThan(0)
  expect(await band('grandchild')).toBeCloseTo(2 * one, 0)
  expect(await band('top')).toBe(0)
  await expectAccessible(page, 'a nested list in Live')

  // Source: the markers are text and nothing list-shaped is drawn.
  await page.getByTestId('mode-menu').click()
  await page.getByTestId('mode-menu:source').click()
  await expect(editor.locator('.cm-bullet')).toHaveCount(0)
  await expect(editor.locator('.cm-list-line')).toHaveCount(0)
  await expect(editor).toContainText('- grandchild')

  // Reading draws them as Live does.
  await page.keyboard.press('ControlOrMeta+e')
  await expect(editor.locator('.cm-bullet')).toHaveCount(3)
  await expect(line('grandchild')).toHaveAttribute('style', /--cm-list-depth: 2/)
})

/**
 * Where the caret is drawn, relative to the top of its line: CM6's own
 * `coordsAtPos` for the main selection. There is no `.cm-cursor` to measure
 * (drawSelection is off, the caret is the browser's), and beside a widget the
 * caret sits at an element boundary where a DOM Range has no rects — so this
 * asks the view, which takes the widget's box exactly as the browser does.
 */
async function caretBox(page: import('@playwright/test').Page): Promise<{ top: number; height: number }> {
  return content(page).evaluate((el) => {
    type View = {
      state: { selection: { main: { head: number } } }
      documentTop: number
      lineBlockAt(pos: number): { top: number }
      coordsAtPos(pos: number, side: number): { top: number; bottom: number } | null
    }
    const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view
    if (!view) throw new Error('caretBox: no CodeMirror view behind this .cm-content')
    const head = view.state.selection.main.head
    const c = view.coordsAtPos(head, 1)!
    return { top: c.top - (view.documentTop + view.lineBlockAt(head).top), height: c.bottom - c.top }
  })
}

test('the caret on a bullet line sits where it sits on a paragraph line', async ({ page }) => {
  // Chris, 2026-10-06 (screenshot): the caret after the dot rendered taller and
  // higher than the text's — the bullet's box was a line-tall inline-block.
  await seedReadNote(page, 'read-list-caret', 'plain text\n\n- bullet text\n\t- nested text\n\n')
  const editor = content(page)
  const near = (a: { top: number; height: number }, b: { top: number; height: number }, what: string) => {
    expect(Math.abs(a.top - b.top), `${what}: caret top ${a.top} vs ${b.top}`).toBeLessThanOrEqual(1)
    expect(Math.abs(a.height - b.height), `${what}: caret height ${a.height} vs ${b.height}`).toBeLessThanOrEqual(1)
  }
  // The start of each line's text: on the bullet lines, right after the dot.
  const at = async (text: string): Promise<{ top: number; height: number }> => {
    await editor.locator('.cm-line', { hasText: text }).click()
    await page.keyboard.press('End')
    for (let i = 0; i < text.length; i++) await page.keyboard.press('ArrowLeft')
    return caretBox(page)
  }
  const plain = await at('plain text')
  expect(plain.height).toBeGreaterThan(0)
  for (const text of ['bullet text', 'nested text']) {
    near(await at(text), plain, text)
    await expect(editor.locator('.cm-line', { hasText: text }).locator('.cm-bullet')).toHaveCount(1)
  }
  // An item just opened — nothing after the dot, which is where it showed.
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('- ')
  near(await caretBox(page), plain, 'empty item')
  // Nor does the dot make the line itself taller.
  const height = (text: string) =>
    editor.locator('.cm-line', { hasText: text }).evaluate((el) => el.getBoundingClientRect().height)
  expect(Math.abs((await height('bullet text')) - (await height('plain text')))).toBeLessThanOrEqual(1)
  await expectAccessible(page, 'bullet lines in Live')
})

test('Tab nests a list item under the one above, Shift+Tab brings it back', async ({ page }) => {
  // Chris, 2026-10-06: "on a bullet point tab should allow me to indent it".
  await seedReadNote(page, 'read-list-tab', '# Tabs\n\n')
  const editor = content(page)
  const line = (text: string) => editor.locator('.cm-line', { hasText: text }).last()
  const raw = (text: string) => line(text).evaluate((el) => el.textContent)

  // Enter continues the list, so `b` is the second item — the first has
  // nothing to nest under (a tab there would make it an indented code block).
  await page.keyboard.type('- a')
  await page.keyboard.press('Enter')
  await page.keyboard.type('b')
  await expect(editor.locator('.cm-bullet')).toHaveCount(2)

  await page.keyboard.press('Tab')
  // Still in the editor: the key was the list's, not focus navigation.
  await expect(editor).toBeFocused()
  expect(await raw('b')).toBe('\tb')
  await expect(line('b')).toHaveAttribute('style', /--cm-list-depth: 1/)
  await expect(line('b').locator('.cm-bullet')).toHaveCount(1)
  expect(await line('b').evaluate((el) => parseFloat(getComputedStyle(el).backgroundSize))).toBeGreaterThan(0)
  // The caret stayed after the drawn bullet: typing lands in the item's text.
  await page.keyboard.type('c')
  expect(await raw('bc')).toBe('\tbc')

  // The third level — where Chris saw it break: Enter opens an empty item,
  // Tab nests it, and the caret must be AFTER its marker (col 4 of `\t\t- `),
  // not in the indent before it, so the bullet stays drawn while typing.
  const caretCol = () =>
    editor.evaluate((el) => {
      type View = { state: { selection: { main: { head: number } }; doc: { lineAt(p: number): { from: number } } } }
      const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view
      if (!view) throw new Error('no CodeMirror view behind this .cm-content')
      const head = view.state.selection.main.head
      return head - view.state.doc.lineAt(head).from
    })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  expect(await caretCol()).toBe(4)
  await expect(editor.locator('.cm-bullet')).toHaveCount(3)
  await page.keyboard.type('deep')
  expect(await raw('deep')).toBe('\t\tdeep')
  await expect(line('deep')).toHaveAttribute('style', /--cm-list-depth: 2/)
  await expect(line('deep').locator('.cm-bullet')).toHaveCount(1)
  // Two guide levels on it: the band is twice the child's.
  const band = (text: string) => line(text).evaluate((el) => parseFloat(getComputedStyle(el).backgroundSize))
  expect(await band('deep')).toBeCloseTo(2 * (await band('bc')), 0)

  // Shift+Tab walks it back out, one level a press, the bullet drawn throughout.
  await page.keyboard.press('Shift+Tab')
  await expect(editor).toBeFocused()
  expect(await raw('deep')).toBe('\tdeep')
  await page.keyboard.press('Shift+Tab')
  expect(await raw('deep')).toBe('deep')
  await expect(line('deep')).toHaveAttribute('style', /--cm-list-depth: 0/)
  await expect(line('deep').locator('.cm-bullet')).toHaveCount(1)
  await expectAccessible(page, 'an indented list item')
})
