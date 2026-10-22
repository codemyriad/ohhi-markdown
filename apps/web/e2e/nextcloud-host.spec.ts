/**
 * The Nextcloud host (nextcloud-build), against a mocked
 * ExApp (`nextcloud-host-server.mjs`): the `build:nextcloud` web build under
 * `/exapps/ohhi/ui/`, its `/ws` proxied to the e2e relay, its `/api/*`
 * answered from fixtures. The manager is the Nextcloud vault list; *Open*
 * joins the vault's room with a server-granted token (never stored); a held
 * batch shows with its answers; the `files` readout appears only while a
 * custodian announces itself; the embedded page's script frames the shell.
 *
 * The server is launched here, not as a `webServer`: the other specs never
 * need it, and it needs `dist-nextcloud/` and `dist-embed/` (built here when
 * missing).
 */
import { expect, test } from '@playwright/test'
import { execSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { appUrl } from './fixtures.js'

const PORT = 4180
const NC = `http://localhost:${PORT}`
const VAULT_ID = '5e1f0c2a-7b3d-4c8e-9a10-0e2e00000001'
const WEB = fileURLToPath(new URL('..', import.meta.url))

let server: ChildProcess | null = null

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  test.setTimeout(240_000)
  const rushx = (script: string) =>
    execSync(`node ../../common/scripts/install-run-rushx.js ${script}`, { cwd: WEB, stdio: 'inherit' })
  if (!existsSync(`${WEB}/dist-nextcloud/index.html`)) rushx('build:nextcloud')
  if (!existsSync(`${WEB}/dist-embed/embed.js`)) rushx('build:embed')
  server = spawn('node', ['e2e/nextcloud-host-server.mjs', String(PORT)], { cwd: WEB, stdio: ['ignore', 'pipe', 'inherit'] })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nextcloud-host-server did not start')), 30_000)
    server!.stdout!.on('data', (chunk: Buffer) => {
      if (chunk.toString().includes('ready')) {
        clearTimeout(timer)
        resolve()
      }
    })
    server!.on('exit', (code) => reject(new Error(`nextcloud-host-server exited ${code}`)))
  })
})

test.afterAll(() => {
  server?.kill()
  server = null
})

async function control(
  body?: Record<string, boolean>
): Promise<{ holdAnswers: { hold: string; action: string }[]; sessions: number; statusReads: number; removals: string[] }> {
  const res = await fetch(`${NC}/__control`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  return res.json()
}

test('the vault list, Open as a join, a held batch answered, the files readout', async ({ browser }) => {
  test.setTimeout(120_000)
  const { room, token } = (await (await fetch(`${NC}/__token`)).json()) as { room: string; token: string }

  // The room has notes in it: another peer seeds it on the relay.
  const seeder = await browser.newContext()
  const seed = await seeder.newPage()
  await seed.goto(appUrl({ room, token, user: 'Sam', role: 'seed' }))
  await expect(seed.getByTestId('file-tree')).toBeVisible({ timeout: 15_000 })

  await control({ holds: true, custodian: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(`${NC}/exapps/ohhi/ui/index.html?open=notes/welcome.md`)

  // The Nextcloud manager, not the standard one: who is signed in, the vault list.
  const list = page.getByTestId('nc-vaults')
  await expect(list).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('nc-me')).toHaveText('Signed in as Alice Nextcloud')
  await expect(page.getByTestId(`nc-vault:${VAULT_ID}`)).toContainText('Team notes')
  await expect(list.getByRole('heading', { name: 'Open a folder from Files' })).toBeVisible()
  // Nothing here mints a link, names a relay or links a device.
  await expect(page.getByTestId('manager-welcome')).toHaveCount(0)
  await expect(page.getByText(/relay/i)).toHaveCount(0)

  await page.getByTestId(`nc-open:${VAULT_ID}`).click()

  // The workspace, the note from `?open=` focused, the pill honest: green is the relay's receipt.
  const pill = page.getByTestId('sync-pill-note')
  await expect(pill).toHaveAttribute('data-status', 'green', { timeout: 30_000 })
  await expect(page.getByRole('tab', { name: /welcome/ })).toBeVisible()

  // The grant's token never reaches localStorage; every key carries the uid — or, for the
  // import-time reads before `/api/me` answered, the parked namespace no uid can have.
  const stored = await page.evaluate(() => Object.keys(localStorage).map((k) => [k, localStorage.getItem(k) ?? '']))
  for (const [key, value] of stored) {
    expect(value).not.toContain(token)
    expect(key, key).toMatch(/^nc:(alice|\?):/)
    if (key.startsWith('nc:?:')) expect(value).not.toContain(room)
  }

  // The held batch (polled at once on open): kind, three paths and "and 1 more", the writer's answers.
  const notice = page.getByTestId('holds-notice')
  await expect(notice).toBeVisible({ timeout: 20_000 })
  await expect(notice).toContainText('Many files changed in Files at once')
  await expect(notice).toContainText('a.md')
  await expect(notice).not.toContainText('d.md')
  await expect(notice).toContainText('and 1 more')
  await expect(notice.getByRole('button', { name: 'Not now' })).toBeVisible()
  await notice.getByRole('button', { name: 'Apply changes' }).click()
  await expect(notice).toHaveCount(0)
  expect((await control()).holdAnswers).toEqual([{ hold: 'hold-1', action: 'confirm' }])

  // No custodian, no claim about Files; one announces itself, the readout says so; it leaves, the readout goes.
  const files = page.getByTestId('files-readout')
  await expect(files).toHaveCount(0)
  await control({ custodian: true })
  await expect(files).toHaveText('In Files', { timeout: 15_000 })

  // A hold reaches the shell through the custodian's awareness (`holds`), read at once — not on a blind poll.
  await control({ holds: true })
  await expect(notice).toBeVisible({ timeout: 3_000 })
  await notice.getByRole('button', { name: 'Not now' }).click()
  await expect(notice).toHaveCount(0)
  expect((await control()).holdAnswers.at(-1)).toEqual({ hold: 'hold-1', action: 'discard' })
  // Nothing to watch: no status read on a timer.
  const settled = (await control()).statusReads
  await page.waitForTimeout(6_000)
  expect((await control()).statusReads).toBe(settled)

  await control({ custodian: false })
  await expect(files).toHaveCount(0, { timeout: 15_000 })

  await context.close()
  await seeder.close()
})

test('a read-only grant: the editor refuses typing and the pill says so; Remove from Oh Hi unenrols', async ({ browser }) => {
  test.setTimeout(90_000)
  await control({ readOnly: true, holds: false, custodian: false, removed: false })
  const context = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(`${NC}/exapps/ohhi/ui/index.html?open=notes/welcome.md`)
    await page.getByTestId(`nc-open:${VAULT_ID}`).click()
    const pill = page.getByTestId('sync-pill-note')
    await expect(pill).toHaveAttribute('data-status', 'green', { timeout: 30_000 })
    await expect(pill).toHaveAttribute('aria-label', /Read-only share/)
    const editor = page.locator('[data-testid="editor-pane"] .cm-content').first()
    await expect(editor).toHaveAttribute('contenteditable', 'false')
    // The doc as CodeMirror holds it (the rendered text hides markup by caret position).
    const docText = () =>
      editor.evaluate((el) => {
        type Tile = { root?: { view?: { state: { doc: { toString(): string } } } } }
        return (el as unknown as { cmTile?: Tile }).cmTile?.root?.view?.state.doc.toString() ?? null
      })
    const before = await docText()
    expect(before).toContain('Welcome')
    await editor.click()
    await page.keyboard.type('nope')
    await page.keyboard.press('Enter')
    expect(await docText()).toBe(before)
    await expect(pill).toHaveAttribute('data-status', 'green')
  } finally {
    await context.close()
    await control({ readOnly: false })
  }

  // The owner's row offers Remove from Oh Hi, behind a confirm.
  const manager = await browser.newContext()
  const list = await manager.newPage()
  try {
    await list.goto(`${NC}/exapps/ohhi/ui/index.html`)
    await list.getByTestId(`nc-remove:${VAULT_ID}`).click()
    const confirm = list.getByTestId('nc-remove-confirm')
    await expect(confirm).toContainText('Remove Team notes from Oh Hi?')
    await list.getByTestId('nc-remove-confirm-confirm').click()
    await expect(list.getByTestId(`nc-vault:${VAULT_ID}`)).toHaveCount(0)
    await expect(list.getByTestId('nc-own-empty')).toBeVisible()
    expect((await control()).removals).toEqual([VAULT_ID])
  } finally {
    await manager.close()
    await control({ removed: false })
  }
})

test('the embedded page frames the shell, its launch parameters passed through', async ({ page }) => {
  await page.goto(`${NC}/apps/app_api/embedded/ohhi/app?open=notes/ideas.md&mode=memory`)
  const frame = page.locator('#content #content > iframe#ohhi-frame')
  // `open` (and `fileIds`) only: `mode` stays on the embedding page.
  await expect(frame).toHaveAttribute('src', '/exapps/ohhi/ui/index.html?open=notes%2Fideas.md')
  await expect(frame).toHaveAttribute('allow', 'clipboard-read; clipboard-write')
  await expect(page.frameLocator('#ohhi-frame').getByTestId('nc-vaults')).toBeVisible({ timeout: 15_000 })
})
