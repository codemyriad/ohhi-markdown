/**
 * The e2e setup every spec shares: the memory-vault boot URL, the app opener,
 * and the two gestures/locators the pane specs all reach for.
 *
 * Centralised because the testing skill asks for it — seven specs had the same
 * `URLSearchParams` block, and a change to the boot contract (a param, the
 * readiness signal) has to land in one place or the run rots one spec at a time.
 *
 * Not a `*.spec.ts`, so Playwright's `testMatch` leaves it alone.
 */
import AxeBuilder from '@axe-core/playwright'
import { test as base, expect, type Locator, type Page, type WebSocketRoute } from '@playwright/test'
import type { MockTurn } from '../../../libs/testkit/src/mock-llm.js'
import { startMockLlm, type MockLlmServer } from '../../../libs/testkit/src/node.js'

export const RELAY = 'ws://localhost:8799'

export interface AppParams {
  room: string
  /** `seed` writes the sample vault; `join` expects the room to exist. */
  role?: 'seed' | 'join'
  token?: string
  user?: string
  /**
   * The layout the app boots in (`?layout=`, a session-only choice).
   * `dense` by default: it is the shell every spec before Stage 1 was written
   * against — the navigator column `openApp` waits for (spike S21). The
   * default layout has its own spec (`layout.spec.ts`); pass `null` to boot
   * whatever the device has chosen.
   */
  layout?: string | null
}

/** The memory-vault URL the specs boot from — no real folder, no share. */
export function appUrl({
  room,
  role = 'seed',
  token = 'e2e-token',
  user = 'Chris',
  layout = 'dense',
}: AppParams): string {
  const params = new URLSearchParams({ mode: 'memory', role, relay: RELAY, room, token, user })
  if (layout) params.set('layout', layout)
  return `/?${params.toString()}`
}

/**
 * The vault manager with no vault, in the `dense` layout for the rest of the
 * tab (the choice survives the shell's URL clean-up and a reload). What a
 * spec that makes or links a vault from the manager navigates to instead of `/`.
 */
export const MANAGER_URL = '/?layout=dense'

/** Boot the app and wait until the vault is actually on screen. */
export async function openApp(
  page: Page,
  room: string,
  opts: Omit<AppParams, 'room'> = {}
): Promise<void> {
  await page.goto(appUrl({ room, ...opts }))
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

/**
 * The sidebar and pane-focus keys from Chris's own Obsidian rebinds — the
 * built-in defaults until QA round 2 (2026-10-16; `docs/customising.md` §3
 * has the rule the defaults follow now). The specs that drive the sidebars,
 * the dock and pane focus BY KEY are about what a key does (focus follows
 * it, Escape after it), so they keep those keys through the real keymap
 * path: the legacy per-device map `config.hotkeys`, which the keymap
 * migration applies and writes into the vault as `.ohhi/keymaps/device.json`
 * on the first open (idempotently). Back / Forward move off the arrows with
 * them, as in his keymap; every other default (the split, the tabs) stays.
 */
export const OBSIDIAN_REBINDS: Record<string, string> = {
  'nav.back': 'Mod+[',
  'nav.forward': 'Mod+]',
  'view.rail': 'Mod+ArrowRight',
  'view.sidebar': 'Mod+ArrowLeft',
  'workspace.focus-down': 'Ctrl+Mod+ArrowDown',
  'workspace.focus-left': 'Ctrl+Mod+ArrowLeft',
  'workspace.focus-right': 'Ctrl+Mod+ArrowRight',
  'workspace.focus-up': 'Ctrl+Mod+ArrowUp',
}

/** Bind `OBSIDIAN_REBINDS` for every page this one navigates to, before the app reads its config. */
export async function withObsidianKeys(page: Page): Promise<void> {
  await page.addInitScript((keys: Record<string, string>) => {
    let cfg: Record<string, unknown> = {}
    try {
      cfg = JSON.parse(localStorage.getItem('editor:config') ?? '{}') as Record<string, unknown>
    } catch {
      cfg = {}
    }
    if (cfg['version'] !== 2) {
      cfg = { version: 2, vaults: [], shares: [], defaultRelay: '', tokensByRoom: {}, relayByRoom: {} }
    }
    cfg['hotkeys'] = { ...((cfg['hotkeys'] as Record<string, string> | undefined) ?? {}), ...keys }
    localStorage.setItem('editor:config', JSON.stringify(cfg))
  }, OBSIDIAN_REBINDS)
}

/** A pointer drag with enough steps to cross the 6 px threshold and settle. */
export async function dragTo(page: Page, from: Locator, x: number, y: number): Promise<void> {
  const box = (await from.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.move(x, y)
  await page.mouse.up()
}

/**
 * The note the Read specs (and the axe scan over the Live surface) type: one
 * of everything the construct table decorates, in the shapes the measured
 * vault holds — a legacy space-separated `tags:` flow list, a nested inline
 * tag, tasks in both states, a fenced block with a language.
 */
export const READ_FIXTURE = [
  '---',
  'tags: [composition testing]',
  'status: On deck',
  '---',
  '',
  '# Marks and Channels',
  '',
  'A note with a #edible/roadmap tag and a [link](https://example.com).',
  '',
  '- a bullet',
  '- [ ] a task',
  '- [x] a done task',
  '',
  '> a quote',
  '',
  '```ts',
  'const x = 1',
  '```',
  '',
].join('\n')

/** The seeded note the Read specs write into. */
export const READ_NOTE = 'notes/welcome.md'

/**
 * Boot, open the note, replace it with `text`, and leave the caret at the end.
 *
 * `insertText`, not `type`: markdown's own Enter binding continues a list for
 * you (that is `markdown({ addKeymap })`, and it is a feature), so TYPING a
 * fixture that contains `- [ ] a task` on the line after `- a bullet` lands
 * `- - [ ] a task` in the document. The subject of these specs is the fixture,
 * not the continuation, so the text goes in as text — which is also what a
 * paste does, and what the reconciler does when the file changes on disk.
 */
export async function seedReadNote(
  page: Page,
  room: string,
  text: string = READ_FIXTURE
): Promise<void> {
  await openApp(page, room)
  await page.getByTestId(`file-item:${READ_NOTE}`).click()
  await paneContent(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
  await page.keyboard.press('ControlOrMeta+End')
}

/** The focused pane's editing surface, and the box that scrolls it. */
export const paneContent = (page: Page): Locator =>
  page.locator('[data-testid="editor-pane"] .cm-content')
export const paneScroller = (page: Page): Locator =>
  page.locator('[data-testid="editor-pane"] .cm-scroller')

/**
 * A NATIVE (HTML5) drag from a file-tree row to a point (P1.2).
 *
 * Not `dragTo`: the tree is a `draggable` element, so Chromium starts a real
 * drag session instead of dispatching pointer moves — and it only begins
 * dispatching `dragover` from the *second* move on, which is why the first
 * one is a short nudge off the row.
 */
export async function dragRowTo(page: Page, from: Locator, x: number, y: number): Promise<void> {
  const box = (await from.boundingBox())!
  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 12, startY + 12)
  await page.mouse.move(x, y, { steps: 12 })
  await page.mouse.move(x, y)
  await page.mouse.up()
}

/** A note through the affordance a person has: the tree's own New note. */
export async function newNote(page: Page, n: number): Promise<string> {
  await page.getByTestId('file-tree').click({ button: 'right' })
  await page.getByTestId('tree-menu:new-file').click()
  const path = `untitled-${n}.md`
  await expect(page.getByTestId(`file-item:${path}`)).toBeVisible()
  return path
}

/**
 * A BROWSER (OPFS) vault, made the way the manager offers one. The memory
 * contract the specs boot registers no vault at all, so anything that needs a
 * vault the manager can LIST has to make one first. Assumes the manager is
 * already on screen.
 */
export async function createBrowserVault(page: Page, name: string): Promise<void> {
  // The welcome's browser door asks for the name in its row; the list's Add
  // menu asks in a small dialog (first-run A1/B1).
  const welcomeDoor = page.getByTestId('start-browser-vault')
  if (await welcomeDoor.isVisible()) {
    if ((await welcomeDoor.getAttribute('aria-expanded')) !== 'true') await welcomeDoor.click()
  } else {
    await page.getByTestId('manager-add').click()
    await page.getByTestId('add-browser-vault').click()
  }
  await page.getByTestId('new-vault-name').fill(name)
  await page.getByTestId('create-vault').click()
  await expect(page.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })
}

/** Back into the manager the way a person gets there: the vault switcher. */
export async function openManager(page: Page): Promise<void> {
  await page.getByTestId('vault-switcher').click()
  await page.getByTestId('manage-vaults').click()
}

export const panes = (page: Page): Locator => page.locator('[data-pane-id]')
export const editors = (page: Page): Locator => page.locator('[data-pane-id] .cm-content')
export const chips = (page: Page): Locator => page.locator('[data-testid^="group-chip:"]')
/**
 * Focus a note's editor WITHOUT clicking (a click would place the caret
 * itself), through CodeMirror's own `view.focus()`, which writes the editor's
 * selection into the DOM in the same call.
 *
 * Not `locator.focus()`: a DOM focus leaves the browser's caret at the start
 * of the content, and CM6 only puts its own selection back if it handles the
 * `selectionchange` within 200 ms of the focus (`lastFocusTime > Date.now() -
 * 200` in its DOM observer). A main thread stalled past that — a loaded full
 * suite — makes CM6 adopt the browser's caret as a user selection, and a
 * resume point the app restored correctly reads as lost. The view is found
 * the way `EditorView.findFromDOM` finds it (the content node's tile → its
 * root → the view); a CM6 upgrade that moves that pointer fails here, loudly.
 */
export async function focusEditor(content: Locator): Promise<void> {
  await content.evaluate((el) => {
    type Tile = { root?: { view?: { focus(): void } } }
    const view = (el as unknown as { cmTile?: Tile }).cmTile?.root?.view
    if (!view) throw new Error('focusEditor: no CodeMirror view behind this .cm-content')
    view.focus()
  })
}
/** A tab by the note name it prints; `.first()` because a note can be in two panes. */
export const tabNamed = (page: Page, name: string): Locator =>
  page.locator('[data-slot-kind="tab"]', { hasText: name }).first()
/**
 * The editor area's tabs — the panes' strips, not the rail column's own
 * Links/History tab row (round 2's DockPanel is a `ui/Tabs` too, and in
 * `dense` it is on screen as the pinned column).
 */
export const paneTabs = (page: Page, opts: { selected?: boolean } = {}): Locator =>
  page.getByTestId('editor-area').getByRole('tab', opts)
/** Every tab strip on screen (`tabs: 'auto'` draws none for a lone tab). */
export const strips = (page: Page): Locator => page.locator('[data-strip]')

/**
 * Axe over the page as it stands, against the WCAG 2.1 AA + best-practice
 * tags golden rule 7 gates on; a failure lists each rule, node and summary.
 */
export async function expectAccessible(page: Page, surface: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze()
  const report = results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}\n      ${n.failureSummary?.split('\n').join('\n      ')}`).join('\n')
    )
    .join('\n')
  expect(results.violations, `${surface}\n${report}`).toEqual([])
}

/**
 * A session's turn once it is done: each run of tool calls is folded to one
 * line then (`ToolRun`); unfold every one, as a person would to see the rows.
 */
export async function unfoldRuns(page: Page): Promise<void> {
  await expect(page.getByTestId('session-run-status')).toHaveAttribute('data-status', 'successful', { timeout: 15_000 })
  const toggles = page.getByTestId('session-run-toggle')
  for (let i = 0, n = await toggles.count(); i < n; i++) {
    const toggle = toggles.nth(i)
    if ((await toggle.getAttribute('aria-expanded')) !== 'false') continue
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }
}

/** Close every toast on screen (an unseeded room's relay refusal can sit over a target). */
export async function dismissToasts(page: Page): Promise<void> {
  for (const toast of await page.getByTestId('toast').all()) await toast.getByRole('button').first().click()
  await expect(page.getByTestId('toast')).toHaveCount(0)
}

/** Open a note by quick-open (`Mod+O`) — the way in when there is no navigator column. */
export async function openByQuickOpen(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+o')
  await page.getByTestId('quick-open-input').fill(query)
  await expect(page.getByTestId('quick-open-row').first()).toContainText(query)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('quick-open-input')).toHaveCount(0)
}

/** Run a command by its palette title: `Mod+Shift+P`, the query, Enter on the first row. */
export async function runCommand(page: Page, query: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Shift+p')
  await page.getByTestId('command-palette-input').fill(query)
  await expect(page.getByTestId('command-palette-row').first()).toBeVisible()
  await page.keyboard.press('Enter')
}

/** Split the focused pane to the right (`Mod+\`) and wait for `count` panes. */
export async function splitRight(page: Page, count = 2): Promise<void> {
  await page.keyboard.press('ControlOrMeta+\\')
  await expect(panes(page)).toHaveCount(count)
}

/**
 * Route this page's websockets through a switch, so the RELAY can be killed
 * for this page alone while the app server stays up (setOffline would block
 * the dev server too). Register BEFORE the navigation it should govern: ws
 * routes only take effect after one (verified, PW 1.60). `severed: true`
 * starts with the relay unreachable; `restore()` lets the next connections
 * through, `kill()` closes the open ones and refuses new ones.
 */
export async function severableRelay(
  page: Page,
  { severed = false }: { severed?: boolean } = {}
): Promise<{ kill: () => Promise<void>; restore: () => void }> {
  const sockets: WebSocketRoute[] = []
  let cut = severed
  await page.routeWebSocket(/.*/, (ws) => {
    if (cut) return void ws.close()
    sockets.push(ws)
    ws.connectToServer()
  })
  return {
    kill: async () => {
      cut = true
      await Promise.all(sockets.splice(0).map((ws) => ws.close()))
    },
    restore: () => {
      cut = false
    },
  }
}

/** Settings is a view tab (settings-shaping ST1): its body, wherever it is. */
export const settingsView = (page: Page): Locator => page.getByTestId('settings-view')

/**
 * Open Settings (`Mod+,`, the palette's `app.settings`) and, given one, move
 * to `section` through the nav. Focus must be somewhere the shell's keys reach
 * (not a field outside the panes).
 */
export async function openSettings(page: Page, section?: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  await expect(settingsView(page)).toBeVisible()
  if (!section) return
  // One tablist at every width: a labelled tree, or (below 32rem) an icon rail.
  await settingsView(page).getByTestId(`settings-tab:${section}`).click()
  await expect(page.getByTestId(`settings-section:${section}`)).toBeVisible()
}

/** Close the Settings tab like any tab: `Mod+W` with the tab focused (a field in a pane does not claim it). */
export async function closeSettings(page: Page): Promise<void> {
  // The nav's own tab (wide or rail): a section may hold tabs of its own (AI's route picker).
  await settingsView(page).locator('[data-testid^="settings-tab:"][aria-selected="true"]').focus()
  await page.keyboard.press('ControlOrMeta+w')
  await expect(settingsView(page)).toHaveCount(0)
}

// ---- the writing harness: a scripted LLM and a provider pointed at it ----

/**
 * `test` with a `mockLlm` fixture: `await mockLlm(script)` starts the
 * scripted LLM (`libs/testkit`'s server: one turn per request, `GET /models`
 * free) on a free port and closes it when the test ends. Its `url` + `/v1`
 * is an OpenAI-compatible base URL.
 */
export const test = base.extend<{
  mockLlm: (script: MockTurn[], opts?: { models?: string[] }) => Promise<MockLlmServer>
}>({
  // The empty pattern is Playwright's: it reads a fixture's dependencies from it.
  mockLlm: async ({}, use) => {
    const started: MockLlmServer[] = []
    await use(async (script, opts = {}) => {
      const server = await startMockLlm({ script, ...opts })
      started.push(server)
      return server
    })
    await Promise.all(started.map((s) => s.close()))
  },
})

/** The provider the harness specs seed: the mock, over the OpenAI-compatible wire. */
export const MOCK_PROVIDER_ID = 'mock'

/**
 * Seed this device's config, before the app boots, with a provider pointed
 * at `baseUrl` (and any extra config, e.g. layout overrides). The blob is a
 * valid v2 config — an invalid one is replaced by a fresh one on read, which
 * would silently drop the provider.
 */
export async function seedProvider(page: Page, baseUrl: string, extra: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript(
    ({ baseUrl, extra, id }) => {
      const key = 'editor:config'
      let config: Record<string, unknown> = {}
      try {
        config = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
      } catch {
        config = {}
      }
      if (config.version !== 2) {
        config = { version: 2, vaults: [], lastRoom: null, defaultRelay: '', operatorSecret: '', shares: [], tokensByRoom: {}, relayByRoom: {}, devtools: false }
      }
      config.ai = { providers: [{ id, name: 'Mock', kind: 'openai-compatible', baseUrl, model: 'mock-model' }] }
      Object.assign(config, extra)
      localStorage.setItem(key, JSON.stringify(config))
    },
    { baseUrl, extra, id: MOCK_PROVIDER_ID }
  )
}

/** Select one whole line of the open note (the line holding `text`), as a person would. */
export async function selectLine(page: Page, text: string): Promise<void> {
  await paneContent(page).getByText(text).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
}
