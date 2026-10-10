/**
 * Pictures in a note (editor-usability E5), driven the way they arrive: a
 * synthetic paste and a synthetic drop carrying a real PNG, the way a
 * screenshot tool and a file manager hand one over. The file lands in the
 * vault under Obsidian's name, the note gains `![[…]]`, and the embed draws
 * the bytes. A remote `![alt](https://…)` asks the network for nothing until
 * a person presses *Load image*.
 */
import { expect, test, type Page } from '@playwright/test'
import { paneContent as content, seedReadNote } from './fixtures.js'

/** A 4×4 red PNG. */
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGP4z8AARwzEcQCukw/x0F8jngAAAABJRU5ErkJggg=='

/** Fire `type` on the editor with a DataTransfer holding one PNG named `name`. */
async function fireWithPng(page: Page, type: 'paste' | 'dragover' | 'drop', name: string): Promise<void> {
  await content(page).evaluate(
    (el, { type, name, b64 }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], name, { type: 'image/png' }))
      const box = el.getBoundingClientRect()
      const at = { clientX: box.left + 20, clientY: box.top + 10 }
      const event =
        type === 'paste'
          ? new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
          : new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true, ...at })
      el.dispatchEvent(event)
    },
    { type, name, b64: PNG_B64 }
  )
}

test('a pasted picture is saved under Obsidian’s name, embedded, and drawn', async ({ page }) => {
  await seedReadNote(page, 'images-paste', 'A note with a picture:\n\n')
  await fireWithPng(page, 'paste', 'image.png')

  // The file is a vault file now, in the tree, at the vault root (Obsidian's
  // default with no `attachmentFolderPath`), named by the clock.
  const row = page.locator('[data-testid^="file-item:Pasted image "]')
  await expect(row).toHaveCount(1)
  const path = (await row.getAttribute('data-testid'))!.slice('file-item:'.length)
  expect(path).toMatch(/^Pasted image \d{14}\.png$/)
  // The caret sits after the link, so the line shows its source…
  await expect(content(page)).toContainText(`![[${path}]]`)

  // …and off it, the bytes are drawn.
  await content(page).getByText('A note with a picture:').click()
  const img = page.locator('[data-testid="editor-pane"] .cm-embed img')
  await expect(img).toBeVisible()
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(4)
})

test('dragging a picture over a note shows where it goes; dropping it keeps its name', async ({ page }) => {
  await seedReadNote(page, 'images-drop', 'Dropped here\n')
  await fireWithPng(page, 'dragover', 'diagram.png')
  const overlay = page.getByTestId('drop-overlay')
  await expect(overlay).toContainText('Drop to add to this note')
  await expect(overlay).toContainText('Saved in the vault root')

  await fireWithPng(page, 'drop', 'diagram.png')
  await expect(overlay).toHaveCount(0)
  await expect(page.getByTestId('file-item:diagram.png')).toBeVisible()
  await expect(content(page)).toContainText('![[diagram.png]]')
})

test('a remote image asks the network for nothing until Load image is pressed', async ({ page }) => {
  const asked: string[] = []
  page.on('request', (req) => {
    if (req.url().includes('example.invalid')) asked.push(req.url())
  })
  await seedReadNote(page, 'images-remote', '![logo](https://example.invalid/logo.png)\n\nafter\n')
  const placeholder = page.locator('[data-testid="editor-pane"] .cm-embed-remote')
  await expect(placeholder).toContainText('Image from example.invalid')
  await expect(placeholder.getByRole('button', { name: 'Load image' })).toBeVisible()
  expect(asked).toEqual([])

  // The host does not exist, so the load is refused — and says so in place.
  await placeholder.getByRole('button', { name: 'Load image' }).click()
  await expect(placeholder).toContainText("example.invalid didn't let this image load here")
  expect(asked.length).toBeGreaterThan(0)
})
