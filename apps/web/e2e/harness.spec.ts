/**
 * The writing harness end to end, over
 * the scripted LLM (`libs/testkit`'s mock server, one turn per request):
 *
 *  - quiet by default: no provider → no `ai.*` command, no Session view;
 *    Settings › AI is the one surface, and it says where words go;
 *  - a provider added through Settings, *Test connection* listing the mock's models;
 *  - `Mod+Shift+L` on a selection → a session with the chip; a tool-calling
 *    turn reads the vault and answers;
 *  - a scripted `ohhi_patch` → a suggestion in the note, accepted with `Mod+Enter`;
 *  - a comment sent to the agent → its reply in the thread; with the session
 *    opened below, the note keeps its first line at the top.
 */
import { expect, type Page } from '@playwright/test'
import { closeSettings, editors, openApp, openSettings, paneContent, panes, seedProvider, selectLine, test } from './fixtures.js'

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
  await expect(page.getByTestId('settings-lede:ai')).not.toBeEmpty()
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

test('a session left for the note and reopened keeps the chip in its draft, and the shell stays responsive', async ({ page, mockLlm }) => {
  const mock = await mockLlm([])
  await seedProvider(page, `${mock.url}/v1`)
  await openApp(page, 'harness-draft')
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await openNote(page)
  await selectLine(page, LINE)
  await page.keyboard.press('ControlOrMeta+Shift+l')
  await expect(page.getByTestId('session-view')).toBeVisible()
  await expect(page.getByTestId('mention-chip')).toHaveCount(1)

  // The session tab closed (its pane goes with it) and the session reopened
  // — Mod+Shift+L with nothing selected opens the current one: the Session
  // view is re-created and its composer restores the draft — chip included —
  // from sessionStorage. That restore dispatches inside the effect creating
  // the composer; untracked, it is one update, not a loop
  // (effect_update_depth_exceeded, 2026-10-15).
  await expect(panes(page)).toHaveCount(2)
  await page.keyboard.press('ControlOrMeta+w')
  await expect(page.getByTestId('session-view')).toBeHidden()
  await expect(panes(page)).toHaveCount(1)
  await paneContent(page).getByText(LINE).click()
  await page.keyboard.press('ControlOrMeta+Shift+l')
  await expect(page.getByTestId('session-view')).toBeVisible()
  await expect(page.getByTestId('mention-chip')).toHaveCount(1)
  await page.getByTestId(`file-item:${NOTE}`).click()
  await expect(paneContent(page)).toContainText(LINE)
  expect(errors).toEqual([])
})

test('a session opens beside the note, never over it: right in a wide pane, below in a narrow one; the toolbar door and Mod+Shift+L need no selection', async ({ page, mockLlm }) => {
  const mock = await mockLlm([])
  // The specs boot the `dense` layout, whose header is the breadcrumb and
  // whose toolbar is empty: a device override puts the toolbar back as the
  // header and draws its right end as the default layout does (`session` is
  // the Session view's door, `help` the Help menu). The rail becomes the
  // dock so the pane, beside the navigator column, is wide enough for two
  // halves of 40rem at 1800 px (the split rule is the pane's width).
  await seedProvider(page, `${mock.url}/v1`, {
    layout: { overrides: { regions: { header: 'toolbar', rail: 'dock' }, bars: { 'toolbar.right': ['sync', 'session', 'help'] } } },
  })
  await page.setViewportSize({ width: 1800, height: 900 })
  await openApp(page, 'harness-beside')
  // The door on the toolbar, drawn now that a provider exists.
  const door = page.getByTestId('session-open')
  await expect(door).toHaveAccessibleName('Open AI session')
  await openNote(page)
  // A bare caret, no selection: Mod+Shift+L opens a session anyway…
  await paneContent(page).getByText(LINE).click()
  await page.keyboard.press('ControlOrMeta+Shift+l')
  await expect(page.getByTestId('session-view')).toBeVisible()
  await expect(page.getByTestId('mention-chip')).toHaveCount(0)
  // …beside the note, which stays on screen (the session pane is the focused
  // one now, so the note's editor is the first `.cm-content`): two panes side by side.
  await expect(panes(page)).toHaveCount(2)
  await expect(editors(page).first()).toContainText(LINE)
  const [noteBox, sessionBox] = await Promise.all([panes(page).nth(0).boundingBox(), panes(page).nth(1).boundingBox()])
  expect(sessionBox!.x).toBeGreaterThanOrEqual(noteBox!.x + noteBox!.width - 1)
  // Its first screen offers the composer at once, in view, not below the fold.
  const composer = page.getByTestId('session-composer-input')
  await expect(composer).toBeInViewport()
  // The door opens the SAME session: focused, not a third pane.
  await editors(page).first().getByText(LINE).click()
  await door.click()
  await expect(panes(page)).toHaveCount(2)
  await expect(page.getByTestId('session-view')).toHaveCount(1)

  // Narrow: the session tab closed, the window narrowed, the session opened again — below the note.
  await page.keyboard.press('ControlOrMeta+w')
  await expect(panes(page)).toHaveCount(1)
  await page.setViewportSize({ width: 900, height: 900 })
  await paneContent(page).getByText(LINE).click()
  await page.keyboard.press('ControlOrMeta+Shift+l')
  await expect(page.getByTestId('session-view')).toBeVisible()
  await expect(panes(page)).toHaveCount(2)
  const [top, below] = await Promise.all([panes(page).nth(0).boundingBox(), panes(page).nth(1).boundingBox()])
  expect(below!.y).toBeGreaterThanOrEqual(top!.y + top!.height - 1)
  expect(Math.abs(below!.x - top!.x)).toBeLessThan(2)
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

test('the pair on a proposal rejects and accepts it by click; a gutter mark per proposal takes the caret there', async ({ page, mockLlm }) => {
  const OLD = 'the pill goes offline honestly'
  const NEW = 'the pill goes offline, honestly'
  const mock = await mockLlm([
    { toolCall: { name: 'ohhi_patch', args: { path: NOTE, old: 'Everything you type here', new: 'Everything you write here' } } },
    { toolCall: { name: 'ohhi_patch', args: { path: NOTE, old: OLD, new: NEW } } },
    { text: 'Two small edits proposed.' },
  ])
  await seedProvider(page, `${mock.url}/v1`)
  await openApp(page, 'harness-pair')
  await openNote(page)
  await paneContent(page).getByText(LINE).click()
  await page.keyboard.press('ControlOrMeta+Shift+l')
  await send(page, 'Two small edits.')
  await expect.poll(() => mock.remaining(), { timeout: 15_000 }).toBe(0)

  // Two proposals on two lines: two numbered marks in the gutter, and one
  // pair — on the current proposal — without the caret having been put there.
  // The session pane holds the focus: the note's pane is `editor-pane:<id>`.
  const added = page.locator('[data-testid^="editor-pane"] .ed-suggest-add')
  await expect(added).toHaveCount(2)
  const marks = page.locator('[data-testid^="suggestion-marker:"]')
  await expect(marks).toHaveText(['1', '2'])
  const pair = page.locator('[data-testid="suggestion-pair"]')
  await expect(pair).toHaveCount(1)

  // The first mark takes the caret to the first proposal; its pair rejects it, the text untouched.
  await marks.nth(0).click()
  await expect(pair).toHaveAttribute('aria-label', /^Suggestion by /)
  await pair.getByRole('button', { name: 'Reject' }).click()
  await expect(added).toHaveCount(1)
  expect(await docText(page)).toContain('Everything you type here')
  // The pair is on the one left; Accept applies it.
  await expect(pair).toHaveCount(1)
  await pair.getByRole('button', { name: 'Accept' }).click()
  await expect(added).toHaveCount(0)
  await expect.poll(() => docText(page)).toContain(NEW)
  await expect(marks).toHaveCount(0)
  await expect(pair).toHaveCount(0)
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

test('a note with a comment thread keeps its first line at the top when the session opens below it, the marker beside its passage', async ({ page, mockLlm }) => {
  // QA round 1: a comment sent to the agent, then the session opened below
  // the note, left a pane-high gap above it — the note's view, rebuilt with
  // the thread's gutter already in it, had the inline title slotted after the
  // gutter column, which then took a row of its own. Typewriter on, as Chris
  // may have it (its bottom padding makes that row taller still).
  const mock = await mockLlm([{ text: 'That looks like a stray keystroke.' }])
  await seedProvider(page, `${mock.url}/v1`, {
    layout: { overrides: { regions: { header: 'toolbar', rail: 'dock' }, editor: { typewriter: true } } },
  })
  // Narrow enough that the split puts the session BELOW the note.
  await page.setViewportSize({ width: 1100, height: 900 })
  await openApp(page, 'harness-comment-below')
  await openNote(page)
  await selectLine(page, LINE)
  await page.keyboard.press('ControlOrMeta+Shift+m')
  const bubble = page.getByTestId('comment-bubble')
  await bubble.getByTestId('comment-body').fill('jiaosdjas')
  await bubble.getByTestId('comment-send-agent').check()
  await bubble.getByTestId('comment-submit').click()
  await expect.poll(() => mock.remaining(), { timeout: 15_000 }).toBe(0)
  // The session, opened from the note: below it.
  await paneContent(page).getByText('syncs through').click()
  await page.keyboard.press('ControlOrMeta+Shift+l')
  await expect(page.getByTestId('session-view')).toBeVisible()
  await expect(panes(page)).toHaveCount(2)
  const [top, below] = await Promise.all([panes(page).nth(0).boundingBox(), panes(page).nth(1).boundingBox()])
  expect(below!.y).toBeGreaterThanOrEqual(top!.y + top!.height - 1)

  const note = panes(page).nth(0)
  const box = async (selector: string) => (await note.locator(selector).first().boundingBox())!
  const marker = note.locator('.ed-comment-marker')
  await expect(marker).toBeVisible()
  const scroller = await box('.cm-scroller')
  const title = await box('.ed-inline-title')
  const firstLine = await box('.cm-line')
  // The title at the top of the scroller, the first line right under it (within a line height), on screen.
  expect(Math.abs(title.y - scroller.y)).toBeLessThan(2)
  expect(firstLine.y - (title.y + title.height)).toBeLessThan(firstLine.height)
  expect(firstLine.y + firstLine.height).toBeLessThan(scroller.y + scroller.height)
  // The thread's marker sits beside its passage, on the passage's line.
  const passage = await box('.ed-comment')
  const dot = (await marker.boundingBox())!
  expect(dot.x).toBeLessThan(passage.x)
  const mid = dot.y + dot.height / 2
  expect(mid).toBeGreaterThan(passage.y - 6)
  expect(mid).toBeLessThan(passage.y + passage.height + 6)
})
