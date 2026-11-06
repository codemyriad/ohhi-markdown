// The Nextcloud host, mocked for e2e (nextcloud-build):
//
//   /exapps/ohhi/ui/*   the `build:nextcloud` output (dist-nextcloud/)
//   /exapps/ohhi/ws     a raw upgrade proxy to the e2e relay (start-relay.mjs, :8799)
//   /exapps/ohhi/api/*  fixtures: me, vaults, session (a token minted on the
//                       relay's operator admin API), status with or without a hold,
//                       and a hold's answer
//   /__control          the spec flips fixtures: `{holds}`, `{custodian}`,
//                       `{readOnly}`, `{removed}` — the custodian is a second
//                       Hocuspocus client that announces a `custodian`
//                       awareness state on the vault's folder doc, its `holds`
//                       count included (the shell reads the status when it moves)
//
// Usage: node e2e/nextcloud-host-server.mjs [port]. Prints `ready <port>`.
import { createServer, request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PORT = Number(process.argv[2] ?? process.env.NC_E2E_PORT ?? 4180)
const RELAY_PORT = 8799
const RELAY_HTTP = `http://localhost:${RELAY_PORT}`
const OPERATOR_SECRET = 'e2e-operator-secret'
const DIST = fileURLToPath(new URL('../dist-nextcloud/', import.meta.url))
const EMBED = fileURLToPath(new URL('../dist-embed/embed.js', import.meta.url))
const PREFIX = '/exapps/ohhi'

export const VAULT = {
  id: '5e1f0c2a-7b3d-4c8e-9a10-0e2e00000001',
  fileId: 4242,
  ownerUid: 'alice',
  ownerPath: 'Documents/Team notes',
  room: 'nc-e2e-room',
  epoch: 1,
  createdAt: '2026-10-11T00:00:00Z',
  status: 'active',
}
const HOLD = { id: 'hold-1', kind: 'breaker', paths: ['a.md', 'b.md', 'c.md', 'd.md'], since: 1 }

const state = { holds: false, custodian: false, readOnly: false, removed: false, token: '', sessions: 0, statusReads: 0, holdAnswers: [], removals: [] }
let custodianProvider = null
/** Re-announce the custodian's state (a hold came or went). */
let announceCustodian = () => {}

async function mintToken() {
  if (state.token) return state.token
  const res = await fetch(`${RELAY_HTTP}/shares`, {
    method: 'POST',
    headers: { authorization: `Bearer ${OPERATOR_SECRET}`, 'content-type': 'application/json' },
    body: JSON.stringify({ folderGuid: VAULT.room, label: 'nextcloud e2e' }),
  })
  if (!res.ok) throw new Error(`mint failed: ${res.status}`)
  state.token = (await res.json()).token
  return state.token
}

function vaultStatus() {
  return {
    vault: VAULT,
    custodian: 'running',
    holds: state.holds ? [HOLD] : [],
    files: {},
    peers: 1,
  }
}

async function startCustodian(on) {
  if (!on) {
    custodianProvider?.destroy()
    custodianProvider = null
    announceCustodian = () => {}
    return
  }
  if (custodianProvider) return
  // The provider and Yjs as libs/workspace resolves them (apps/web does not depend on them).
  const require = createRequire(fileURLToPath(new URL('../../../libs/workspace/package.json', import.meta.url)))
  const { HocuspocusProvider } = await import(pathToFileURL(require.resolve('@hocuspocus/provider')).href)
  const token = await mintToken()
  const provider = new HocuspocusProvider({ url: `ws://localhost:${RELAY_PORT}`, name: `${VAULT.room}/folder`, token })
  custodianProvider = provider
  // Every note in the folder map is announced as in Files: the readout counts
  // a note the custodian has not announced as waiting (nextcloud-build R1 #8).
  const announce = () => {
    const disk = {}
    for (const [, entry] of provider.document.getMap('files').entries()) {
      if (entry && entry.kind === 'text' && !entry.deleted) disk[entry.guid] = 'match'
    }
    provider.awareness.setLocalStateField('custodian', {
      type: 'custodian',
      instance: 'e2e-custodian',
      disk,
      blocked: {},
      holds: state.holds ? 1 : 0,
    })
  }
  announceCustodian = announce
  announce()
  provider.document.getMap('files').observe(announce)
}

function sendJson(res, status, body) {
  const bytes = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(bytes)
}

async function readBody(req) {
  let raw = ''
  for await (const chunk of req) raw += chunk
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
}

function serveStatic(res, rel) {
  const safe = normalize(rel || 'index.html').replace(/^(\.\.(\/|\\|$))+/, '')
  let file = join(DIST, safe)
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}

async function api(req, res, path) {
  const method = req.method ?? 'GET'
  if ((method === 'POST' || method === 'DELETE') && req.headers['x-ohhi-request'] !== '1')
    return sendJson(res, 403, { error: 'missing X-Ohhi-Request' })
  if (method === 'GET' && path === '/me') return sendJson(res, 200, { uid: 'alice', displayName: 'Alice Nextcloud' })
  if (method === 'GET' && path === '/vaults') return sendJson(res, 200, { own: state.removed ? [] : [VAULT], recent: [] })
  if (method === 'DELETE' && path === `/vaults/${VAULT.id}`) {
    state.removals.push(VAULT.id)
    state.removed = true
    return sendJson(res, 200, { removed: VAULT.id })
  }
  if (method === 'POST' && path === '/session') {
    const body = await readBody(req)
    if (body.vaultId !== VAULT.id && body.fileId !== VAULT.fileId) return sendJson(res, 404, { error: 'not found' })
    state.sessions++
    return sendJson(res, 200, {
      token: await mintToken(),
      expiresAt: Date.now() + 600_000,
      readOnly: state.readOnly,
      room: VAULT.room,
      vaultId: VAULT.id,
    })
  }
  if (method === 'GET' && path === `/vaults/${VAULT.id}/status`) {
    state.statusReads++
    return sendJson(res, 200, vaultStatus())
  }
  const hold = path.match(/^\/vaults\/([^/]+)\/holds\/([^/]+)$/)
  if (method === 'POST' && hold && hold[1] === VAULT.id) {
    const body = await readBody(req)
    state.holdAnswers.push({ hold: decodeURIComponent(hold[2]), action: body.action })
    state.holds = false
    announceCustodian()
    return sendJson(res, 200, vaultStatus())
  }
  return sendJson(res, 404, { error: 'not found' })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://local')
    if (url.pathname === '/__control') {
      if (req.method === 'POST') {
        const body = await readBody(req)
        if (typeof body.readOnly === 'boolean') state.readOnly = body.readOnly
        if (typeof body.removed === 'boolean') state.removed = body.removed
        if (typeof body.custodian === 'boolean') {
          state.custodian = body.custodian
          await startCustodian(body.custodian)
        }
        if (typeof body.holds === 'boolean') {
          state.holds = body.holds
          announceCustodian()
        }
      }
      return sendJson(res, 200, { ...state, token: state.token ? 'set' : '', room: VAULT.room, vault: VAULT })
    }
    // AppAPI's embedded page, as NC 35 renders it: the nested #content and the registered script.
    if (url.pathname === '/apps/app_api/embedded/ohhi/app') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(
        '<!doctype html><html><head><title>Oh Hi - Nextcloud</title>' +
          '<style>#content{position:fixed;top:50px;left:0;right:0;bottom:0;margin:8px}</style>' +
          `<script defer src="${PREFIX}/embed.js"></script></head>` +
          '<body><header style="height:50px">Nextcloud</header>' +
          '<div id="content" class="app-app_api"><div id="content"></div></div></body></html>'
      )
    }
    if (url.pathname === `${PREFIX}/embed.js` && existsSync(EMBED)) {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      return createReadStream(EMBED).pipe(res)
    }
    if (url.pathname === '/__token') return sendJson(res, 200, { room: VAULT.room, token: await mintToken() })
    if (url.pathname.startsWith(`${PREFIX}/api/`)) return await api(req, res, url.pathname.slice(`${PREFIX}/api`.length))
    if (url.pathname.startsWith(`${PREFIX}/ui/`)) return serveStatic(res, decodeURIComponent(url.pathname.slice(`${PREFIX}/ui/`.length)))
    sendJson(res, 404, { error: 'not found' })
  } catch (err) {
    if (!res.headersSent) sendJson(res, 500, { error: String(err) })
    else res.end()
  }
})

// The WebSocket: piped byte for byte to the relay, the path rewritten.
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://local')
  if (url.pathname !== `${PREFIX}/ws`) {
    socket.destroy()
    return
  }
  const upstream = connect(RELAY_PORT, 'localhost', () => {
    const lines = [`GET /${url.search} HTTP/1.1`]
    for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`)
    upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  const close = () => {
    upstream.destroy()
    socket.destroy()
  }
  upstream.on('error', close)
  socket.on('error', close)
})

// Wait for the relay before saying ready (the spec mints through it).
async function relayUp() {
  for (let i = 0; i < 100; i++) {
    const ok = await new Promise((resolve) => {
      const r = httpRequest(`${RELAY_HTTP}/`, () => resolve(true))
      r.on('error', () => resolve(false))
      r.end()
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('relay never came up')
}

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('nextcloud-host-server: dist-nextcloud/ is missing — run `rushx build:nextcloud` first')
  process.exit(1)
}
await relayUp()
server.listen(PORT, () => console.log(`ready ${PORT}`))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    custodianProvider?.destroy()
    server.close()
    process.exit(0)
  })
}
