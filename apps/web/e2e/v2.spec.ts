/**
 * V2 acceptance: the Look, Navigate and Link slices, driven the way a person
 * drives them. Runs against the memory vault contract the L2 smoke already
 * uses, so it needs no real folder and no share.
 */
import { expect, test, type Page } from '@playwright/test'
import { appUrl, openApp, openByQuickOpen, severableRelay, splitRight } from './fixtures.js'

async function type(page: Page, text: string): Promise<void> {
  const content = page.locator('[data-testid="editor-pane"] .cm-content')
  await content.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
}

test('quick-open finds a note by fuzzy path and opens it', async ({ page }) => {
  await openApp(page, 'v2-qo')
  await page.keyboard.press('ControlOrMeta+o')
  await expect(page.getByTestId('quick-open-input')).toBeVisible()
  await page.getByTestId('quick-open-input').fill('ideas')
  await expect(page.getByTestId('quick-open-row').first()).toContainText('notes/ideas.md')
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-testid="editor-pane"] .cm-content')).toContainText('Ideas')
})

test('search answers from the local index, with snippets', async ({ page }) => {
  await openApp(page, 'v2-search')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await page.getByTestId('search-input').fill('relay')
  const rows = page.getByTestId('search-row')
  await expect(rows.first()).toBeVisible()
  await expect(rows.first()).toContainText('notes/welcome.md')
  // The snippet is the point: results carry context, not just filenames.
  await expect(rows.first()).toContainText('relay')
})

test('search reflects an edit without a reload', async ({ page }) => {
  await openApp(page, 'v2-fresh')
  await page.getByTestId('file-item:notes/ideas.md').click()
  await type(page, 'zebracrossing is a very unlikely word')
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await page.getByTestId('search-input').fill('zebracrossing')
  await expect(page.getByTestId('search-row').first()).toContainText('notes/ideas.md')
})

test('wikilinks resolve, click through, and unresolved ones create the note', async ({ page }) => {
  await openApp(page, 'v2-links')
  await page.getByTestId('file-item:notes/ideas.md').click()
  await type(page, 'see [[welcome]] and [[Brand New Note]]\n')

  // Resolved vs unresolved get different decorations — a broken link is a
  // data-integrity signal, not decoration.
  await expect(page.locator('.cm-wikilink').first()).toBeVisible()
  await expect(page.locator('.cm-wikilink-unresolved').first()).toBeVisible()

  // Outgoing links panel splits them the same way.
  await expect(page.getByTestId('outgoing-link:welcome')).toBeVisible()
  await expect(page.getByTestId('unresolved-link:Brand New Note')).toBeVisible()

  // The rule the Read slice settled (R2.4): where live preview has RENDERED a
  // link there is no `[[` to put a caret in, so a plain click follows it.
  const editor = page.locator('[data-testid="editor-pane"] .cm-content')
  await page.locator('.cm-wikilink').first().click()
  await expect(editor).toContainText('Welcome to Editor')
  await page.getByTestId('file-item:notes/ideas.md').click()

  // Where the brackets are text — the caret's own line — a plain click still
  // places the caret and Mod-click is what navigates, because a link you can
  // see the markup of is a link you are editing. (`press` rather than `click`
  // to get there: a click in a rendered note is itself a navigation, which is
  // the rule under test.)
  await editor.press('ControlOrMeta+Home')
  await expect(editor).toContainText('[[welcome]]')
  const raw = page.locator('.cm-wikilink').first()
  await raw.click()
  await expect(editor).toContainText('Brand New Note')
  await raw.click({ modifiers: ['ControlOrMeta'] })
  await expect(editor).toContainText('Welcome to Editor')
  await page.getByTestId('file-item:notes/ideas.md').click()

  // Click-through from the panel needs no modifier.
  await page.getByTestId('outgoing-link:welcome').click()
  await expect(page.locator('[data-testid="editor-pane"] .cm-content')).toContainText(
    'Welcome to Editor'
  )
  // ...and the backlink appears from the other side.
  await expect(page.getByTestId('backlink-source:notes/ideas.md')).toBeVisible()

  // Creating from an unresolved link makes a real note and opens it.
  await page.getByTestId('file-item:notes/ideas.md').click()
  await page.getByTestId('unresolved-link:Brand New Note').click()
  await expect(page.getByTestId('file-item:notes/Brand New Note.md')).toBeVisible()
})

test('the theme drives chrome and editor together, and survives a reload', async ({ page }) => {
  await openApp(page, 'v2-theme')
  await page.getByTestId('file-item:notes/welcome.md').click()

  const surfaceOf = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-testid="editor-pane"] .cm-editor')
      return el ? getComputedStyle(el).backgroundColor : ''
    })

  await page.getByTestId('open-settings').click()
  await page.getByTestId('settings-tab:appearance').click()
  await page.getByTestId('theme-nord-dark').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord-dark')
  // Nord's --background-primary, resolved through --ed-surface into CM6.
  expect(await surfaceOf()).toBe('rgb(46, 52, 64)')

  await page.getByTestId('settings-close').click()
  await page.reload()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'nord-dark')

  await page.getByTestId('file-item:notes/welcome.md').click()
  expect(await surfaceOf()).toBe('rgb(46, 52, 64)')
})

test('a theme cannot repaint or hide the sync icon', async ({ page }) => {
  await openApp(page, 'v2-honesty')
  // foundations-plan P5: the one sync readout is the Shared view's glyph,
  // its STROKE the state — on the svg and on every shape inside it.
  await page.getByTestId('file-item:notes/welcome.md').click()
  const icon = page.getByTestId('sync-pill-note')
  await expect(icon).toHaveAttribute('data-status', /.+/)
  const paint = () =>
    page.evaluate(() => {
      const svg = document.querySelector('[data-testid="sync-pill-note"] > .ed-sync-icon')
      if (!svg) return null
      const shape = svg.querySelector('path, circle')!
      const s = getComputedStyle(svg)
      const p = getComputedStyle(shape)
      return {
        stroke: s.stroke,
        shape: p.stroke,
        fill: p.fill,
        shown: s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0' && p.display !== 'none',
      }
    })
  const before = await paint()
  expect(before).not.toBeNull()
  expect(before!.shown).toBe(true)
  // The glyph and its shapes say the same thing.
  expect(before!.shape).toBe(before!.stroke)

  // Attack 1: the tokens, on :root and [data-theme]. Layer priority handles it.
  // Attack 2: the tokens on BODY — custom properties INHERIT, and cascade
  // layers only settle same-element conflicts, so nothing above would apply.
  // Attack 3: the glyph's own class, the lucide classes every icon carries,
  // and the shapes inside it — a stroke set on a CHILD beats an inherited one.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = `@layer editor.user {
      :root, [data-theme] { --ed-sync-ok:#f0f; --ed-sync-pending:#f0f; --ed-sync-diverged:#f0f; --ed-sync-offline:#f0f; }
      body, * { --ed-sync-ok:#f0f; --ed-sync-pending:#f0f; --ed-sync-diverged:#f0f; --ed-sync-offline:#f0f; }
      .ed-sync-icon, .lucide, svg { stroke:#f0f; fill:#f0f; opacity:0; visibility:hidden; }
      .lucide path, .lucide circle, svg * { stroke:#f0f; fill:#f0f; display:none; }
      [data-testid="sync-pill-note"] svg { display:none; }
    }`
    document.head.append(style)
  })
  const after = await paint()
  expect(after).toEqual(before)
  expect(after!.stroke).not.toBe('rgb(255, 0, 255)')
  expect(after!.fill).toBe('none')
  // `!important` is deliberately NOT attempted here: for important
  // declarations layer order reverses, so a layered important rule outranks
  // every unlayered one and no CSS-only defence exists. That case is handled
  // one step earlier — sanitizeThemeCss strips `!important`, the sync tokens
  // and any pill-targeting rule before injection (apps/web/src/lib/theme.test.ts).
})

test('a theme cannot hide the DEFAULT layout’s toolbar pill or an off-focus pane dot', async ({ page }) => {
  // The relay severed from the start: nothing goes green, so the unfocused
  // pane of a split carries its own dot (quiet-shell F6).
  await severableRelay(page, { severed: true })
  await page.goto(appUrl({ room: 'v2-honesty-default', layout: null }))
  await expect(page.getByTestId('editor-area')).toBeVisible({ timeout: 15_000 })
  await openByQuickOpen(page, 'welcome')
  await splitRight(page)
  // The default toolbar carries `note.pill` (no `vault.pill`: that host's
  // testid is covered by the sanitizer's unit test, theme.test.ts).
  const surfaces = ['sync-pill-note']
  for (const id of surfaces) await expect(page.getByTestId(id)).toBeVisible()
  const dot = page.locator('[data-testid^="pane-sync-dot:"]')
  await expect(dot).toHaveCount(1)
  await expect(dot).toBeVisible()
  const colours = () =>
    page.evaluate(() =>
      [
        ...[...document.querySelectorAll('[data-status] > .ed-sync-dot')].map((d) => getComputedStyle(d).backgroundColor),
        ...[...document.querySelectorAll('[data-status] > .ed-sync-icon')].map((d) => getComputedStyle(d).stroke),
      ]
    )
  const before = await colours()

  // Injected straight into the user layer — past the sanitizer — so this is
  // the CASCADE defence alone: hide each pill's own element, recolour and
  // hide every dot by class and by status.
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = `@layer editor.user {
      [data-testid="toolbar-vault-pill"], [data-testid="sync-pill-note"], [data-testid^="pane-sync-dot"] { display:none; }
      [data-status] { display:none; }
      [data-status] > .ed-sync-dot, .ed-sync-dot { display:none; background-color:#f0f; }
      [data-status] > .ed-sync-icon, .ed-sync-icon, .ed-sync-icon * { display:none; stroke:#f0f; }
    }`
    document.head.append(style)
  })
  for (const id of surfaces) await expect(page.getByTestId(id)).toBeVisible()
  await expect(dot).toBeVisible()
  expect(await colours()).toEqual(before)
  expect(before).not.toContain('rgb(255, 0, 255)')
})

test('search Enter lands the caret on the matching line, not the top', async ({ page }) => {
  await openApp(page, 'v2-reveal')
  await page.getByTestId('file-item:notes/welcome.md').click()
  await type(page, ['alpha', '', '', '', '', '', '', '', 'zebracrossing lives here'].join('\n'))
  await page.keyboard.press('ControlOrMeta+Shift+f')
  await page.getByTestId('search-input').fill('zebracrossing')
  await page.getByTestId('search-row').first().click()
  // The caret is on the match, not at offset 0 — typing lands there.
  await page.keyboard.type('X')
  await expect(page.locator('[data-testid="editor-pane"] .cm-content')).toContainText(
    'Xzebracrossing'
  )
})

test("Mod+[ and Mod+] walk the tab's own trail", async ({ page }) => {
  // Fork 4 (tab-groups): history is per TAB, not per window — with four
  // panes, "back" jumping you to another pane would be a surprise. Opening a
  // note is a new tab with a trail of its own; following a `[[link]]` is the
  // one navigation that stays in the tab, so it is what makes a trail.
  await openApp(page, 'v2-history')
  const editor = page.locator('[data-testid="editor-pane"] .cm-content')
  await page.getByTestId('file-item:notes/ideas.md').click()
  await type(page, 'see [[welcome]]\n')
  await page.locator('.cm-wikilink').first().click({ modifiers: ['ControlOrMeta'] })
  await expect(editor).toContainText('Welcome to Editor')

  await page.keyboard.press('ControlOrMeta+[')
  // Back in the note that links out — and in Live the link reads as its
  // target, not as its brackets.
  await expect(editor).toContainText('see welcome')
  await page.keyboard.press('ControlOrMeta+]')
  await expect(editor).toContainText('Welcome to Editor')
})

test('the word count is present and selection-aware of the open note', async ({ page }) => {
  await openApp(page, 'v2-words')
  await expect(page.getByTestId('word-count')).toHaveCount(0)
  await page.getByTestId('file-item:notes/ideas.md').click()
  await type(page, 'one two three four five')
  await expect(page.getByTestId('word-count')).toHaveText('5 words')
})

test('the tree context menu renames, and drag-and-drop rearranges', async ({ page }) => {
  await openApp(page, 'v2-tree')

  // Right-click a file row: files get rename/move/delete and no sharing.
  await page.getByTestId('file-item:notes/ideas.md').click({ button: 'right' })
  await expect(page.getByTestId('tree-context-menu')).toBeVisible()
  await expect(page.getByTestId('tree-menu:share')).toHaveCount(0)
  await page.getByTestId('tree-menu:rename').click()
  await page.getByTestId('tree-op-name').fill('thoughts.md')
  await page.getByTestId('tree-op-confirm').click()
  await expect(page.getByTestId('file-item:notes/thoughts.md')).toBeVisible()

  // Drag it out to the tree's root area, then back into the folder.
  await page.dragAndDrop(
    '[data-testid="file-item:notes/thoughts.md"]',
    '[data-testid="tree-root"]',
    { targetPosition: { x: 30, y: 320 } }
  )
  await expect(page.getByTestId('file-item:thoughts.md')).toBeVisible()
  await page.dragAndDrop('[data-testid="file-item:thoughts.md"]', '[data-testid="dir-item:notes"]')
  await expect(page.getByTestId('file-item:notes/thoughts.md')).toBeVisible()

  // The memory contract attaches the relay to the ROOT mount, so this vault is
  // shared as a whole — which since depth-1 nesting (device-link N1, shaping
  // A5) no longer blocks folder shares: the root mount is the one mount that
  // may contain mounts, so Share… is offered, not refused. Folder-in-folder
  // nesting is still refused, and the menu still SAYS SO rather than hiding
  // the item (the hidden rule is what this menu replaced).
  await page.getByTestId('dir-item:notes').click({ button: 'right' })
  await expect(page.getByTestId('tree-menu:share')).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByTestId('tree-menu-reason:share')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tree-context-menu')).toHaveCount(0)
})

test('the command palette lists commands with their bindings', async ({ page }) => {
  await openApp(page, 'v2-cmd')
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await expect(page.getByTestId('command-palette-input')).toBeVisible()
  await page.getByTestId('command-palette-input').fill('search')
  const row = page.getByTestId('command-palette-row').first()
  await expect(row).toContainText('Search in vault')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('search-input')).toBeVisible()
})
