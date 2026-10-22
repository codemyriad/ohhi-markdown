/**
 * The Nextcloud ExApp, live (nextcloud-build demos 1–3): two real
 * Nextcloud users in two browser contexts, the shell in AppAPI's embedded
 * page, the custodian writing a real Files folder over WebDAV.
 *
 * NOT part of the default `rushx e2e`: `playwright.config.ts` ignores this
 * file unless `OHHI_NC_E2E` is set (and then runs only this file, without the
 * e2e relay or the preview build — the stack serves both). Against the local
 * stack (`apps/nextcloud/scripts/nc-dev-install.sh`, the sidecar on :28090):
 *
 *   export OHHI_NC_ADMIN_PASSWORD=$(docker inspect spreedtest-nextcloud-1 \
 *     --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^NEXTCLOUD_ADMIN_PASSWORD=//p')
 *   export OHHI_NC_ALICE_PASSWORD=…   # alice's password on that stack
 *   OHHI_NC_E2E=1 ./node_modules/.bin/playwright test e2e/nextcloud-live.spec.ts
 *
 * `alice` (and `bob`) are the test users the local stack's harness created
 * (Cassini's harness, compose project `spreedtest`); the spec has no default
 * for her password. If you do not know it, set a new one:
 * `docker exec -e OC_PASS=… -u www-data spreedtest-nextcloud-1 php occ
 * user:resetpassword --password-from-env alice`.
 *
 * Env: `OHHI_NC_BASE` (browser base, default http://localhost:28090 — the
 * WebSocket-aware sidecar), `OHHI_NC_DAV` (WebDAV/OCS base, default
 * http://localhost:28080), `OHHI_NC_CONTAINER`
 * (default nc_app_ohhi, restarted by demo 1).
 *
 * One fresh folder per run (`OhhiE2E-<random>`), enrolled through the Files
 * flow (`?fileIds=` → the enrol confirm); at the end the vault is unenrolled
 * through `DELETE /api/vaults/:id` (as admin, from the page) and the folder
 * deleted. `OhhiSmoke` is never touched; `OHHI_NC_KEEP_ROW=1` keeps the
 * vault. A row a crashed run left behind can still be forgotten with
 * `apps/nextcloud/scripts/nc-dev-forget-vaults.sh`. Every measured latency is
 * logged as `[latency] …`.
 *
 * The browser's sockets reach the relay as they are: Chromium's WebSocket
 * handshake carries `Origin` and no `Sec-Fetch-Site`, and the ExApp admits an
 * Origin whose host is the request's own Host (apps/nextcloud/src/appapi.ts
 * `originAllowed`) — no shim.
 */
import { expect, test, type Browser, type BrowserContext, type FrameLocator, type Locator, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

const BASE = (process.env.OHHI_NC_BASE ?? 'http://localhost:28090').replace(/\/+$/, '')
const DAV = (process.env.OHHI_NC_DAV ?? 'http://localhost:28080').replace(/\/+$/, '')
const ADMIN = { user: 'admin', password: process.env.OHHI_NC_ADMIN_PASSWORD ?? '' }
const ALICE = { user: 'alice', password: process.env.OHHI_NC_ALICE_PASSWORD ?? '' }
const CONTAINER = process.env.OHHI_NC_CONTAINER ?? 'nc_app_ohhi'
const FOLDER = `OhhiE2E-${randomBytes(4).toString('hex')}`
const NOTE = 'hello.md'
const RENAMED = 'renamed.md'
const INITIAL = '# Hello\n\nfrom WebDAV\n'
const BURST = 25

test.skip(
  !process.env.OHHI_NC_E2E || !ADMIN.password || !ALICE.password,
  'live Nextcloud e2e: set OHHI_NC_E2E=1, OHHI_NC_ADMIN_PASSWORD and OHHI_NC_ALICE_PASSWORD (see the header) with the local stack running'
)
test.describe.configure({ mode: 'serial' })

// ---------------------------------------------------------------- latencies

const latencies: [string, number][] = []
function record(name: string, ms: number): void {
  latencies.push([name, ms])
  console.log(`[latency] ${name}: ${ms} ms`)
}
/** Poll `fn` until truthy; returns the elapsed ms (throws after `timeout`). */
async function measure(name: string, fn: () => Promise<boolean>, timeout: number, interval = 100): Promise<number> {
  const t0 = Date.now()
  await expect.poll(fn, { timeout, intervals: [interval] }).toBe(true)
  const ms = Date.now() - t0
  record(name, ms)
  return ms
}

// ---------------------------------------------------------------- WebDAV / OCS (node side, basic auth)

type Who = { user: string; password: string }
const auth = (w: Who) => 'Basic ' + Buffer.from(`${w.user}:${w.password}`).toString('base64')
const davUrl = (w: Who, path: string) =>
  `${DAV}/remote.php/dav/files/${encodeURIComponent(w.user)}/${path.split('/').map(encodeURIComponent).join('/')}`

async function dav(w: Who, method: string, path: string, init: { body?: string; headers?: Record<string, string> } = {}): Promise<Response> {
  return fetch(davUrl(w, path), { method, headers: { authorization: auth(w), ...init.headers }, body: init.body })
}
async function davText(w: Who, path: string): Promise<string | null> {
  const res = await dav(w, 'GET', path)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`)
  return res.text()
}
async function put(w: Who, path: string, body: string): Promise<void> {
  const res = await dav(w, 'PUT', path, { body, headers: { 'content-type': 'text/markdown' } })
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`)
}
/** Depth-1 listing: child names (decoded, no trailing slash) → fileid. */
async function propfind(w: Who, path: string, depth: 0 | 1 = 1): Promise<Map<string, string>> {
  const res = await dav(w, 'PROPFIND', path, {
    headers: { depth: String(depth), 'content-type': 'application/xml' },
    body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
  })
  if (res.status !== 207) throw new Error(`PROPFIND ${path} → ${res.status}`)
  const xml = await res.text()
  const out = new Map<string, string>()
  for (const m of xml.matchAll(/<d:response>([\s\S]*?)<\/d:response>/g)) {
    const href = decodeURIComponent(/<d:href>([^<]*)<\/d:href>/.exec(m[1]!)?.[1] ?? '').replace(/\/$/, '')
    const id = /<oc:fileid>(\d+)<\/oc:fileid>/.exec(m[1]!)?.[1] ?? ''
    out.set(href.slice(href.lastIndexOf('/') + 1), id)
  }
  return out
}
async function ocs(w: Who, method: string, path: string, form?: Record<string, string>): Promise<any> {
  const res = await fetch(`${DAV}/ocs/v2.php/apps/files_sharing/api/v1/shares${path}?format=json`, {
    method,
    headers: { authorization: auth(w), 'OCS-APIRequest': 'true', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  })
  const body = (await res.json()) as any
  if (!res.ok) throw new Error(`OCS ${method} ${path} → ${res.status} ${JSON.stringify(body?.ocs?.meta)}`)
  return body.ocs.data
}

// ---------------------------------------------------------------- browser side

interface Peer {
  context: BrowserContext
  page: Page
  frame: FrameLocator
}

async function login(browser: Browser, w: Who): Promise<Peer> {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (e) => console.log(`[${w.user}] pageerror: ${String(e).slice(0, 300)}`))
  await page.goto(`${BASE}/login`)
  await page.fill('input[name=user]', w.user)
  await page.fill('input[name=password]', w.password)
  await page.click('button[type=submit]')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
  await skipFirstRunWizard(page)
  return { context, page, frame: page.frameLocator('iframe[src*="/exapps/ohhi/ui/"]') }
}

/**
 * Nextcloud's own first-run wizard (a user's first login) opens over every
 * page some seconds after load; mark it seen for this user (the wizard's own
 * "don't show again" route) so it never covers the frame.
 */
async function skipFirstRunWizard(page: Page): Promise<void> {
  const status = await page.evaluate(async () => {
    const token = (window as unknown as { OC?: { requestToken?: string } }).OC?.requestToken ?? ''
    return (await fetch('/apps/firstrunwizard/wizard', { method: 'DELETE', headers: { requesttoken: token } })).status
  })
  if (status !== 200) console.log(`[fixture] first-run wizard not disabled (${status}); it may cover the page`)
}

/** The embedded page with `?fileIds=` — the Files menu's entry — confirmed and opened. */
async function openFromFiles(p: Peer, fileId: string): Promise<void> {
  await p.page.goto(`${BASE}/apps/app_api/embedded/ohhi/app?fileIds=${fileId}`)
  const confirm = p.frame.getByTestId('nc-enrol-confirm-confirm')
  const toggle = p.frame.getByTestId('toggle-tree')
  await expect(confirm.or(toggle)).toBeVisible({ timeout: 30_000 })
  if (await confirm.isVisible()) await confirm.click({ timeout: 30_000 })
  await expect(toggle).toBeVisible({ timeout: 60_000 })
  await showTree(p)
}

/** The default layout starts with the navigator folded: unfold it. */
async function showTree(p: Peer): Promise<void> {
  const tree = p.frame.getByTestId('file-tree')
  if (!(await tree.isVisible())) await p.frame.getByTestId('toggle-tree').click()
  await expect(tree).toBeVisible({ timeout: 15_000 })
}

const editor = (p: Peer): Locator => p.frame.locator('[data-testid="editor-pane"] .cm-content').first()
const pill = (p: Peer): Locator => p.frame.getByTestId('sync-pill-note')
const pillStatus = (p: Peer): Promise<string | null> => pill(p).getAttribute('data-status', { timeout: 2_000 }).catch(() => null)

/** The note's text as CodeMirror holds it (the view found the way `fixtures.ts`'s `focusEditor` finds it). */
async function noteText(p: Peer): Promise<string> {
  return editor(p)
    .evaluate((el) => {
      type Tile = { root?: { view?: { state: { doc: { toString(): string } } } } }
      const view = (el as unknown as { cmTile?: Tile }).cmTile?.root?.view
      if (!view) throw new Error('noteText: no CodeMirror view behind this .cm-content')
      return view.state.doc.toString()
    }, undefined, { timeout: 5_000 })
    .catch(() => '')
}

async function openNote(p: Peer, path: string): Promise<void> {
  await showTree(p)
  const item = p.frame.getByTestId(`file-item:${path}`)
  await expect(item).toBeVisible({ timeout: 30_000 })
  await item.click()
  await expect(editor(p)).toBeVisible({ timeout: 15_000 })
}

/** Type a new last line into the open note. */
async function appendLine(p: Peer, line: string): Promise<void> {
  await editor(p).click()
  await p.page.keyboard.press('ControlOrMeta+End')
  await p.page.keyboard.press('Enter')
  await p.page.keyboard.type(line, { delay: 10 })
}

/** A same-origin call to the ExApp's API from the user's Nextcloud page (session cookie, the POST guard). */
async function api(p: Peer, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return p.page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(`/exapps/ohhi/api/${path}`, {
        method,
        headers: { 'X-Ohhi-Request': '1', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {}
      return { status: res.status, body: parsed }
    },
    { method, path, body }
  )
}

const count = (hay: string, needle: string) => hay.split(needle).length - 1

// ---------------------------------------------------------------- the shared fixture

let admin: Peer
let alice: Peer
let folderId = ''
let vaultId = ''
let shareId = ''
/** Lines typed so far, each must appear exactly once everywhere. */
const typed: string[] = []

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000)
  admin = await login(browser, ADMIN)
  alice = await login(browser, ALICE)

  expect((await dav(ADMIN, 'MKCOL', FOLDER)).status).toBe(201)
  await put(ADMIN, `${FOLDER}/${NOTE}`, INITIAL)
  folderId = (await propfind(ADMIN, FOLDER, 0)).get(FOLDER) ?? ''
  expect(folderId).toMatch(/^\d+$/)
  console.log(`[fixture] folder ${FOLDER} fileId ${folderId}`)

  const t0 = Date.now()
  await openFromFiles(admin, folderId)
  record('enrol via ?fileIds= → tree visible (admin)', Date.now() - t0)
  const list = await api(admin, 'GET', 'vaults')
  const rows = Array.isArray(list.body) ? list.body : [...(list.body.own ?? []), ...(list.body.recent ?? [])]
  vaultId = rows.find((r: any) => String(r.fileId) === folderId)?.id ?? ''
  expect(vaultId, JSON.stringify(list.body)).not.toBe('')
  await measure(
    'enrol → custodian running',
    async () => (await api(admin, 'GET', `vaults/${vaultId}/status`)).body?.custodian === 'running',
    60_000,
    250
  )
})

test.afterAll(async () => {
  test.setTimeout(120_000)
  if (shareId) await ocs(ADMIN, 'DELETE', `/${shareId}`).catch(() => {})
  // Unenrol through the API (the marker, the row, the store and the room go with it). By
  // folder when the id was never learned: a run that failed early still releases its row.
  if (admin && folderId && process.env.OHHI_NC_KEEP_ROW !== '1') {
    let id = vaultId
    if (!id) {
      const list = await api(admin, 'GET', 'vaults').catch(() => null)
      id = (list?.body?.own ?? []).find((r: any) => String(r.fileId) === folderId)?.id ?? ''
    }
    if (id) {
      const res = await api(admin, 'DELETE', `vaults/${id}`).catch((e) => ({ status: String(e), body: null }))
      console.log(`[fixture] DELETE /api/vaults/${id}: ${res.status}`)
      expect(res.status).toBe(200)
      expect(((await davText(ADMIN, `${FOLDER}/ohhi-host.md`)) ?? '').length, 'marker removed').toBe(0)
    }
  }
  await admin?.context.close()
  await alice?.context.close()
  if (FOLDER) {
    const res = await dav(ADMIN, 'DELETE', FOLDER).catch(() => null)
    console.log(`[fixture] deleted ${FOLDER}: ${res?.status}`)
  }
  console.log('[latency] summary\n' + latencies.map(([n, ms]) => `  ${n}: ${ms} ms`).join('\n'))
})

// ---------------------------------------------------------------- the marker

test('marker: ohhi-host.md is in the folder and not in the tree', async () => {
  await expect.poll(async () => (await propfind(ADMIN, FOLDER)).has('ohhi-host.md'), { timeout: 30_000 }).toBe(true)
  const marker = (await davText(ADMIN, `${FOLDER}/ohhi-host.md`)) ?? ''
  expect(marker).toContain(`vault: ${vaultId}`)
  await expect(admin.frame.getByTestId(`file-item:${NOTE}`)).toBeVisible()
  await expect(admin.frame.getByTestId('file-item:ohhi-host.md')).toHaveCount(0)
})

// ---------------------------------------------------------------- demo 1

test('demo 1: two Nextcloud users co-edit, the pill honest through a container restart', async () => {
  test.setTimeout(300_000)
  await openNote(admin, NOTE)
  await expect.poll(() => noteText(admin), { timeout: 15_000 }).toContain('from WebDAV')

  const a1 = `admin line ${randomBytes(3).toString('hex')}`
  await appendLine(admin, a1)
  typed.push(a1)

  // alice gets a full share and opens the vault from Files.
  shareId = String((await ocs(ADMIN, 'POST', '', { path: `/${FOLDER}`, shareType: '0', shareWith: ALICE.user, permissions: '31' })).id)
  const t0 = Date.now()
  await openFromFiles(alice, folderId)
  record('share(31) → alice tree visible', Date.now() - t0)
  await openNote(alice, NOTE)
  await measure('admin typed → alice sees (after open)', async () => (await noteText(alice)).includes(a1), 30_000)

  const b1 = `alice line ${randomBytes(3).toString('hex')}`
  await appendLine(alice, b1)
  typed.push(b1)
  await measure('alice typed → admin sees', async () => (await noteText(admin)).includes(b1), 15_000)

  await expect(pill(admin)).toHaveAttribute('data-status', 'green', { timeout: 15_000 })
  await expect(pill(alice)).toHaveAttribute('data-status', 'green', { timeout: 15_000 })

  // The container restarts mid-session.
  const r0 = Date.now()
  execSync(`docker restart ${CONTAINER}`, { stdio: 'ignore' })
  record('docker restart (command)', Date.now() - r0)
  const statuses: string[] = []
  await expect
    .poll(async () => {
      const s = `${await pillStatus(admin)}/${await pillStatus(alice)}`
      if (statuses.at(-1) !== s) statuses.push(s)
      return s
    }, { timeout: 90_000, intervals: [500] })
    .toBe('green/green')
  record('restart → both pills green', Date.now() - r0)
  console.log(`[demo1] pill states seen after the restart: ${statuses.join(' → ')}`)

  // After the restart: still co-editing, nothing lost or duplicated.
  const a2 = `admin after restart ${randomBytes(3).toString('hex')}`
  await appendLine(admin, a2)
  typed.push(a2)
  await measure('post-restart admin typed → alice sees', async () => (await noteText(alice)).includes(a2), 30_000)
  await measure(
    'post-restart typed → Files bytes',
    async () => ((await davText(ADMIN, `${FOLDER}/${NOTE}`)) ?? '').includes(a2),
    30_000,
    250
  )
  const [ta, tb, bytes] = [await noteText(admin), await noteText(alice), (await davText(ADMIN, `${FOLDER}/${NOTE}`)) ?? '']
  expect(ta).toBe(tb)
  for (const line of [...typed, '# Hello', 'from WebDAV']) {
    expect(count(ta, line), `editor: ${line}`).toBe(1)
    expect(count(bytes, line), `Files: ${line}`).toBe(1)
  }
  await expect(pill(admin)).toHaveAttribute('data-status', 'green')
  await expect(pill(alice)).toHaveAttribute('data-status', 'green')
})

// ---------------------------------------------------------------- demo 2

test('demo 2: Files round-trip — typing, a curl PUT, a rename in Files', async () => {
  test.setTimeout(180_000)
  await openNote(admin, NOTE)
  const line = `files round trip ${randomBytes(3).toString('hex')}`
  await appendLine(admin, line)
  typed.push(line)
  await measure('editor → Files bytes (WebDAV)', async () => ((await davText(ADMIN, `${FOLDER}/${NOTE}`)) ?? '').includes(line), 5_000, 100)

  // An external writer (the desktop client's stand-in).
  const external = `# Hello\n\nreplaced by curl ${randomBytes(3).toString('hex')}\n`
  await expect(pill(admin)).toHaveAttribute('data-status', 'green', { timeout: 10_000 })
  await put(ADMIN, `${FOLDER}/${NOTE}`, external)
  await measure('curl PUT → admin editor', async () => (await noteText(admin)).includes(external.split('\n')[2]!), 10_000, 100)
  await measure('curl PUT → alice editor', async () => (await noteText(alice)).includes(external.split('\n')[2]!), 10_000, 100)
  typed.length = 0

  // A rename in Files keeps the note (decision 11): new name in the tree, old gone, same content.
  const mv = await dav(ADMIN, 'MOVE', `${FOLDER}/${NOTE}`, { headers: { destination: davUrl(ADMIN, `${FOLDER}/${RENAMED}`), overwrite: 'F' } })
  expect(mv.status).toBe(201)
  // Observed for up to 45 s so a slow or wrong outcome is reported, then held to the 10 s bound.
  await showTree(admin)
  const m0 = Date.now()
  let newAt = -1
  let oldGoneAt = -1
  const trace: string[] = []
  while (Date.now() - m0 < 45_000 && (newAt < 0 || oldGoneAt < 0)) {
    const items = await admin.frame.locator('[data-testid^="file-item:"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(10)))
    const t = Date.now() - m0
    if (newAt < 0 && items.includes(RENAMED)) newAt = t
    if (oldGoneAt < 0 && !items.includes(NOTE)) oldGoneAt = t
    const line = items.filter((i) => i !== 'ohhi-host.md').join(',')
    if (trace.at(-1)?.split(' ')[1] !== line) trace.push(`${t}ms ${line}`)
    await admin.page.waitForTimeout(100)
  }
  console.log(`[demo2] tree after the MOVE: ${trace.join(' | ')}`)
  const st = await api(admin, 'GET', `vaults/${vaultId}/status`)
  console.log(`[demo2] status after the MOVE: ${JSON.stringify(st.body)}`)
  record('Files MOVE → new name in the tree', newAt)
  record('Files MOVE → old name gone from the tree', oldGoneAt)
  expect(newAt, 'new name in the tree').toBeGreaterThanOrEqual(0)
  expect(newAt).toBeLessThanOrEqual(10_000)
  expect(oldGoneAt, 'old name gone').toBeGreaterThanOrEqual(0)
  expect(oldGoneAt).toBeLessThanOrEqual(10_000)
  await openNote(admin, RENAMED)
  await expect.poll(() => noteText(admin), { timeout: 10_000 }).toContain(external.split('\n')[2]!)
  // No resurrected copy under the old name after a few walks.
  await admin.page.waitForTimeout(5_000)
  expect((await propfind(ADMIN, FOLDER)).has(NOTE)).toBe(false)
  await showTree(admin)
  await expect(admin.frame.getByTestId(`file-item:${NOTE}`)).toHaveCount(0)

  // Settled: the files readout claims In Files.
  await expect(admin.frame.getByTestId('files-readout')).toHaveText('In Files', { timeout: 15_000 })
  await expect(admin.frame.getByTestId('files-readout')).toHaveAttribute('data-state', 'in-files')
})

// ---------------------------------------------------------------- demo 3 (read-only) and holds

test('demo 3: a read-only share gives alice a read-only grant; her edits go nowhere', async () => {
  test.setTimeout(240_000)
  await ocs(ADMIN, 'PUT', `/${shareId}`, { permissions: '1' })
  const g = await api(alice, 'POST', 'session', { vaultId })
  expect(g.status).toBe(200)
  expect(g.body.readOnly).toBe(true)

  // The live downgrade: what her open session does before she reloads (observed, not asserted).
  const d0 = Date.now()
  const before = await pillStatus(alice)
  const seen: string[] = [String(before)]
  while (Date.now() - d0 < 75_000) {
    const s = String(await pillStatus(alice))
    if (seen.at(-1) !== s) seen.push(s)
    await alice.page.waitForTimeout(1_000)
    if (seen.length >= 3 && s === 'green') break
  }
  console.log(`[demo3] alice pill across the write→read downgrade (75 s window): ${seen.join(' → ')}`)

  // A fresh open: the grant is read-only, and so is every editor.
  await openFromFiles(alice, folderId)
  await openNote(alice, RENAMED)
  await expect(pill(alice)).toHaveAttribute('data-status', 'green', { timeout: 30_000 })
  await expect(pill(alice)).toHaveAttribute('aria-label', /Read-only share/)
  await expect(editor(alice)).toHaveAttribute('contenteditable', 'false')
  const adminBefore = await noteText(admin)
  const aliceBefore = await noteText(alice)
  const bytesBefore = await davText(ADMIN, `${FOLDER}/${RENAMED}`)
  const sneaky = `alice read-only edit ${randomBytes(3).toString('hex')}`
  await appendLine(alice, sneaky)
  await alice.page.waitForTimeout(5_000)
  // The editor refused it: nothing typed, nothing waiting to be sent, the pill stays green.
  expect(await noteText(alice)).toBe(aliceBefore)
  await expect(pill(alice)).toHaveAttribute('data-status', 'green')
  expect(await noteText(admin)).toBe(adminBefore)
  expect(await davText(ADMIN, `${FOLDER}/${RENAMED}`)).toBe(bytesBefore)

  // What the shell shows a read-only user (reported).
  const shows = {
    editable: await editor(alice).getAttribute('contenteditable'),
    ariaReadonly: await editor(alice).getAttribute('aria-readonly'),
    keptLocally: (await noteText(alice)).includes(sneaky),
    pill: await pillStatus(alice),
    pillLabel: await pill(alice).getAttribute('aria-label').catch(() => null),
    files: await alice.frame.getByTestId('files-readout').textContent({ timeout: 2_000 }).catch(() => null),
  }
  console.log(`[demo3] alice (read-only) sees: ${JSON.stringify(shows)}`)
  await alice.page.screenshot({ path: test.info().outputPath('alice-read-only.png') })
})

test('holds: a mass change in Files is held; the writer confirms, the reader sees it without buttons', async () => {
  test.setTimeout(240_000)
  const notice = admin.frame.getByTestId('holds-notice')
  const treeFiles = async () =>
    (await admin.frame.locator('[data-testid^="file-item:"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(10)))).filter(
      (p) => p !== 'ohhi-host.md'
    )

  // (observed) 25 PUTs straight into the folder, all in parallel.
  const loose = Array.from({ length: BURST }, (_, i) => `loose-${String(i + 1).padStart(2, '0')}.md`)
  const p0 = Date.now()
  await Promise.all(loose.map((n, i) => put(ADMIN, `${FOLDER}/${n}`, `# Loose ${i + 1}\n`)))
  record(`${BURST} parallel PUTs into the folder (wall time)`, Date.now() - p0)
  // Settle: either a hold (answered here) or every file enrolled, before the asserted burst.
  let outcome = ''
  const s0 = Date.now()
  await expect
    .poll(
      async () => {
        const st = (await api(admin, 'GET', `vaults/${vaultId}/status`)).body
        const enrolled = Object.keys(st?.files ?? {}).length
        outcome = `${enrolled} notes known to the custodian, holds ${JSON.stringify((st?.holds ?? []).map((h: any) => ({ id: h.id, n: h.paths.length })))}`
        return (st?.holds ?? []).length > 0 || enrolled >= BURST + 1
      },
      { timeout: 30_000, intervals: [500] }
    )
    .toBe(true)
  console.log(`[holds] parallel PUTs settled after ${Date.now() - s0} ms: ${outcome}`)
  if (outcome.includes('"id"')) {
    await expect(notice).toBeVisible({ timeout: 20_000 })
    await notice.locator('[data-testid^="hold-action:"][data-testid$=":confirm"]').first().click()
    await expect(notice).toHaveCount(0, { timeout: 15_000 })
  }
  await showTree(admin)
  const l0 = Date.now()
  const all = await expect
    .poll(async () => (await treeFiles()).filter((p) => p.startsWith('loose-')).length, { timeout: 30_000, intervals: [500] })
    .toBe(BURST)
    .then(() => true, () => false)
  console.log(`[holds] parallel PUTs: ${(await treeFiles()).filter((p) => p.startsWith('loose-')).length}/${BURST} in the tree ${all ? `after ${Date.now() - l0} ms` : 'after 30 s (NOT all)'}`)

  // (asserted) one atomic burst: a folder of 25 notes written outside the vault, MOVEd in by one request.
  const staging = `${FOLDER}-staging`
  expect((await dav(ADMIN, 'MKCOL', staging)).status).toBe(201)
  const names = Array.from({ length: BURST }, (_, i) => `burst-${String(i + 1).padStart(2, '0')}.md`)
  await Promise.all(names.map((n, i) => put(ADMIN, `${staging}/${n}`, `# Burst ${i + 1}\n\nheld until someone confirms.\n`)))
  const mv = await dav(ADMIN, 'MOVE', staging, { headers: { destination: davUrl(ADMIN, `${FOLDER}/burst`), overwrite: 'F' } })
  expect(mv.status).toBe(201)
  await measure('burst MOVE → holds notice (admin)', async () => notice.isVisible(), 60_000, 250)
  await expect(notice.locator('[data-kind="breaker"]')).toBeVisible()
  const more = (await notice.locator('[data-testid^="hold-more:"]').textContent()) ?? ''
  const hold = ((await api(admin, 'GET', `vaults/${vaultId}/status`)).body?.holds ?? [])[0]
  const extra = (hold?.paths ?? []).filter((p: string) => !/^burst\/burst-\d+\.md$/.test(p))
  console.log(`[holds] notice lists 3 paths and "${more.trim()}"; the hold has ${hold?.paths?.length} paths, besides the notes: ${JSON.stringify(extra)}`)
  expect(hold?.paths?.filter((p: string) => p.startsWith('burst/burst-')).length).toBe(BURST)
  expect(more).toContain(`and ${hold.paths.length - 3} more`)
  await showTree(admin)
  expect((await treeFiles()).filter((p) => p.startsWith('burst/'))).toEqual([])
  await expect(admin.frame.getByTestId('dir-item:burst')).toHaveCount(0)

  // alice still reads the folder: the notice, no answers.
  const aliceNotice = alice.frame.getByTestId('holds-notice')
  await expect(aliceNotice).toBeVisible({ timeout: 30_000 })
  await expect(aliceNotice.locator('[data-testid^="hold-read-only:"]')).toBeVisible()
  await expect(aliceNotice.getByRole('button')).toHaveCount(0)

  const c0 = Date.now()
  await notice.locator('[data-testid^="hold-action:"][data-testid$=":confirm"]').first().click()
  await expect(notice).toHaveCount(0, { timeout: 15_000 })
  record('Confirm → notice gone', Date.now() - c0)
  await showTree(admin)
  await measure('Confirm → burst/ in the tree', async () => (await admin.frame.getByTestId('dir-item:burst').count()) === 1, 30_000, 250)
  await admin.frame.getByTestId('dir-item:burst').click()
  await measure(
    `Confirm → all ${BURST} burst notes in the tree`,
    async () => (await treeFiles()).filter((p) => p.startsWith('burst/')).length === BURST,
    30_000,
    250
  )
  await expect(aliceNotice).toHaveCount(0, { timeout: 30_000 })
  console.log(`[holds] after the confirm: ${(await treeFiles()).filter((p) => p.startsWith('loose-')).length}/${BURST} loose notes in the tree`)
})

test('demo 3: unshare — alice is out within ~70 s and a fresh session is refused', async () => {
  test.setTimeout(180_000)
  await ocs(ADMIN, 'DELETE', `/${shareId}`)
  shareId = ''
  const u0 = Date.now()
  await measure(
    'unshare → alice offline/red or vault closed',
    async () => {
      const s = await pillStatus(alice)
      return s === null || s === 'offline' || s === 'red'
    },
    90_000,
    500
  )
  console.log(`[demo3] alice after unshare: pill ${await pillStatus(alice)}, tree visible ${await alice.frame.getByTestId('file-tree').isVisible()}`)
  const res = await api(alice, 'POST', 'session', { vaultId })
  console.log(`[demo3] alice POST /api/session after unshare (${Date.now() - u0} ms): ${res.status} ${JSON.stringify(res.body)}`)
  expect(res.status).toBe(403)
})
