/**
 * The writing harness end to end (writing-harness-build §Wave 2 › F), over
 * the scripted LLM (`libs/testkit`'s mock server, one turn per request):
 *
 *  - quiet by default: no provider → no `ai.*` command, no Session view;
 *    Settings › AI is the one surface, and it says where words go;
 *  - a provider added through Settings, *Test connection* listing the mock's models;
 *  - `Mod+Shift+L` on a selection → a session with the chip; a tool-calling
 *    turn reads the vault and answers;
 *  - a scripted `ohhi_patch` → a suggestion in the note, accepted with `Mod+Enter`;
 *  - a comment sent to the agent → its reply in the thread.
 */
import { expect, type Page } from '@playwright/test'
import { closeSettings, openApp, openSettings, paneContent, seedProvider, selectLine, test } from './fixtures.js'

const NOTE = 'notes/welcome.md'
const LINE = 'CRDT and syncs through the relay to anyone else in the room.'

/** The palette's rows for `query`, as their command ids. */
async function paletteIds(page: Page, query: string): Promise<string[]> {
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill(query)
  await expect(page.getByTestId('command-palette-input')).toHaveValue(query)
  const ids = await page
    .getByTestId('command-palette-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-row-id') ?? ''))
  await page.keyboard.press('Escape')
  return ids
}

async function openAiSettings(page: Page): Promise<void> {
  await openSettings(page, 'ai')
  await expect(page.getByTestId('ai-settings')).toBeVisible()
}

async function openNote(page: Page): Promise<void> {
  await page.getByTestId(`file-item:${NOTE}`).click()
  await expect(paneContent(page)).toContainText(LINE)
}

type EditorView = { state: { doc: { toString(): string } }; dispatch(tr: unknown): void; focus(): void }

/** The focused note's document text (not its DOM, which also draws widgets: suggestions, carets). */
function docText(page: Page): Promise<string> {
  return paneContent(page).evaluate((el) => {
    const view = (el as unknown as { cmTile?: { root?: { view?: EditorView } } }).cmTile?.root?.view
    return view ? view.state.doc.toString() : ''
  })
}

/** Put the note's caret right after the first `text`, through CodeMirror's own view. */
async function caretAfter(page: Page, text: string): Promise<void> {
  await paneContent(page).evaluate((el, text) => {
    const view = (el as unknown as { cmTile?: { root?: { view?: EditorView } } }).cmTile?.root?.view
    if (!view) throw new Error('caretAfter: no CodeMirror view')
    const at = view.state.doc.toString().indexOf(text)
    if (at === -1) throw new Error(`caretAfter: no “${text}” in the note`)
    view.dispatch({ selection: { anchor: at + text.length } })
    view.focus()
  }, text)
}

/** Send `text` from the open session's composer. */
async function send(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('session-composer-input')
  await expect(input).toBeVisible()
  await input.click()
  await page.keyboard.type(text)
  await page.getByTestId('session-send').click()
}

test('quiet by default: no provider, no AI command and no Session view; Settings › AI says where words go', async ({ page }) => {
  await openApp(page, 'harness-quiet')
  for (const query of ['', 'AI', 'session', 'skill']) {
    const ids = await paletteIds(page, query)
    expect(ids.filter((id) => id.startsWith('ai.') || id === 'app.session'), `palette “${query}”`).toEqual([])
  }
  // Comments are not an AI feature: offered with a note open, provider or not.
  await openNote(page)
  expect(await paletteIds(page, 'comment')).toContain('note.comment')
  await expect(page.getByTestId('session-view')).toHaveCount(0)

  await openAiSettings(page)
  await expect(page.getByTestId('ai-settings-egress')).not.toBeEmpty()
  await expect(page.getByTestId('ai-providers-empty')).toBeVisible()
})

test('a provider added in Settings › AI: Test connection lists the mock’s models, and the AI commands appear', async ({ page, mockLlm }) => {
  const mock = await mockLlm([], { models: ['mock-model', 'mock-large'] })
  await openApp(page, 'harness-provider')
  await openAiSettings(page)
  await page.getByTestId('ai-provider-add').click()
  await page.getByTestId('ai-provider-name').fill('Mock')
  await page.getByTestId('ai-provider-kind').selectOption('openai-compatible')
  await page.getByTestId('ai-provider-base-url').fill(`${mock.url}/v1`)
  await page.getByTestId('ai-provider-model').fill('mock-model')
  await page.getByTestId('ai-provider-test').click()
  const result = page.getByTestId('ai-provider-test-result')
  await expect(result).toHaveAttribute('data-ok', 'true')
  await expect(result).toContainText('mock-model')
  await expect(result).toContainText('mock-large')
  expect(mock.requests.map((r) => r.wire)).toEqual(['models'])

  await page.getByTestId('ai-provider-save').click()
  await expect(page.locator('[data-testid^="ai-provider:"]')).toHaveCount(1)
  await closeSettings(page)
  const ids = await paletteIds(page, 'AI')
  expect(ids).toEqual(expect.arrayContaining(['ai.add-selection', 'app.session']))
})

test('Mod+Shift+L on a selection opens a session with its chip; a tool-calling turn reads the vault and answers', async ({ page, mockLlm }) => {
  const mock = await mockLlm([
    { toolCall: { name: 'ohhi_search', args: { query: 'relay', limit: 5 } } },
    { text: 'The welcome note says edits sync through the relay.' },
  ])
  await seedProvider(page, `${mock.url}/v1`)
  await openApp(page, 'harness-session')
  await openNote(page)
  await selectLine(page, LINE)
  await page.keyboard.press('ControlOrMeta+Shift+l')

  await expect(page.getByTestId('session-view')).toBeVisible()
  const chip = page.getByTestId('mention-chip')
  await expect(chip).toHaveCount(1)
  await expect(chip).toContainText('welcome')

  await send(page, 'What does this say about sync?')
  const card = page.locator('[data-testid="tool-card"][data-tool="ohhi_search"]')
  await expect(card).toHaveAttribute('data-state', 'output-available', { timeout: 15_000 })
  await expect(card.getByTestId('tool-hits')).toContainText(NOTE)
  await expect(page.getByTestId('session-markdown').last()).toContainText('edits sync through the relay')
  await expect(page.getByTestId('session-run-status')).toHaveAttribute('data-status', 'successful')

  // The model got the selection as a reference, and the search's result on its second turn.
  const [first, second] = mock.requests.filter((r) => r.wire === 'openai')
  expect(first.system).toContain(`### ${NOTE} (`)
  expect(first.system).toContain(LINE)
  expect(second.toolResults[0].output).toContain(NOTE)
})

test('a scripted ohhi_patch lands as a suggestion in the note; Mod+Enter accepts it and the readout names the agent', async ({ page, mockLlm }) => {
  const OLD = 'the pill goes offline honestly'
  const NEW = 'the pill goes offline, honestly'
  const mock = await mockLlm([
    { toolCall: { name: 'ohhi_patch', args: { path: NOTE, old: OLD, new: NEW } } },
    { text: 'Proposed a comma before “honestly”.' },
  ])
  // The dense status bar, with the agent's last write in it (a device override, as Settings › Layout writes).
  await seedProvider(page, `${mock.url}/v1`, {
    layout: { overrides: { bars: { statusbar: ['pane.lead', '|', 'words', 'mode', 'last-agent-write', 'sync'] } } },
  })
  await openApp(page, 'harness-propose')
  await openNote(page)
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill('Open AI session')
  await expect(page.locator('[data-testid="command-palette-row"][data-row-id="app.session"]')).toBeVisible()
  await page.keyboard.press('Enter')
  await send(page, 'Add a comma before honestly.')

  // The transcript links to the note; the suggestion is reviewed THERE.
  const card = page.locator('[data-testid="tool-card"][data-tool="ohhi_patch"]')
  await expect(card).toHaveAttribute('data-state', 'output-available', { timeout: 15_000 })
  await card.getByTestId('tool-open').click()
  // In the note: the comma drawn as a proposed insertion; the text itself unchanged.
  const added = page.locator('[data-testid="editor-pane"] .ed-suggest-add')
  await expect(added.first()).toBeVisible()
  await expect(added.first()).toHaveText(',')
  expect(await docText(page)).toContain(OLD)

  // The caret on the suggestion (where the comma goes), then Mod+Enter.
  await caretAfter(page, 'the pill goes offline')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(added).toHaveCount(0)
  await expect.poll(() => docText(page)).toContain(NEW)
  await expect(page.getByTestId('last-agent-write')).toContainText('welcome')
})

test('a comment sent to the agent gets its reply in the thread', async ({ page, mockLlm }) => {
  const mock = await mockLlm([{ text: 'It means every keystroke is shared with the room.' }])
  await seedProvider(page, `${mock.url}/v1`)
  await openApp(page, 'harness-comment')
  await openNote(page)
  await selectLine(page, LINE)
  await page.keyboard.press('ControlOrMeta+Shift+m')
  const bubble = page.getByTestId('comment-bubble')
  await expect(bubble).toBeVisible()
  await bubble.getByTestId('comment-body').fill('What does this mean in practice?')
  await bubble.getByTestId('comment-send-agent').check()
  await bubble.getByTestId('comment-submit').click()
  await expect(bubble).toHaveCount(0)

  // The run answers in the thread: reopen it from the caret inside its passage.
  await expect.poll(() => mock.remaining(), { timeout: 15_000 }).toBe(0)
  await paneContent(page).getByText('syncs through').click()
  await page.keyboard.press('ControlOrMeta+Shift+m')
  const thread = page.getByTestId('comment-thread')
  await expect(thread).toContainText('What does this mean in practice?')
  await expect(thread).toContainText('every keystroke is shared with the room', { timeout: 15_000 })

  const [req] = mock.requests.filter((r) => r.wire === 'openai')
  expect(req.lastUser).toContain('What does this mean in practice?')
  expect(req.system).toContain('## A comment asked')
  expect(req.system).toContain(LINE)
})
