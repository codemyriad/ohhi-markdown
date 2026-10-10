/**
 * Tab groups (tab-groups W2) — the slice's demo, in Playwright: a cluster of
 * notes named and coloured, folded to one chip, put away into the list and
 * brought back in another pane at the cursor it was left at, then carried out
 * as `[[wikilinks]]` and back in again from that text (R6).
 *
 * Memory vault contract, like `panes.spec.ts` — no folder, no share.
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { chips, dragTo, editors, focusEditor, newNote, openApp, panes, tabNamed, paneTabs } from './fixtures.js'

const WELCOME = 'notes/welcome.md'
const IDEAS = 'notes/ideas.md'

const more = (page: Page, at = 0): Locator => page.locator('[data-testid^="tab-more:"]').nth(at)

test('five notes, two of them a named, coloured group that folds to one chip', async ({ page }) => {
  await openApp(page, 'groups-fold')
  const extra = [await newNote(page, 1), await newNote(page, 2), await newNote(page, 3)]
  for (const path of [WELCOME, IDEAS, ...extra]) {
    await page.getByTestId(`file-item:${path}`).click()
  }
  await expect(paneTabs(page)).toHaveCount(5)

  // Group by menu, not by drag: every gesture has a keyboard equivalent (R8).
  await tabNamed(page, 'ideas').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()

  // A fresh group opens its popover with the name selected — an unnamed chip
  // on the strip would be the thing nobody comes back and fixes.
  await expect(page.getByTestId('group-manage')).toBeVisible()

  // …and it hangs off the chip it is about (P1.3). It used to be a centred
  // modal, which is what made it read as a jumble floating in the middle.
  const fresh = (await chips(page).first().boundingBox())!
  const pop = (await page.getByTestId('group-manage').boundingBox())!
  expect(Math.abs(pop.y - (fresh.y + fresh.height))).toBeLessThan(12)

  await page.getByTestId('group-name').fill('Edible')
  await page.getByTestId('group-colour:3').click()
  await expect(page.getByTestId('group-colour:3')).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('group-manage-close').click()
  await expect(page.getByTestId('group-manage')).toHaveCount(0)

  const chip = chips(page).first()
  await expect(chip).toHaveText(/Edible/)
  await expect(chip).toHaveAttribute('data-color', '3')

  // A second tab joins from its own menu; joining is also a reorder, so the
  // run stays contiguous (the contiguity invariant).
  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByRole('menuitemradio', { name: 'Edible' }).click()
  await expect(paneTabs(page)).toHaveCount(5)

  // Fold: two tabs go behind the chip, and the pane still has exactly one
  // live editor — a folded tab never had one to lose (R2.1).
  await expect(chip).toHaveAttribute('aria-expanded', 'true')
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(paneTabs(page)).toHaveCount(3)
  await expect(chip).toHaveText(/2/)
  await expect(editors(page)).toHaveCount(1)

  // The `▾` list shows it as open, ticked (Firefox's second screenshot).
  await more(page).click()
  const row = page.locator('[data-testid^="groups-menu:open:"]')
  await expect(row).toHaveText(/Edible/)
  await expect(row).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
})

test('closing a group keeps it in the list, and it reopens in another pane at its cursor', async ({
  page,
}) => {
  await openApp(page, 'groups-close')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await page.getByTestId('group-name').fill('Reading')
  await page.keyboard.press('Enter')
  await expect(chips(page).first()).toHaveText(/Reading/)

  // Leave the caret somewhere it could not be by accident: the end of the note.
  const editor = editors(page).first()
  await editor.click()
  await page.keyboard.press('ControlOrMeta+End')

  // Close is the save (R2.2): off the strip, into the list, nothing lost.
  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:group-close').click()
  await expect(chips(page)).toHaveCount(0)
  await expect(page.locator('[data-slot-kind="tab"]', { hasText: 'welcome' })).toHaveCount(0)

  await more(page).click()
  await expect(page.locator('[data-testid^="groups-menu:saved:"]')).toHaveText(/Reading/)
  await page.keyboard.press('Escape')

  // Reopen it in a pane it was never in.
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(2)
  await more(page, 1).click()
  await page.locator('[data-testid^="groups-menu:saved:"]').click()
  await expect(chips(page)).toHaveCount(1)

  // Out of the list the moment it is back on a strip — reopening cannot double it.
  await more(page, 1).click()
  await expect(page.locator('[data-testid^="groups-menu:saved:"]')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // The resume point came with it (R2.3): focus WITHOUT clicking — a click
  // would place the caret itself — and what is typed lands at the end of the
  // note, not at the top where a fresh view would put it.
  const reopened = page.getByTestId('editor-pane').locator('.cm-content')
  await expect(reopened).toContainText('Welcome to Editor')
  // Through CM6's own focus, not a DOM one: see `focusEditor` for the 200 ms
  // window a DOM focus races, which is what made this flaky in a full run.
  await focusEditor(reopened)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const anchor = window.getSelection()?.anchorNode
        const last = document.querySelector('[data-testid="editor-pane"] .cm-content')
          ?.lastElementChild
        return !!anchor && !!last && (last === anchor || last.contains(anchor))
      })
    )
    .toBe(true)
  await page.keyboard.type('CARETWASHERE')
  const text = await reopened.innerText()
  expect(text.startsWith('CARETWASHERE')).toBe(false)
  expect(text.trimEnd().endsWith('CARETWASHERE')).toBe(true)
})

test('a group copies out as wikilinks, and a note of links opens as a group', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openApp(page, 'groups-links')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.getByTestId(`file-item:${IDEAS}`).click()

  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await page.getByTestId('group-name').fill('Edible')
  await page.keyboard.press('Enter')
  await tabNamed(page, 'ideas').click({ button: 'right' })
  await page.getByRole('menuitemradio', { name: 'Edible' }).click()

  // Copy N links: a toast says what went, and the clipboard holds the list.
  await chips(page).first().click({ button: 'right' })
  await page.getByTestId('group-copy-links').click()
  // The room in this fixture has no share on the relay, so an error toast is
  // always in flight beside it — scope to the notice this action raised.
  await expect(page.locator('[data-testid="toast"][data-level="info"]')).toContainText(
    'Copied 2 links from Edible'
  )
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  expect(copied).toBe('- [[welcome]]\n- [[ideas]]')

  // Put the group away so the notes are off the strip, then write the links
  // into a note — the agent handoff R6 is about, done by hand.
  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:group-close').click()
  await expect(chips(page)).toHaveCount(0)

  await newNote(page, 1)
  await page.getByTestId('file-item:untitled-1.md').click()
  const editor = page.getByTestId('editor-pane').locator('.cm-content')
  await editor.click()
  for (const line of copied.split('\n')) {
    await page.keyboard.type(line)
    // The wikilink completion opens while you type inside `[[`; Escape
    // dismisses it so the newline is a newline.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Enter')
  }
  // Live renders a wikilink as its target, so the note of links reads as a
  // list of note names; `.cm-wikilink` is what says they are links.
  await expect(editor.locator('.cm-wikilink').first()).toBeVisible()
  await expect(editor).toContainText('welcome')
  await expect(editor).toContainText('ideas')

  await more(page).click()
  await page.getByTestId('groups-menu:open-links').click()
  const chip = chips(page).first()
  await expect(chip).toHaveText(/untitled-1/)
  await expect(paneTabs(page)).toHaveCount(3)
  await expect(page.locator('[data-slot-kind="tab"]', { hasText: 'welcome' })).toHaveCount(1)
  await expect(page.locator('[data-slot-kind="tab"]', { hasText: 'ideas' })).toHaveCount(1)
})

test('the Show-all dialog lists open and saved groups, and Delete is the only thing that loses one', async ({
  page,
}) => {
  await openApp(page, 'groups-all')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.getByTestId(`file-item:${IDEAS}`).click()

  // One group put away, one still open.
  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await page.getByTestId('group-name').fill('Away')
  await page.keyboard.press('Enter')
  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:group-close').click()

  await tabNamed(page, 'ideas').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await page.getByTestId('group-name').fill('Here')
  await page.keyboard.press('Enter')

  await more(page).click()
  await page.getByTestId('groups-menu:show-all').click()
  const dialog = page.getByTestId('groups-all')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('listitem')).toHaveCount(2)
  await expect(dialog).toContainText('Here')
  await expect(dialog).toContainText('Away')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)

  // Delete asks first, and only then takes the tabs with it (B4).
  await chips(page).first().click({ button: 'right' })
  await page.getByTestId('group-delete').click()
  await expect(page.getByTestId('group-delete-confirm')).toBeVisible()
  // The popover steps aside for the confirm — one focus trap at a time.
  await expect(page.getByTestId('group-manage')).toHaveCount(0)
  await page.getByTestId('group-delete-confirm-cancel').click()
  await expect(chips(page)).toHaveCount(1)

  await chips(page).first().click({ button: 'right' })
  await page.getByTestId('group-delete').click()
  await page.getByTestId('group-delete-confirm-confirm').click()
  await expect(chips(page)).toHaveCount(0)
  await expect(page.locator('[data-slot-kind="tab"]', { hasText: 'ideas' })).toHaveCount(0)
})

test('the group mode and Mod+Shift+G reach the same verbs as the menus', async ({ page }) => {
  await openApp(page, 'groups-keys')
  await page.getByTestId(`file-item:${WELCOME}`).click()

  // Mod+Shift+G groups the active tab and opens the popover, name selected.
  await page.keyboard.press('ControlOrMeta+Shift+g')
  await expect(page.getByTestId('group-manage')).toBeVisible()
  await page.getByTestId('group-name').fill('Keys')
  await page.keyboard.press('Enter')
  const chip = chips(page).first()
  await expect(chip).toHaveText(/Keys/)

  // Mod+Shift+E folds it; the mode's `g f` unfolds it again.
  await editors(page).first().click()
  await page.keyboard.press('ControlOrMeta+Shift+e')
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('ControlOrMeta+p')
  await page.keyboard.press('g')
  await expect(page.getByTestId('mode-badge')).toHaveText('GROUP')
  // E6: Subtle (the default) shows the mode's two verbs in the corner; fold is one.
  await expect(page.getByTestId('mode-cue')).toContainText('Fold / unfold group')
  await page.keyboard.press('f')
  await expect(chip).toHaveAttribute('aria-expanded', 'true')

  // `g x` puts it in the list, and the palette offers it back by name.
  await page.keyboard.press('ControlOrMeta+p')
  await page.keyboard.press('g')
  await page.keyboard.press('x')
  await expect(chips(page)).toHaveCount(0)

  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Open group')
  await expect(page.getByTestId('command-palette-results')).toContainText('Open group: Keys')
  await page.getByTestId('command-palette-row').first().click()
  await expect(chips(page).first()).toHaveText(/Keys/)
})

test('a chip drag moves the whole group — onto an edge, and back onto a strip', async ({
  page,
}) => {
  await openApp(page, 'groups-drag')
  await newNote(page, 1)
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await page.getByTestId('file-item:untitled-1.md').click()

  await tabNamed(page, 'welcome').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await page.getByTestId('group-name').fill('Edible')
  await page.getByTestId('group-colour:5').click()
  await page.getByTestId('group-manage-close').click()
  await tabNamed(page, 'ideas').click({ button: 'right' })
  await page.getByRole('menuitemradio', { name: 'Edible' }).click()
  await expect(panes(page)).toHaveCount(1)

  // Onto the pane's right quarter: a new pane holding the group (Decision 4).
  const box = (await panes(page).first().boundingBox())!
  await dragTo(page, chips(page).first(), box.x + box.width * 0.9, box.y + box.height * 0.6)
  await expect(panes(page)).toHaveCount(2)
  const moved = panes(page).nth(1)
  await expect(moved.locator('[data-testid^="group-chip:"]')).toHaveText(/Edible/)
  // The label crossed with it, colour and all — this is not two loose tabs.
  await expect(moved.locator('[data-testid^="group-chip:"]')).toHaveAttribute('data-color', '5')
  await expect(moved.locator('[data-slot-kind="tab"]')).toHaveCount(2)
  await expect(panes(page).first().locator('[data-slot-kind="tab"]')).toHaveCount(1)

  // And back onto the other strip: the emptied pane closes behind it.
  const strip = (await panes(page).first().locator('[data-strip]').boundingBox())!
  await dragTo(page, chips(page).first(), strip.x + strip.width - 30, strip.y + strip.height / 2)
  await expect(panes(page)).toHaveCount(1)
  await expect(chips(page)).toHaveCount(1)
  await expect(chips(page).first()).toHaveText(/Edible/)
  await expect(paneTabs(page)).toHaveCount(3)
})
