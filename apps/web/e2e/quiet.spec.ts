/**
 * The quiet default (foundations Stage 2, quiet-shell F3/F5/F6/F7, spike S21;
 * round 2 P1/P2; round 3 Q2/Q4/Q5): the shell a new install sees. NOT forcing `dense` — every
 * test boots the device's own choice (`layout: null`), which on a fresh
 * profile is `light`.
 */
import { expect, test, type Page } from '@playwright/test'
import {
  appUrl,
  closeSettings,
  openSettings,
  dismissToasts,
  dragTo,
  editors,
  expectAccessible,
  openApp,
  openByQuickOpen,
  paneContent,
  paneScroller,
  panes,
  severableRelay,
  splitRight,
  strips,
} from './fixtures.js'

test.describe('toolbar and focus', () => {
  const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'Note toolbar' })
  const formatBar = (page: Page) => page.getByRole('toolbar', { name: 'Formatting' })
  const corner = (page: Page) => page.getByTestId('corner-status')

  async function boot(page: Page, room: string): Promise<void> {
    await page.goto(appUrl({ room, layout: null }))
    await expect(toolbar(page)).toBeVisible({ timeout: 15_000 })
  }

  test('light boots to one toolbar: no navigator, no rail, and the tab strip with one note', async ({ page }) => {
    await boot(page, 'quiet-boot')
    await expect(toolbar(page).getByTestId('toggle-tree')).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('navigator')).toHaveCount(0)
    await expect(page.locator('[data-testid="right-rail"][data-state="expanded"]')).toHaveCount(0)
    // No breadcrumb header in this layout: the toolbar IS the banner.
    await expect(page.getByRole('banner').getByRole('toolbar')).toBeVisible()
    await expect(page.getByTestId('toggle-rail')).toHaveCount(0)
    // P1: arrows at the left, nothing in the centre with no note, and no "No note open" anywhere.
    await expect(toolbar(page).getByTestId('nav:back')).toBeDisabled()
    await expect(toolbar(page).getByTestId('nav:forward')).toBeDisabled()
    await expect(toolbar(page).getByTestId('toolbar-title')).toHaveCount(0)
    await expect(page.getByRole('banner')).not.toContainText('No note open')

    await openByQuickOpen(page, 'welcome')
    await expect(paneContent(page)).toBeVisible()
    // Chris, 2026-10-06: the strip from one note, its + right after the tab.
    await expect(strips(page)).toHaveCount(1)
    await expect(page.getByRole('tab')).toHaveCount(1)
    const tab = (await page.getByRole('tab').boundingBox())!
    const plus = (await page.locator('[data-testid^="tab-new:"]').boundingBox())!
    expect(plus.x).toBeGreaterThanOrEqual(tab.x + tab.width)
    expect(plus.x).toBeLessThan(tab.x + tab.width + 40)
    // Merged readouts: the toolbar carries the note's pill; the words moved to
    // the corner (Q4) and the mode menu to the tab strip (Q5).
    await expect(toolbar(page).getByTestId('sync-pill-note')).toBeVisible()
    await expect(toolbar(page).getByTestId('word-count')).toHaveCount(0)
    await expect(toolbar(page).getByTestId('mode-menu')).toHaveCount(0)
    await expect(corner(page).getByTestId('word-count')).toBeVisible()
    // Chris, 2026-10-06: nothing in the centre — the strip's tab names the note.
    await expect(toolbar(page).getByTestId('toolbar-title')).toHaveCount(0)
    await expect(page.getByRole('tab', { selected: true })).toContainText('welcome')
    await expect(toolbar(page).getByTestId('breadcrumb')).toHaveCount(0)
    await expectAccessible(page, 'quiet default, one note')

    // One tab stop, arrows move along the bar (the toolbar pattern).
    await toolbar(page).getByTestId('toggle-tree').focus()
    await page.keyboard.press('ArrowRight')
    await expect(toolbar(page).getByTestId('toggle-tree')).toHaveAttribute('tabindex', '-1')
    await page.keyboard.press('Home')
    await expect(toolbar(page).getByTestId('toggle-tree')).toBeFocused()
  })

  test('format.bold on the format bar bolds the selection, and the word count follows the selection', async ({
    page,
  }) => {
    await boot(page, 'quiet-bold')
    await openByQuickOpen(page, 'welcome')
    await paneContent(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('hello quiet world')
    await expect(corner(page).getByTestId('word-count')).toHaveText('3 words')
    // Q4: Obsidian's corner — words and characters, one line.
    await expect(corner(page)).toHaveText('3 words · 17 characters')
    for (let i = 0; i < 'world'.length; i++) await page.keyboard.press('Shift+ArrowLeft')
    await expect(corner(page).getByTestId('word-count')).toHaveText('1 word')
    await expect(corner(page).getByTestId('char-count')).toHaveText('5 characters')

    await formatBar(page).getByTestId('toolbar:format.bold').click()
    await expect(paneContent(page)).toContainText('hello quiet **world**')
    // The caret is back in the text it formatted.
    await expect(paneContent(page)).toBeFocused()
  })

  test('the format bar floats over the editor, bottom centre, with the corner on its row — and never covers the last line', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await boot(page, 'quiet-format-bottom')
    await openByQuickOpen(page, 'welcome')
    await expect(formatBar(page)).toBeVisible()
    await expect(toolbar(page).getByTestId('toolbar:format.bold')).toHaveCount(0)
    // Q2: a pill INSIDE the editor area, not a bar docked under it.
    const bar = page.getByTestId('format-bar')
    await expect(bar).toHaveAttribute('data-position', 'bottom')
    await expect(page.getByTestId('editor-area').getByTestId('format-bar')).toHaveCount(1)
    const area = (await page.getByTestId('editor-area').boundingBox())!
    const box = (await bar.boundingBox())!
    const header = (await toolbar(page).boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height)
    expect(box.y + box.height).toBeGreaterThan(area.y + area.height - 40)
    expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThan(4)
    expect(header.y + header.height).toBeLessThanOrEqual(area.y + 1)
    // Q4: the corner sits on the same row, right-aligned, clear of the bar.
    const cornerBox = (await corner(page).boundingBox())!
    expect(cornerBox.x).toBeGreaterThanOrEqual(box.x + box.width)
    expect(cornerBox.x + cornerBox.width).toBeGreaterThan(area.x + area.width - 24)
    expect(Math.abs(cornerBox.y + cornerBox.height - (box.y + box.height))).toBeLessThan(6)
    // Every format command is a button of its own at this width.
    await expect(formatBar(page).getByTestId('toolbar:format.italic')).toBeVisible()
    await expect(formatBar(page).getByTestId('toolbar:format.paragraph-style')).toBeVisible()
    await expectAccessible(page, 'the floating format bar and the corner')

    // The scroller makes room for it: at the foot of a long note, the last
    // line ends above the bar.
    await paneContent(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText(`${'a line\n'.repeat(80)}the very last line`)
    await page.keyboard.press('ControlOrMeta+End')
    const pad = await paneScroller(page).evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))
    expect(pad).toBeGreaterThanOrEqual(box.height)
    const last = (await page.locator('.cm-line', { hasText: 'the very last line' }).boundingBox())!
    const barNow = (await bar.boundingBox())!
    expect(last.y + last.height).toBeLessThanOrEqual(barNow.y)
  })

  test('at a narrow width the format bar folds into one Format menu', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 720 })
    await boot(page, 'quiet-narrow')
    await openByQuickOpen(page, 'welcome')
    await expect(formatBar(page).getByTestId('toolbar:format.bold')).toBeHidden()
    await formatBar(page).getByTestId('toolbar-format-menu').click()
    const list = page.getByTestId('toolbar-format-menu-list')
    await expect(list.getByTestId('toolbar-menu:format.bold')).toContainText('Bold')
    await expect(list.getByTestId('toolbar-menu:format.heading-2')).toBeVisible()
    await expectAccessible(page, 'narrow toolbar, Format menu open')
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
  })

  test('view.focus hides everything but the toolbar, and Escape restores it', async ({ page }) => {
    await boot(page, 'quiet-focus')
    await openByQuickOpen(page, 'welcome')
    // A second tab (Mod+click in the drawer), so there is a strip to hide.
    await toolbar(page).getByTestId('toggle-tree').click()
    await page.getByTestId('navigator-drawer').getByTestId('file-item:notes/ideas.md').click({ modifiers: ['ControlOrMeta'] })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
    await expect(strips(page)).toHaveCount(1)
    await paneContent(page).click()

    await page.keyboard.press('ControlOrMeta+.')
    await expect(toolbar(page)).toBeVisible()
    await expect(toolbar(page).getByTestId('leave-focus')).toBeVisible()
    await expect(strips(page)).toHaveCount(0)
    // The default's Focus keeps the format bar (Chris: "just the open notes in
    // view and maybe a formatting bar"), still floating; the strip, the
    // navigator and the corner's counts go.
    await expect(formatBar(page)).toBeVisible()
    await expect(page.getByTestId('format-bar')).toHaveAttribute('data-position', 'bottom')
    await expect(corner(page)).toHaveCount(0)
    await expect(page.getByTestId('navigator')).toHaveCount(0)
    await expectAccessible(page, 'focus mode')

    await paneContent(page).click()
    await page.keyboard.press('Escape')
    await expect(toolbar(page).getByTestId('leave-focus')).toHaveCount(0)
    await expect(strips(page)).toHaveCount(1)
    await expect(formatBar(page)).toBeVisible()
    await expect(corner(page)).toBeVisible()
  })

  test('with the toolbar hidden too, the way out is one Tab away', async ({ page }) => {
    // dense keeps its header in Focus mode, so its Focus mode has no toolbar.
    await openApp(page, 'quiet-focus-dense')
    await expect(page.getByTestId('navigator')).toBeVisible()
    await page.keyboard.press('ControlOrMeta+.')
    await expect(page.getByTestId('navigator')).toHaveCount(0)
    const leave = page.getByTestId('leave-focus')
    await leave.focus()
    await expect(leave).toBeVisible()
    await expect(leave).toHaveAccessibleName('Leave Focus mode (Esc)')
    await expectAccessible(page, 'focus mode, no toolbar')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('navigator')).toBeVisible()
  })

  test('with the toolbar at the bottom it docks under the panes, the format bar and the mode bar above it', async ({
    page,
  }) => {
    await boot(page, 'quiet-bottom')
    await openByQuickOpen(page, 'welcome')

    await openSettings(page, 'layout')
    // Q6: the form edits the device's layout live; closing keeps it.
    await page.getByTestId('layout-field:toolbar').selectOption('bottom')
    // E6: the full mode bar is the *Full* pane-keys setting (Subtle, the default, is the corner).
    await page.getByTestId('layout-field:hints').selectOption('full')
    await closeSettings(page)

    await expect(toolbar(page)).toHaveAttribute('data-position', 'bottom')
    const area = (await page.getByTestId('editor-area').boundingBox())!
    const bar = (await toolbar(page).boundingBox())!
    expect(bar.y).toBeGreaterThanOrEqual(area.y + area.height - 1)
    // Q2: the format bar floats inside the editor area, above the bottom toolbar.
    const format = (await formatBar(page).boundingBox())!
    expect(format.y + format.height).toBeLessThanOrEqual(area.y + area.height)
    expect(format.y + format.height).toBeLessThanOrEqual(bar.y + 1)
    await expectAccessible(page, 'bottom toolbar')

    await paneContent(page).click()
    await page.keyboard.press('ControlOrMeta+p')
    const mode = page.getByTestId('mode-bar')
    await expect(mode).toBeVisible()
    const modeBox = (await mode.boundingBox())!
    const barNow = (await toolbar(page).boundingBox())!
    const formatNow = (await formatBar(page).boundingBox())!
    expect(modeBox.y + modeBox.height).toBeLessThanOrEqual(barNow.y + 1)
    // …and the floating bar stays over the panes, above the mode bar.
    expect(formatNow.y + formatNow.height).toBeLessThanOrEqual(modeBox.y + 1)
    // The mode bar never replaces the toolbar, and it is still announced.
    await expect(toolbar(page)).toBeVisible()
    await expect(mode).toHaveAttribute('role', 'status')
    await expectAccessible(page, 'bottom toolbar with the mode bar')
    await page.keyboard.press('Escape')
    await expect(mode).toHaveCount(0)
  })

  test('format bar "top" floats under the tab strip, centred, and the scroller makes room for it', async ({ page }) => {
    await boot(page, 'quiet-format-top')
    await openByQuickOpen(page, 'welcome')
    await openSettings(page, 'layout')
    await page.getByTestId('layout-field:format').selectOption('top')
    await closeSettings(page)

    const bar = page.getByTestId('format-bar')
    await expect(bar).toHaveAttribute('data-position', 'top')
    const area = (await page.getByTestId('editor-area').boundingBox())!
    const header = (await toolbar(page).boundingBox())!
    // The tab strip is drawn by default (`regions.tabs: "always"`), so the
    // bar hangs directly under it — the strip's tabs stay reachable — not
    // under the header itself. The layer re-measures a frame after a change:
    // poll until it sits one gap (8 px) below the strip.
    const strip = page.locator('[data-testid="editor-area"] [data-strip]').first()
    await expect(strip).toBeVisible()
    const stripBox = (await strip.boundingBox())!
    expect(stripBox.y).toBeGreaterThanOrEqual(header.y + header.height - 1)
    await expect.poll(async () => Math.round((await bar.boundingBox())!.y - (stripBox.y + stripBox.height))).toBe(8)
    const box = (await bar.boundingBox())!
    expect(Math.abs(box.x + box.width / 2 - (area.x + area.width / 2))).toBeLessThan(4)
    // The scroller's top padding is the bar's height plus its gap above and
    // below, so the note's first line starts clear of the bar.
    const scroller = paneScroller(page)
    await expect
      .poll(async () => Math.round(await scroller.evaluate((el) => parseFloat(getComputedStyle(el).paddingTop))))
      .toBe(Math.round(box.height + 16))
    const scrollerTop = (await scroller.boundingBox())!.y
    expect(scrollerTop).toBeLessThanOrEqual(box.y)
    expect(box.y + box.height).toBeLessThanOrEqual(scrollerTop + box.height + 16)
    // The corner stays at the bottom right on its own.
    const cnr = (await corner(page).boundingBox())!
    expect(cnr.y).toBeGreaterThan(box.y + box.height)
    await expectAccessible(page, 'the format bar under the header')
  })

  test('at 480 px the header keeps its arrows, a truncated title and its right end, with nothing overflowing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 720 })
    await boot(page, 'quiet-480')
    await openByQuickOpen(page, 'welcome')
    // A note with a name no narrow header can show, made from a link.
    const LONG = 'A note whose name is far too long for any narrow header to show'
    await paneContent(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText(`see [[${LONG}]]`)
    // Unresolved: Mod+click creates the note and follows the link in place.
    await page.locator('.cm-wikilink-unresolved').first().click({ modifiers: ['ControlOrMeta'] })

    // The name lives on the strip's tab now (Chris, 2026-10-06), truncated there.
    const title = page.getByRole('tab', { selected: true }).locator('.truncate')
    await expect(title).toHaveText(LONG)
    await expect(title).toBeVisible()
    await expect(toolbar(page).getByTestId('toolbar-title')).toHaveCount(0)
    // Truncated, not wrapped and not pushing anything out.
    expect(await title.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    expect(await title.evaluate((el) => getComputedStyle(el).textOverflow)).toBe('ellipsis')
    await expect(toolbar(page).getByTestId('toggle-tree')).toBeVisible()
    await expect(toolbar(page).getByTestId('nav:back')).toBeVisible()
    await expect(toolbar(page).getByTestId('nav:forward')).toBeVisible()
    await expect(toolbar(page).getByTestId('drawer-bell')).toBeVisible()
    // Narrow: the folded bar shifts over so the corner keeps its row — never on it.
    const fmt = (await page.getByTestId('format-bar').boundingBox())!
    const cnr = (await corner(page).boundingBox())!
    expect(cnr.y + cnr.height <= fmt.y || cnr.x >= fmt.x + fmt.width).toBe(true)
    expect(cnr.x + cnr.width).toBeLessThanOrEqual(480)

    const overflow = await page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('[data-testid="toolbar"]')!
      return {
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bar: bar.scrollWidth - bar.clientWidth,
      }
    })
    expect(overflow).toEqual({ page: 0, bar: 0 })
    const right = (await toolbar(page).getByTestId('toolbar-right').boundingBox())!
    const left = (await toolbar(page).getByTestId('toolbar-left').boundingBox())!
    expect(right.x + right.width).toBeLessThanOrEqual(480)
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1)
    await expectAccessible(page, 'the header at 480 px')

    // The arrows walk the tab's trail: follow a link from here, then back.
    await paneContent(page).click()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.insertText('back to [[welcome]]')
    await page.locator('.cm-wikilink').first().click({ modifiers: ['ControlOrMeta'] })
    await expect(title).toHaveText('welcome')
    await expect(toolbar(page).getByTestId('nav:back')).toBeEnabled()
    await expect(toolbar(page).getByTestId('nav:forward')).toBeDisabled()
    await toolbar(page).getByTestId('nav:back').click()
    await expect(title).toHaveText(LONG)
    await expect(toolbar(page).getByTestId('nav:forward')).toBeEnabled()
  })
})

/**
 * The pane chrome in the default layout (spike S21, foundations Stage 2b):
 * no strip until a pane holds two tabs, the focus edge only when there are
 * two panes to tell apart, opens that replace the note in place, and the
 * unfocused pane's own sync dot once the status bars are merged.
 */
test.describe('panes', () => {
  const WELCOME = 'notes/welcome.md'
  const IDEAS = 'notes/ideas.md'

  /** The default layout: no `?layout=`, so no navigator column to wait for. */
  async function bootDefault(page: Page, room: string, token?: string): Promise<void> {
    await page.goto(appUrl({ room, layout: null, ...(token ? { token } : {}) }))
    await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  }

  /** The shared scan, after dismissing an unseeded room's relay-refusal toast: the scan is of the panes. */
  async function axe(page: Page, surface: string): Promise<void> {
    await dismissToasts(page)
    await expectAccessible(page, surface)
  }

  /** The drawer, by the sidebar key; a row in it, clicked (optionally Mod+click). */
  async function openFromDrawer(page: Page, path: string, background = false): Promise<void> {
    const drawer = page.getByTestId('navigator-drawer')
    if (!(await drawer.isVisible())) await page.keyboard.press('ControlOrMeta+ArrowLeft')
    await expect(drawer).toBeVisible()
    await drawer.getByTestId(`file-item:${path}`).click({ modifiers: background ? ['ControlOrMeta'] : [] })
  }

  const edgeIn = (page: Page, n: number) => page.getByTestId(`pane:${n}`).getByTestId('pane-focus-edge')

  test('one note has the strip, its + right after the tab; tabs: auto hides it until a second tab', async ({ page }) => {
    await bootDefault(page, 'quiet-strip')
    await openFromDrawer(page, WELCOME)
    await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
    // The default (Chris, 2026-10-06): a strip for one note, so a new tab is one click.
    await expect(strips(page)).toHaveCount(1)
    await expect(page.getByRole('tab')).toHaveCount(1)
    const plus = page.locator('[data-testid^="tab-new:"]')
    const tabBox = (await page.getByRole('tab').boundingBox())!
    expect((await plus.boundingBox())!.x).toBeGreaterThanOrEqual(tabBox.x + tabBox.width)
    await plus.click()
    await expect(page.getByRole('tab')).toHaveCount(2)
    await page.keyboard.press('ControlOrMeta+w')
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(strips(page)).toHaveCount(1)
    await axe(page, 'one note, the strip')

    // Settings › Layout › Tabs: auto — the strip only from two tabs.
    await openSettings(page, 'layout')
    await page.getByTestId('layout-field:tabs').selectOption('auto')
    await closeSettings(page)
    // Opening in place closes the drawer: its job is done.
    await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
    await expect(editors(page)).toContainText('Welcome')
    await expect(strips(page)).toHaveCount(0)
    await expect(page.getByRole('tab')).toHaveCount(0)
    // No strip, so no tablist: the body is a plain region, never a dangling tabpanel.
    await expect(page.getByRole('tabpanel')).toHaveCount(0)
    await axe(page, 'one note, no strip')

    // Mod+click is still a new tab — in the background, so the drawer stays.
    await openFromDrawer(page, IDEAS, true)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
    await expect(strips(page)).toHaveCount(1)
    await expect(page.getByRole('tab')).toHaveCount(2)
    await axe(page, 'two tabs, the strip')

    await page.keyboard.press('ControlOrMeta+w')
    await expect(page.getByRole('tab')).toHaveCount(0)
    await expect(strips(page)).toHaveCount(0)
  })

  test('opening from the drawer replaces the note in place: still one tab', async ({ page }) => {
    await bootDefault(page, 'quiet-replace')
    await openFromDrawer(page, WELCOME)
    await expect(editors(page)).toContainText('Welcome')
    await openFromDrawer(page, IDEAS)
    await expect(page.getByTestId('navigator-drawer')).toHaveCount(0)
    await expect(editors(page)).not.toContainText('Welcome')
    await expect(page.getByRole('tab')).toHaveCount(1)
    await expect(panes(page)).toHaveCount(1)
  })

  test('the drawer is accessible, and Escape closes it', async ({ page }) => {
    await bootDefault(page, 'quiet-drawer')
    await page.keyboard.press('ControlOrMeta+ArrowLeft')
    const drawer = page.getByTestId('navigator-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByTestId('navigator')).toBeVisible()
    await expect(drawer.getByTestId('file-tree')).toBeVisible()
    await axe(page, 'the navigator drawer')
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  })

  test('the dock replaces the Note menu: a strip over the editor, its panel on the sidebar key, no rail column', async ({
    page,
  }) => {
    await bootDefault(page, 'quiet-note-menu')
    await expect(page.getByTestId('right-rail')).toHaveCount(0)
    await openFromDrawer(page, WELCOME)
    // Round 2 P4: nothing in the toolbar opens it any more.
    await expect(page.getByTestId('note-menu-button')).toHaveCount(0)
    await expect(page.getByTestId('dock')).toBeVisible()
    // Mod+ArrowRight, the sidebar toggle, opens the dock's panel here.
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    const panel = page.getByTestId('dock-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('rail-tab:links')).toBeVisible()
    await expect(panel.getByTestId('rail-tab:history')).toBeVisible()
    await expect(panel.getByTestId('rail-pin')).toBeVisible()
    await axe(page, 'the dock panel')
    await page.keyboard.press('ControlOrMeta+ArrowRight')
    await expect(panel).toHaveCount(0)
    await expect(page.getByTestId('dock')).toBeVisible()
  })

  test('a split draws the focus edge on the focused pane, and it follows Alt+arrows', async ({ page }) => {
    await bootDefault(page, 'quiet-edge')
    await openFromDrawer(page, WELCOME)
    // One pane: nothing to tell apart, so no mark.
    await expect(page.getByTestId('pane-focus-edge')).toHaveCount(0)

    await splitRight(page)
    await expect(strips(page)).toHaveCount(2)
    await expect(page.getByTestId('pane-focus-edge')).toHaveCount(1)
    await expect(edgeIn(page, 2)).toHaveCount(1)
    await axe(page, 'two panes, the focus edge')

    await page.keyboard.press('Alt+ArrowLeft')
    await expect(edgeIn(page, 1)).toHaveCount(1)
    await expect(edgeIn(page, 2)).toHaveCount(0)
    await page.keyboard.press('Alt+ArrowRight')
    await expect(edgeIn(page, 2)).toHaveCount(1)
    await expect(edgeIn(page, 1)).toHaveCount(0)
  })

  test('with the relay gone, the unfocused pane says so itself', async ({ page }) => {
    // An AUTHORISED room (start-relay.mjs): a real green first, or the dot
    // below would prove nothing.
    await bootDefault(page, 'quiet-sync', 'quiet-token')
    await openFromDrawer(page, WELCOME)
    await splitRight(page)
    await expect(page.getByTestId('sync-pill-note')).toHaveAttribute('data-status', 'green', { timeout: 20_000 })
    // Green panes carry nothing: the toolbar's pill speaks for the focused one.
    await expect(page.locator('[data-testid^="pane-sync-dot:"]')).toHaveCount(0)

    // The pane layout is written on a debounce: let the split land first.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((k) => k.startsWith('editor:workspace:'))
            .some((k) => (localStorage.getItem(k)?.match(/"kind":"pane"/g) ?? []).length >= 2)
        )
      )
      .toBe(true)
    // collab.spec.ts's partition: sever only the websockets, then reload.
    await severableRelay(page, { severed: true })
    await page.reload()
    await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 20_000 })
    await expect(panes(page)).toHaveCount(2)
    const dot = page.locator('[data-testid^="pane-sync-dot:"]')
    await expect(dot).toHaveCount(1)
    await expect(dot).toHaveAttribute('data-status', 'offline', { timeout: 20_000 })
    // ...on the pane that is NOT focused: the one with the edge carries none.
    const focusedPane = panes(page).filter({ has: page.getByTestId('pane-focus-edge') })
    await expect(focusedPane).toHaveCount(1)
    await expect(focusedPane.locator('[data-testid^="pane-sync-dot:"]')).toHaveCount(0)
    await axe(page, 'the off-focus sync dot')
  })
})

/**
 * The lone tab's handle (spike S21 Q2, Chris 2026-10-06): the toolbar no
 * longer names the note — the default draws the tab strip from one note, so
 * its tab is what a pointer drags the note by and where its menu opens.
 */
test.describe('the lone tab', () => {
  const lone = (page: Page) => page.getByRole('tab', { selected: true })
  async function bootWithNote(page: Page, room: string): Promise<void> {
    await page.goto(appUrl({ room, layout: null }))
    await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
    await openByQuickOpen(page, 'welcome')
    await expect(paneContent(page)).toContainText('Welcome')
    // Close the unseeded room's relay-refusal toast: it can sit over a drop zone.
    await dismissToasts(page)
  }

  test('the toolbar has no title; dragging the lone tab onto a pane edge splits there', async ({ page }) => {
    await bootWithNote(page, 'quiet-title-drag')
    await expect(page.getByTestId('toolbar-title')).toHaveCount(0)
    await splitRight(page)
    await expect(strips(page)).toHaveCount(2)

    // The focused (right) pane's tab onto the LEFT pane's bottom edge: a new
    // pane under it, and the emptied right pane goes.
    const left = (await panes(page).first().boundingBox())!
    const right = panes(page).last().getByRole('tab', { selected: true })
    await dragTo(page, right, left.x + left.width / 2, left.y + left.height * 0.9)
    await expect(panes(page)).toHaveCount(2)
    const [top, bottom] = [(await panes(page).nth(0).boundingBox())!, (await panes(page).nth(1).boundingBox())!]
    expect(Math.abs(top.x - bottom.x)).toBeLessThan(2)
    expect(bottom.y).toBeGreaterThan(top.y + top.height / 2)
  })

  test('the lone tab opens the tab menu on right-click', async ({ page }) => {
    await bootWithNote(page, 'quiet-title-menu')
    const menu = page.getByTestId('tab-menu')
    await lone(page).click({ button: 'right' })
    await expect(menu).toBeVisible()
    await expect(menu.getByTestId('tab-menu:pin')).toBeVisible()
    await expect(menu.getByTestId('tab-menu:new-group')).toBeVisible()
    await expectAccessible(page, 'the tab menu from the lone tab')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
  })
})
