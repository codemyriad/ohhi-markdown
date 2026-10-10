/**
 * Panes and tabs (tab-groups W1) — the slice's demo, driven the way Chris
 * drives it: his own pane keys, then the mouse for the two gestures a
 * keyboard cannot express (drag-to-split, drag a border), then the two panes
 * on one note that Spike S9 is about.
 *
 * Memory vault contract, like v2.spec.ts — no folder, no share.
 */
import { expect, test } from '@playwright/test'
import { appUrl, closeSettings, dragRowTo, dragTo, editors, focusEditor, newNote, openApp, openByQuickOpen, openSettings, panes, runCommand, splitRight, tabNamed, paneTabs } from './fixtures.js'

const WELCOME = 'notes/welcome.md'
const IDEAS = 'notes/ideas.md'

test('his pane keys rebuild a four-pane layout, and the arrows move between them', async ({
  page,
}) => {
  await openApp(page, 'panes-keys')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(panes(page)).toHaveCount(1)

  // Alt+- splits down, Alt+= splits right — his own Obsidian rebinds. Each
  // split duplicates the active note into the new pane, as Obsidian does.
  await page.keyboard.press('Alt+-')
  await expect(panes(page)).toHaveCount(2)
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(3)

  // `Ctrl+Mod+Arrows` move focus. Off mac that chord is pressed as Alt+Arrow:
  // Ctrl+Alt+Arrows is GNOME's workspace switcher and never reaches the page,
  // and plain Mod+Arrows are his sidebar toggles (see commands.ts). The
  // focused pane is the one carrying the testids the rest of the shell drives,
  // so its status bar names it.
  await expect(page.getByTestId('status-bar')).toContainText('Pane 3')
  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.getByTestId('status-bar')).toContainText('Pane 2')
  await page.keyboard.press('Alt+ArrowUp')
  await expect(page.getByTestId('status-bar')).toContainText('Pane 1')

  // A fourth pane, and four live editors — one per pane on screen (R2.1).
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(4)
  await expect(editors(page)).toHaveCount(4)

  // Ctrl+Mod+Backspace closes the focused pane; its share goes to a neighbour.
  // That one keeps its Ctrl+Alt chord off mac — nothing else claims it.
  await page.keyboard.press('Control+Alt+Backspace')
  await expect(panes(page)).toHaveCount(3)
})

test('a tab dropped on a pane edge splits it; a tab dropped on a strip moves', async ({ page }) => {
  await openApp(page, 'panes-drag')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await expect(panes(page)).toHaveCount(1)
  // The first open fills the pane's empty tab; the second is a tab of its own.
  await expect(paneTabs(page)).toHaveCount(2)

  // Drag the *ideas* tab onto the left quarter of the pane: a new pane there.
  const pane = panes(page).first()
  const box = (await pane.boundingBox())!
  const ideas = tabNamed(page, 'ideas')
  const from = (await ideas.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6, { steps: 12 })
  // The ghost says what letting go would DO, not just what is being held: the
  // tint alone cannot tell a split from a join (R8).
  await expect(page.getByTestId('drag-promise')).toContainText('Split with ideas')
  await page.mouse.up()
  await expect(panes(page)).toHaveCount(2)
  // The dragged note went with it, and the new pane took focus.
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')

  // Drop it back onto the other pane's strip: two panes become one again when
  // the source pane's last tab leaves.
  const other = panes(page).nth(1)
  const strip = (await other.locator('[data-strip]').boundingBox())!
  const moved = tabNamed(page, 'ideas')
  await dragTo(page, moved, strip.x + strip.width - 40, strip.y + strip.height / 2)
  await expect(panes(page)).toHaveCount(1)
})

test('a split border drags, and the sizes survive a reload', async ({ page }) => {
  await openApp(page, 'panes-resize')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(2)

  const first = panes(page).first()
  const before = (await first.boundingBox())!.width
  const handle = page.locator('[data-testid^="pane-resize:"]').first()
  const hbox = (await handle.boundingBox())!
  await page.mouse.move(hbox.x + hbox.width / 2, hbox.y + hbox.height / 2)
  await page.mouse.down()
  await page.mouse.move(hbox.x + 160, hbox.y + hbox.height / 2, { steps: 10 })
  await page.mouse.up()
  const after = (await first.boundingBox())!.width
  expect(after).toBeGreaterThan(before + 100)

  // Put the caret somewhere findable before the reload: a tab resumes where it
  // was after a restart (R2.3), and the sizes are only half of what persists.
  // Which LINE the caret is on is the public, observable half of that — with
  // `drawSelection()` off, CM6 puts the caret in the browser's own selection.
  const caretLine = async (): Promise<number> => {
    const content = editors(page).first()
    // Focus without clicking: a click would move the caret to where it landed.
    await focusEditor(content)
    return content.evaluate((el) => {
      const node = el.ownerDocument.getSelection()?.anchorNode ?? null
      const from = node instanceof Element ? node : (node?.parentElement ?? null)
      const line = from?.closest('.cm-line')
      return line ? [...el.querySelectorAll('.cm-line')].indexOf(line) : -1
    })
  }
  await editors(page).first().click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  expect(await caretLine()).toBe(2)
  // A resume point is written on the save debounce; give it the beat it needs.
  await page.waitForTimeout(600)

  // Device-local, versioned, and pruned against the vault at boot (B6).
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(panes(page)).toHaveCount(2)
  const restored = (await panes(page).first().boundingBox())!.width
  expect(Math.abs(restored - after)).toBeLessThan(8)
  await expect(editors(page).first()).toBeVisible()
  await expect.poll(caretLine).toBe(2)
})

test('the same note in two panes edits both ways and shows one truth', async ({ page }) => {
  // An AUTHORISED room (seeded in start-relay.mjs): the other memory rooms are
  // rejected by design and their pills sit honestly at offline, which would
  // make the assertions below true without proving anything.
  await openApp(page, 'panes-sync', { token: 'panes-token' })
  await page.getByTestId(`file-item:${WELCOME}`).click()
  // A split duplicates the active note: one Y.Text, two views (Spike S9).
  await page.keyboard.press('Alt+=')
  await expect(editors(page)).toHaveCount(2)

  const left = editors(page).first()
  const right = editors(page).nth(1)
  await right.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('RIGHT-SIDE ')
  await expect(left).toContainText('RIGHT-SIDE')

  await left.click()
  await page.keyboard.press('ControlOrMeta+Home')
  await page.keyboard.type('LEFT-SIDE ')
  await expect(right).toContainText('LEFT-SIDE')

  // Two panes, one record, one pill state — golden rule 4 under N views (R4.2).
  // A CONCRETE value first: two pills both stuck on `offline` agree with each
  // other and say nothing about honesty.
  const focused = page.getByTestId('status-bar').getByTestId('sync-pill-note')
  const other = page.locator('[data-testid^="sync-pill-pane:"]')
  await expect(other).toHaveCount(1)
  await expect(focused).toHaveAttribute('data-status', 'green', { timeout: 20_000 })
  await expect(other).toHaveAttribute('data-status', 'green', { timeout: 20_000 })

  // Now stop the relay under both of them. Only the websockets are severed
  // (setOffline would block the dev server too), and ws routes only take
  // effect after a navigation — collab.spec.ts's own partition, with two panes
  // on the far side: each pane's pill tells its own truth, and both truths are
  // the same one because there is one record behind them.
  await page.routeWebSocket(/.*/, (ws) => ws.close())
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 20_000 })
  await expect(panes(page)).toHaveCount(2)
  await expect(focused).toHaveAttribute('data-status', 'offline', { timeout: 20_000 })
  await expect(other).toHaveAttribute('data-status', 'offline', { timeout: 20_000 })
})

test('deleting a note in the tree closes its tabs, in every pane', async ({ page }) => {
  await openApp(page, 'panes-delete')
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await page.keyboard.press('Alt+=')
  await expect(editors(page)).toHaveCount(2)

  await page.getByTestId(`file-item:${IDEAS}`).click({ button: 'right' })
  await page.getByTestId('tree-menu:delete').click()
  await page.getByTestId('tree-op-confirm').click()

  // The tabs go with the note, the panes settle, and nothing crashes (R5).
  await expect(page.locator('[data-slot-kind="tab"]', { hasText: 'ideas' })).toHaveCount(0, {
    timeout: 10_000,
  })
  await expect(page.getByTestId('file-tree')).toBeVisible()
})

test('the pane mode zooms and resizes from the keyboard, and says what it does', async ({
  page,
}) => {
  await openApp(page, 'panes-mode')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.keyboard.press('Alt+=')
  await expect(panes(page)).toHaveCount(2)

  // Mod+P is the leader; the corner cue (E6, Subtle) shows the live mode,
  // and `?` every key it has.
  await page.keyboard.press('ControlOrMeta+p')
  const bar = page.getByTestId('mode-cue')
  await expect(bar).toBeVisible()
  await expect(page.getByTestId('mode-badge')).toHaveText('PANE')
  await expect(bar).not.toContainText('Split down')
  await page.keyboard.press('?')
  await expect(page.getByTestId('mode-cue-all')).toContainText('Split down')

  // `f` zooms: one pane on screen, one live editor, and the status bar says so.
  await page.keyboard.press('f')
  await expect(panes(page)).toHaveCount(1)
  await expect(editors(page)).toHaveCount(1)
  await expect(page.getByTestId('pane-zoomed')).toBeVisible()
  // Pane mode is one-shot — the action put us back in the editor.
  await expect(bar).toHaveCount(0)

  // ...and `f` again restores the layout that was never taken apart.
  await page.keyboard.press('ControlOrMeta+p')
  await page.keyboard.press('f')
  await expect(panes(page)).toHaveCount(2)

  // The resize sub-mode is STICKY: one `s`, then `l` as many times as it takes.
  const before = (await panes(page).first().boundingBox())!.width
  await page.keyboard.press('ControlOrMeta+p')
  await page.keyboard.press('s')
  await expect(page.getByTestId('mode-badge')).toHaveText('RESIZE')
  await page.keyboard.press('l')
  await page.keyboard.press('l')
  await expect(page.getByTestId('mode-cue')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('mode-cue')).toHaveCount(0)
  const after = (await panes(page).first().boundingBox())!.width
  expect(after).toBeGreaterThan(before)
})

test('every open is a tab: the tree, Mod+click and the tab keys', async ({ page }) => {
  await openApp(page, 'panes-tabs')
  // The first open fills the empty tab a fresh pane starts with.
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(paneTabs(page)).toHaveCount(1)

  // Fork 1-B: a second note is a second tab, and it takes over.
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await expect(paneTabs(page)).toHaveCount(2)
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')

  // R3: opening it again activates the tab that is already there.
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(paneTabs(page)).toHaveCount(2)
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Welcome')

  // Ctrl+Tab / Ctrl+Shift+Tab — Obsidian's unrebound defaults.
  await page.keyboard.press('Control+Tab')
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')
  await page.keyboard.press('Control+Shift+Tab')
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Welcome')

  // Mod+W closes, Mod+Shift+T brings it back at its own place.
  await page.keyboard.press('ControlOrMeta+w')
  await expect(paneTabs(page)).toHaveCount(1)
  await page.keyboard.press('ControlOrMeta+Shift+t')
  await expect(paneTabs(page)).toHaveCount(2)

  // The strip is a real tablist: arrows move the roving tab stop.
  await paneTabs(page, { selected: true }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(paneTabs(page, { selected: false })).toBeFocused()
})

test('a dialog owns the keyboard: pane keys never reach the tabs behind it', async ({ page }) => {
  await openApp(page, 'panes-dialog-keys')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await page.getByTestId(`file-item:${IDEAS}`).click()
  await expect(paneTabs(page)).toHaveCount(2)

  // Settings is a tab now (settings-shaping ST1); Report a problem is a real
  // dialog with a field in it.
  await runCommand(page, 'Report a problem')
  await page.getByTestId('report-what').click()

  // `Mod+P` is the pane-mode leader, and a live mode preventDefaults every key
  // until Escape — so entering one from a text field ate the rest of what was
  // being typed. `Mod+W` acted on a tab nobody could see.
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByTestId('mode-badge')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+w')
  await expect(page.getByTestId('report-dialog')).toBeVisible()

  await page.getByTestId('report-cancel').click()
  await expect(page.getByTestId('report-dialog')).toHaveCount(0)
  await expect(paneTabs(page)).toHaveCount(2)
})

/**
 * The empty tab is a launcher, not a list (shell-polish P5). The thing worth
 * asserting is where the note lands: *New note* fills the tab you are standing
 * in, so the tab count must not move.
 */
test('the empty tab launches: Recent is folded, New note fills THIS tab', async ({ page }) => {
  await openApp(page, 'panes-launcher')
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(paneTabs(page)).toHaveCount(1)

  // Mod+t opens a second, empty tab — which is the launcher. Its testids are
  // per-pane, so the pane says its own id rather than the spec guessing.
  await page.keyboard.press('ControlOrMeta+t')
  await expect(paneTabs(page)).toHaveCount(2)
  const paneId = await page.locator('[data-pane-id]').first().getAttribute('data-pane-id')
  const launcher = page.getByTestId(`empty-tab:${paneId}`)
  await expect(launcher).toBeVisible()

  // Folded by default; unfolding shows the note this session has opened.
  const recent = launcher.locator('[data-testid$="-recent"]')
  await expect(recent).toHaveAttribute('aria-expanded', 'false')
  await expect(launcher.locator('[data-testid$="-row"]')).toHaveCount(0)
  await recent.click()
  await expect(recent).toHaveAttribute('aria-expanded', 'true')
  await expect(launcher.locator('[data-testid$="-row"]').first()).toContainText('welcome.md')

  // Typing swaps the disclosure for results, over the same matcher as Mod+O.
  await launcher.locator('[data-testid$="-input"]').fill('ideas')
  await expect(launcher.locator('[data-testid$="-recent"]')).toHaveCount(0)
  await expect(launcher.locator('[data-testid$="-row"]')).toHaveCount(1)
  await launcher.locator('[data-testid$="-input"]').fill('')

  // New note fills the tab it was launched from: still two tabs, and an editor.
  await launcher.locator('[data-testid$="-new"]').click()
  await expect(page.getByTestId('file-item:untitled-1.md')).toBeVisible()
  await expect(paneTabs(page)).toHaveCount(2)
  await expect(launcher).toHaveCount(0)
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toBeVisible()
})

test('a note dragged out of the navigator lands as a tab, a pane, or inside a group', async ({
  page,
}) => {
  // The bridge P1.2 builds: the tree is an HTML5 drag source, the strip is a
  // pointer-drag surface, and a row has to behave exactly like a tab.
  await openApp(page, 'panes-tree-drag')
  const spare = await newNote(page, 1)
  const joiner = await newNote(page, 2)
  await page.getByTestId(`file-item:${WELCOME}`).click()
  await expect(paneTabs(page)).toHaveCount(3)

  // Onto the trailing half of the last tab: past the end of the run, so the
  // note opens as a tab of its own at the end of the strip.
  const last = (await tabNamed(page, 'welcome').boundingBox())!
  await dragRowTo(
    page,
    page.getByTestId(`file-item:${IDEAS}`),
    last.x + last.width * 0.9,
    last.y + last.height / 2
  )
  await expect(paneTabs(page)).toHaveCount(4)
  await expect(page.getByTestId('editor-pane').locator('.cm-content')).toContainText('Ideas')

  // A FOLDER is not a note: the tree still drags it (that is how you move
  // one), but a pane is not a place it can land — there is no doc behind it,
  // and a tab for it would sit there under the folder's name showing the empty
  // launcher. Measured fresh, because the strip just grew a tab. Nothing is
  // asserted right here: "the count did not move" reads as true a beat before
  // the drop would have moved it, so the witness is the strip's contents after
  // the NEXT drop has settled, below.
  const onIdeas = (await tabNamed(page, 'ideas').boundingBox())!
  await dragRowTo(
    page,
    page.getByTestId('dir-item:notes'),
    onIdeas.x + onIdeas.width * 0.6,
    onIdeas.y + onIdeas.height / 2
  )

  // Onto a pane's right edge: a pane of its own beside the one it was dropped
  // on — `splitWith`, reached from the tree. The note is already a tab here,
  // so this is also R3: it MOVES rather than twinning.
  const box = (await panes(page).first().boundingBox())!
  await dragRowTo(
    page,
    page.getByTestId(`file-item:${spare}`),
    box.x + box.width * 0.92,
    box.y + box.height * 0.6
  )
  await expect(panes(page)).toHaveCount(2)
  // …and the folder above left nothing behind: a real change has landed since,
  // so the strip has been re-rendered and this is what it holds.
  await expect(page.locator('[data-slot-kind="tab"][data-path="notes"]')).toHaveCount(0)
  const moved = panes(page).nth(1).locator('[data-slot-kind="tab"]')
  await expect(moved).toHaveCount(1)
  await expect(moved).toContainText('untitled-1')
  await expect(panes(page).first().locator('[data-slot-kind="tab"]')).toHaveCount(3)

  // Group the *ideas* tab, so its single tab is both the head and the tail of
  // the run — the shape a drop from the right could not reach before P1.1.
  await tabNamed(page, 'ideas').click({ button: 'right' })
  await page.getByTestId('tab-menu:new-group').click()
  await page.getByTestId('group-name').fill('Edible')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('group-manage')).toHaveCount(0)
  const chip = page.locator('[data-testid^="group-chip:"]').first()
  await expect(chip).toHaveText(/Edible/)

  // Onto the TRAILING half of that grouped tab: inside the group.
  const grouped = (await tabNamed(page, 'ideas').boundingBox())!
  await dragRowTo(
    page,
    page.getByTestId(`file-item:${joiner}`),
    grouped.x + grouped.width * 0.85,
    grouped.y + grouped.height / 2
  )
  // Folding is what makes membership visible: both tabs go behind the chip,
  // which then counts them.
  await chip.click()
  await expect(chip).toHaveAttribute('aria-expanded', 'false')
  await expect(chip).toHaveText(/2/)
})

test('the new-tab + follows the last tab while the tabs fit, and docks left of the mode control once they overflow (Chris, 2026-10-06)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 700 })
  await page.goto(appUrl({ room: 'panes-new-tab', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')
  const plus = page.locator('[data-testid^="tab-new:"]')
  const tabs = page.getByRole('tab')
  await expect(plus).toHaveAttribute('data-docked', 'false')

  // Empty tabs until the run overflows; then a note in the last one, so the
  // strip has its mode control.
  for (let i = 0; i < 30 && (await plus.getAttribute('data-docked')) !== 'true'; i++) {
    const n = await tabs.count()
    await plus.click()
    await expect(tabs).toHaveCount(n + 1)
  }
  await expect(plus).toHaveAttribute('data-docked', 'true')
  await openByQuickOpen(page, 'ideas')
  const mode = page.locator('[data-testid^="tab-mode:"]').first()
  await expect(mode).toBeVisible()
  await expect(plus).toBeInViewport()
  const plusBox = (await plus.boundingBox())!
  const modeBox = (await mode.boundingBox())!
  expect(plusBox.x + plusBox.width).toBeLessThanOrEqual(modeBox.x)
  expect(plusBox.x).toBeGreaterThan(modeBox.x - 40)
  // Still a plain button on the keyboard, not a tab.
  await plus.focus()
  await expect(plus).toBeFocused()
  await expect(plus).not.toHaveAttribute('role', 'tab')

  // Close them again: it follows the last tab once they fit.
  for (let i = 0; i < 40 && (await plus.getAttribute('data-docked')) === 'true'; i++) {
    const n = await tabs.count()
    await tabs.first().click()
    await page.keyboard.press('ControlOrMeta+w')
    await expect(tabs).toHaveCount(n - 1)
  }
  await expect(plus).toHaveAttribute('data-docked', 'false')
  const last = (await tabs.last().boundingBox())!
  const after = (await plus.boundingBox())!
  expect(after.x).toBeGreaterThanOrEqual(last.x + last.width)
  expect(after.x).toBeLessThan(last.x + last.width + 40)
})

test('the unpinned navigator floats, not modal, over the panes below the strip: a row drags from it onto a pane; both floating panels stay open on a click into the editor (Chris, 2026-10-06)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(appUrl({ room: 'panes-float-nav', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')

  await page.keyboard.press('ControlOrMeta+ArrowLeft')
  const drawer = page.getByTestId('navigator-drawer')
  await expect(drawer).toBeVisible()
  // No modal: no dialog, no scrim. It floats over the pane's BODY, as the
  // dock's panel does: below the tab strip, above the area's foot.
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  const strip = (await page.locator('[data-strip]').first().boundingBox())!
  const area = (await page.getByTestId('editor-area').boundingBox())!
  await expect
    .poll(async () => (await drawer.boundingBox())!.y)
    .toBeGreaterThanOrEqual(strip.y + strip.height)
  const box = (await drawer.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height)

  // A floating section, not a menu: a click into the editor leaves it open —
  // and the dock's panel the same.
  await page.locator('.cm-content').first().click()
  await expect(drawer).toBeVisible()
  await page.getByTestId('rail-icon:links').click()
  const dockPanel = page.getByTestId('dock-panel')
  await expect(dockPanel).toBeVisible()
  await page.locator('.cm-content').first().click()
  await expect(drawer).toBeVisible()
  await expect(dockPanel).toBeVisible()
  await page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(dockPanel).toHaveCount(0)

  // A row onto the pane's right edge: a pane of its own beside it.
  const pane = (await panes(page).first().boundingBox())!
  await dragRowTo(page, drawer.getByTestId(`file-item:${IDEAS}`), pane.x + pane.width * 0.92, pane.y + pane.height * 0.6)
  await expect(panes(page)).toHaveCount(2)

  // Escape from inside closes it, focus back on the files button; the key reopens it.
  if (!(await drawer.isVisible())) await page.keyboard.press('ControlOrMeta+ArrowLeft')
  await expect(drawer).toBeVisible()
  await drawer.getByTestId(`file-item:${IDEAS}`).focus()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(page.getByTestId('toggle-tree')).toBeFocused()
})

test('Control+Shift+T reopens a closed tab in the default layout — from the editor, and from the empty tab a lone close leaves (Chris, 2026-10-06)', async ({
  page,
}) => {
  await page.goto(appUrl({ room: 'quiet-sync', token: 'quiet-token', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  const tabs = page.getByRole('tab')
  await openByQuickOpen(page, 'welcome')
  await page.locator('[data-testid^="tab-new:"]').click()
  await openByQuickOpen(page, 'ideas')
  await expect(tabs).toHaveCount(2)

  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+w')
  await expect(tabs).toHaveCount(1)
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('Control+Shift+t')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.filter({ hasText: 'ideas' })).toHaveAttribute('aria-selected', 'true')

  // Down to one tab, closed: the empty tab's picker holds the focus — the tab
  // keys still reach the panes from there.
  await page.keyboard.press('ControlOrMeta+w')
  await expect(tabs).toHaveCount(1)
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+w')
  await expect(tabs.filter({ hasText: 'welcome' })).toHaveCount(0)
  const picker = page.getByTestId('editor-area').locator('input').first()
  await picker.focus()
  await page.keyboard.press('Control+Shift+t')
  await expect(tabs.filter({ hasText: 'welcome' })).toHaveCount(1)
})

test('pane keys (E6): Subtle sits in the corner above the word count, ? opens every key, Full is the bar', async ({
  page,
}) => {
  // The default layout (not the fixtures' `dense`): the count floats in the corner.
  await page.goto(appUrl({ room: 'panes-cue', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')
  await editors(page).first().click()
  await expect(page.getByTestId('corner-status')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+p')
  const line = page.getByTestId('mode-cue-line')
  await expect(line).toBeVisible()
  await expect(line).toHaveAttribute('role', 'status')
  await expect(page.getByTestId('mode-bar')).toHaveCount(0)
  // Directly above the count, right-aligned with it.
  const cue = (await line.boundingBox())!
  const count = (await page.getByTestId('corner-status').boundingBox())!
  expect(cue.y + cue.height).toBeLessThanOrEqual(count.y + 1)
  expect(Math.abs(cue.x + cue.width - (count.x + count.width))).toBeLessThanOrEqual(2)
  // The cue stands clear of the format bar, and `?` moves neither the line nor the bar.
  const bar = page.getByTestId('format-bar')
  const barBefore = (await bar.boundingBox())!
  if (cue.y < barBefore.y + barBefore.height && cue.y + cue.height > barBefore.y) {
    expect(cue.x - (barBefore.x + barBefore.width)).toBeGreaterThanOrEqual(12)
  }
  await page.keyboard.press('?')
  await expect(page.getByTestId('mode-cue-all')).toBeVisible()
  expect((await bar.boundingBox())!.x).toBeCloseTo(barBefore.x, 0)
  expect((await line.boundingBox())!.width).toBeCloseTo(cue.width, 0)
  await page.keyboard.press('?')
  await expect(page.getByTestId('mode-cue-all')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(line).toHaveCount(0)

  // Full: today's bar along the bottom, and no corner cue.
  await openSettings(page, 'layout')
  await page.getByTestId('layout-field:hints').selectOption('full')
  await closeSettings(page)
  await editors(page).first().click()
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.getByTestId('mode-bar')).toBeVisible()
  await expect(page.getByTestId('mode-cue')).toHaveCount(0)
  await page.keyboard.press('Escape')
})

test('in a split the format bar and the corner float over the focused pane, and fold to its width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.goto(appUrl({ room: 'panes-float', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')
  await editors(page).first().click()
  await splitRight(page)
  const bar = page.getByTestId('format-bar')
  // Inside the pane (shifted off-centre only to make room for the corner on
  // its row), and the corner at the pane's own right edge.
  const floatsIn = async (n: number) => {
    const pane = (await panes(page).nth(n).boundingBox())!
    const b = (await bar.boundingBox())!
    const c = (await page.getByTestId('corner-status').boundingBox())!
    return (
      b.x >= pane.x &&
      b.x + b.width <= pane.x + pane.width &&
      c.x + c.width <= pane.x + pane.width &&
      c.x + c.width > pane.x + pane.width - 24
    )
  }
  // The new (right) pane has focus; the bar sits in it, not over the divider.
  await expect.poll(() => floatsIn(1)).toBe(true)
  await editors(page).first().click()
  await expect.poll(() => floatsIn(0)).toBe(true)
  // A pane narrower than the bar's 30rem folds it into the one Format menu.
  const handle = page.locator('[data-testid^="pane-resize:"]').first()
  const h = (await handle.boundingBox())!
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
  await page.mouse.down()
  await page.mouse.move(h.x - 300, h.y + h.height / 2, { steps: 10 })
  await page.mouse.up()
  await editors(page).first().click()
  await expect(page.getByTestId('toolbar-format-menu')).toBeVisible()
  await editors(page).nth(1).click()
  await expect(page.getByTestId('toolbar-format-menu')).toBeHidden()
})
