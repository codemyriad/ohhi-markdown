/**
 * E2 — lists, tasks, quotes and the editing keys, in the real surface:
 * the caret stays on the text side of a bullet on the frame after Tab, Tab off
 * a list is a tab (Escape-then-Tab still leaves), a lone `-` under a
 * paragraph is a faint bullet rather than a heading, brackets pair (quotes do
 * not) and `*` wraps a selection, the `> ` on the caret's line does not move
 * the text, and a task's box is measured against Chris's screenshot.
 *
 * Decoration-level rules (what is drawn where) are unit-tested in
 * libs/editor-lang; this file holds what only layout and the DOM caret show.
 */
import { expect, test, type Page } from '@playwright/test'
import { expectAccessible, paneContent as content, seedReadNote } from './fixtures.js'

type View = {
  state: {
    selection: { main: { head: number } }
    doc: { length: number; toString(): string; lineAt(p: number): { from: number } }
  }
  dispatch(spec: { changes: { from: number; to: number; insert: string }; selection: { anchor: number } }): void
  focus(): void
}
const viewOf = (el: Element): View => {
  const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view
  if (!view) throw new Error('no CodeMirror view behind this .cm-content')
  return view
}

/** The document, as the view holds it. */
const docText = (page: Page) => content(page).evaluate((el) => {
  const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view
  return view?.state.doc.toString() ?? ''
})

/**
 * Replace the document through the view and put the caret at its end — no
 * keyboard. WebKit intermittently dropped text typed after `Ctrl+End` /
 * `insertText`, so a test whose subject is not those keys seeds this way.
 */
const setDoc = (page: Page, text: string) =>
  content(page).evaluate((el, text) => {
    const view = (el as unknown as { cmTile?: { root?: { view?: View } } }).cmTile?.root?.view
    if (!view) throw new Error('no CodeMirror view behind this .cm-content')
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: text.length } })
    view.focus()
  }, text)

test('Tab on a nested item: the DOM caret is right of the bullet on every frame', async ({ page }) => {
  // Chris, 2026-10-10: on Tab the caret flashed before the bullet for a frame.
  await seedReadNote(page, 'edit-tab-caret', '- a\n\t- b\n\t- c')
  const editor = content(page)
  await expect(editor.locator('.cm-bullet')).toHaveCount(3)

  // Record, on every animation frame from before the key until a few after
  // the edit, where the browser's own selection is relative to the bullet on
  // the caret's line. drawSelection is off: this IS the caret people see.
  await page.evaluate(() => {
    const log: { text: string; after: boolean; left: number | null; right: number }[] = []
    ;(window as unknown as { __caret: typeof log }).__caret = log
    let frames = 0
    const tick = () => {
      const sel = getSelection()
      const node = sel?.focusNode
      if (node && sel) {
        const el = node.nodeType === 1 ? (node as Element) : node.parentElement
        const line = el?.closest('.cm-line')
        const bullet = line?.querySelector('.cm-bullet')
        if (line && bullet) {
          const at = document.createRange()
          at.setStart(node, sel.focusOffset)
          // ≤ 0: the point just after the bullet is at or before the caret.
          const parent = bullet.parentNode!
          const index = Array.prototype.indexOf.call(parent.childNodes, bullet) as number
          const after = at.comparePoint(parent, index + 1) <= 0
          const rect = sel.rangeCount ? sel.getRangeAt(0).getClientRects()[0] : undefined
          log.push({
            text: line.textContent ?? '',
            after,
            left: rect ? rect.left : null,
            right: bullet.getBoundingClientRect().right,
          })
        }
      }
      if (++frames < 40) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.keyboard.press('Tab')
  await expect.poll(() => docText(page)).toBe('- a\n\t- b\n\t\t- c')
  await page.waitForFunction(() => (window as unknown as { __caret: unknown[] }).__caret.length >= 20)
  const log = await page.evaluate(
    () => (window as unknown as { __caret: { text: string; after: boolean; left: number | null; right: number }[] }).__caret
  )
  const nested = log.filter((f) => f.text.startsWith('\t\t'))
  expect(nested.length, 'frames after the edit').toBeGreaterThan(0)
  for (const f of nested) {
    expect(f.after, `caret before the bullet on a frame: ${JSON.stringify(f)}`).toBe(true)
    if (f.left !== null) expect(f.left).toBeGreaterThanOrEqual(f.right - 1)
  }
  // And typing lands in the item's text.
  await page.keyboard.type('!')
  await expect.poll(() => docText(page)).toBe('- a\n\t- b\n\t\t- c!')
})

test('Tab off a list is a tab; Shift+Tab takes it back; Escape then Tab leaves the editor', async ({ page }) => {
  await seedReadNote(page, 'edit-tab-paragraph', 'plain')
  const editor = content(page)
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await expect(editor).toBeFocused()
  await expect.poll(() => docText(page)).toBe('\tplain')
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => docText(page)).toBe('plain')
  // CM6's tab-focus mode: Escape, then Tab moves focus on.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Tab')
  await expect(editor).not.toBeFocused()
  expect(await docText(page)).toBe('plain')
})

test('a lone `-` under a paragraph is a faint bullet, not a heading, until it is one', async ({ page }) => {
  await seedReadNote(page, 'edit-setext', 'A paragraph\n')
  await setDoc(page, 'A paragraph\n')
  await expect.poll(() => docText(page)).toBe('A paragraph\n')
  const editor = content(page)
  const para = editor.locator('.cm-line', { hasText: 'A paragraph' })
  const size = () => para.evaluate((el) => {
    const span = el.querySelector('span') ?? el
    return parseFloat(getComputedStyle(span).fontSize)
  })
  const body = parseFloat(await editor.evaluate((el) => getComputedStyle(el).fontSize))

  await page.keyboard.type('-')
  await expect(para).toHaveClass(/cm-setext-provisional/)
  expect(await size()).toBeCloseTo(body, 0)
  await expect(editor.locator('.cm-bullet-provisional')).toHaveCount(1)
  await page.keyboard.type(' ')
  expect(await size()).toBeCloseTo(body, 0)
  await expect(editor.locator('.cm-bullet-provisional')).toHaveCount(1)
  const faint = await editor.locator('.cm-bullet').boundingBox()
  await page.keyboard.type('item')
  // A real item now: same place, not faint, and the paragraph never grew.
  await expect(editor.locator('.cm-bullet-provisional')).toHaveCount(0)
  await expect(editor.locator('.cm-bullet')).toHaveCount(1)
  const real = await editor.locator('.cm-bullet').boundingBox()
  expect(Math.abs(real!.x - faint!.x)).toBeLessThanOrEqual(1)
  expect(await size()).toBeCloseTo(body, 0)

  // `---` under a paragraph, caret elsewhere: the heading it parses as.
  await setDoc(page, 'Heading\n---\n\nafter')
  await expect.poll(() => docText(page)).toBe('Heading\n---\n\nafter')
  const heading = editor.locator('.cm-line', { hasText: 'Heading' })
  await expect(heading).not.toHaveClass(/cm-setext-provisional/)
  const h2 = await heading.evaluate((el) => parseFloat(getComputedStyle(el.querySelector('span') ?? el).fontSize))
  expect(h2).toBeGreaterThan(body * 1.1)
})

test('brackets pair, quotes do not, and `*` wraps a selection', async ({ page }) => {
  await seedReadNote(page, 'edit-brackets', 'x')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type("(it's")
  await expect.poll(() => docText(page)).toBe("(it's)")
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.type('[[')
  await expect.poll(() => docText(page)).toBe('[[]]')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('make bold')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.type('**')
  await expect.poll(() => docText(page)).toBe('make **bold**')
})

test('the `> ` on the caret\'s line hangs: the quote\'s text does not move', async ({ page }) => {
  await seedReadNote(page, 'edit-quote', '> first line\n> second line\n\nafter')
  const editor = content(page)
  const left = (text: string) =>
    editor.locator('.cm-line', { hasText: text }).evaluate((el, t) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(t.split(' ')[0])
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        return r.getBoundingClientRect().left
      }
      return NaN
    }, text)
  // Caret on `after`: both quote lines have their markers hidden.
  const hidden = await left('second line')
  await editor.locator('.cm-line', { hasText: 'second line' }).click()
  await expect(editor.locator('.cm-quote-hang')).toHaveCount(1)
  expect(Math.abs((await left('second line')) - hidden)).toBeLessThanOrEqual(1)
  // Upright, not italic.
  const style = await editor
    .locator('.cm-line', { hasText: 'first line' })
    .evaluate((el) => getComputedStyle(el.querySelector('span') ?? el).fontStyle)
  expect(style).toBe('normal')
  await expectAccessible(page, 'a quote with its marker revealed')
})

test('a task box is the measured native box, and its text lines up with a bullet\'s', async ({ page }) => {
  await seedReadNote(page, 'edit-tasks', '- bullet\n- [ ] open task\n- [x] done task\n\nafter')
  const editor = content(page)
  const box = editor.locator('input.cm-task').first()
  await expect(editor.locator('input.cm-task')).toHaveCount(2)
  const m = await box.evaluate((el) => {
    const cs = getComputedStyle(el)
    const line = el.closest('.cm-line')!
    const font = parseFloat(getComputedStyle(line).fontSize)
    return {
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
      font,
      appearance: cs.appearance,
      border: cs.borderTopWidth,
      radius: parseFloat(cs.borderTopLeftRadius),
      bg: cs.backgroundColor,
    }
  })
  expect(m.appearance).toBe('none')
  expect(m.width).toBeCloseTo(m.font * 0.9, 0)
  expect(m.height).toBeCloseTo(m.font * 0.9, 0)
  expect(m.border).toBe('1px')
  expect(m.radius).toBeGreaterThan(1)
  expect(m.radius).toBeLessThan(3)
  expect(m.bg).toBe('rgba(0, 0, 0, 0)')

  // Text start: a task's and a sibling bullet's, within a pixel.
  const textLeft = (text: string) =>
    editor.locator('.cm-line', { hasText: text }).evaluate((el, t) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent!.indexOf(t)
        if (i < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        return r.getBoundingClientRect().left
      }
      return NaN
    }, text)
  expect(Math.abs((await textLeft('open task')) - (await textLeft('bullet')))).toBeLessThanOrEqual(1.5)
  // Box to text: about half an em.
  const gap = (await textLeft('open task')) - (await box.boundingBox())!.x - m.width
  expect(gap).toBeGreaterThan(m.font * 0.4)
  expect(gap).toBeLessThan(m.font * 0.6)

  // Done: filled, its text muted and struck.
  const done = editor.locator('.cm-task-done')
  await expect(done).toHaveText('done task')
  expect(await done.evaluate((el) => getComputedStyle(el).textDecorationLine)).toBe('line-through')
  const checked = editor.locator('input.cm-task').nth(1)
  expect(await checked.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)')
  await expectAccessible(page, 'tasks in Live')
})
