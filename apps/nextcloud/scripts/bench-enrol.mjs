#!/usr/bin/env node
// The 1,000-note enrol bench against the live local stack (nextcloud-build, demo 3).
//
//   OHHI_NC_ADMIN_PASSWORD=… node apps/nextcloud/scripts/bench-enrol.mjs
//
// 1. Generates a vault with libs/workspace/bench/gen-vault.ts (bundled on the
//    fly with esbuild — the same generator, sizes and folders as the pull bench).
// 2. Uploads it as admin over WebDAV into a fresh `OhhiBench-<random>/`
//    (MKCOL every folder, then PUTs at parallelism 8).
// 3. `POST /api/vaults {fileId}` and polls `GET /api/vaults/:id/status`:
//    `enrolling` (N of M) → custodian `running`, enrol → `files` holds N
//    `match` entries. The idle window starts only once the custodian runs.
// 4. Idle with no peer: the custodian's PROPFINDs/GETs per minute, counted in
//    Nextcloud's access log (`docker logs spreedtest-nextcloud-1`, UA `node`).
// 5. A changed note PUT with no peer, then with a Hocuspocus peer on the room:
//    Files → the custodian's GET of that file (access log) and, with the peer,
//    Files → the doc's text.
// 6. Memory (`docker stats`) at each stage; then the folder is deleted in Files
//    and the custodian's reaction recorded (status — `folder-gone` after three
//    walks —, logs, container alive), and the vault is unenrolled with
//    `DELETE /api/vaults/:id`.
//
// With `OHHI_LOG_LEVEL=debug` in the container's env, its log carries one
// line per walk with its PROPFIND count (`docker logs nc_app_ohhi`).
//
// Env: OHHI_NC_BASE (http://localhost:28090), OHHI_NC_DAV (http://localhost:28080),
// OHHI_NC_ADMIN_PASSWORD (required), BENCH_COUNT (1000), BENCH_SEED (42),
// BENCH_PARALLEL (8), BENCH_IDLE_S (120), BENCH_KEEP=1 (keep folder + row).
// No new dependencies: esbuild, ws, yjs and @hocuspocus/provider resolve from
// the workspace packages that already have them.
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const BASE = (process.env.OHHI_NC_BASE ?? 'http://localhost:28090').replace(/\/+$/, '')
const DAV = (process.env.OHHI_NC_DAV ?? 'http://localhost:28080').replace(/\/+$/, '')
const PASSWORD = process.env.OHHI_NC_ADMIN_PASSWORD
const COUNT = Number(process.env.BENCH_COUNT ?? 1000)
const SEED = Number(process.env.BENCH_SEED ?? 42)
const PARALLEL = Number(process.env.BENCH_PARALLEL ?? 8)
const IDLE_S = Number(process.env.BENCH_IDLE_S ?? 120)
const NC_CONTAINER = process.env.OHHI_NC_NEXTCLOUD_CONTAINER ?? 'spreedtest-nextcloud-1'
const APP_CONTAINER = process.env.OHHI_NC_CONTAINER ?? 'nc_app_ohhi'
if (!PASSWORD) {
  console.error('set OHHI_NC_ADMIN_PASSWORD (docker inspect spreedtest-nextcloud-1 … NEXTCLOUD_ADMIN_PASSWORD)')
  process.exit(2)
}
const FOLDER = `OhhiBench-${randomBytes(4).toString('hex')}`
const AUTH = 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64')
const results = { folder: FOLDER, count: COUNT, seed: SEED, parallel: PARALLEL }
const t = () => performance.now()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(`[bench +${((t() - T0) / 1000).toFixed(1)}s]`, ...a)
const T0 = t()

// ------------------------------------------------------------------ helpers

const enc = (path) => path.split('/').map(encodeURIComponent).join('/')
const davUrl = (path) => `${DAV}/remote.php/dav/files/admin/${enc(path)}`
async function dav(method, path, { body, headers } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(davUrl(path), { method, headers: { authorization: AUTH, ...headers }, body })
    if (res.status >= 500 && attempt < 3) {
      await sleep(500 * (attempt + 1))
      continue
    }
    return res
  }
}
async function api(method, path, body) {
  const res = await fetch(`${BASE}/exapps/ohhi/api/${path}`, {
    method,
    headers: { authorization: AUTH, 'X-Ohhi-Request': '1', 'Sec-Fetch-Site': 'same-origin', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {}
  return { status: res.status, body: json ?? text }
}
function mem(label) {
  const out = execSync(`docker stats ${APP_CONTAINER} --no-stream --format '{{.MemUsage}} | {{.CPUPerc}}'`, { encoding: 'utf8' }).trim()
  results[`mem_${label}`] = out
  log(`docker stats (${label}): ${out}`)
}
/** Nextcloud access-log lines since `sinceIso` (docker -t timestamps). */
function accessLog(sinceIso) {
  const out = execFileSync('docker', ['logs', '-t', '--since', sinceIso, NC_CONTAINER], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
  return out.split('\n').filter((l) => l.includes(`/remote.php/dav/files/admin/${FOLDER}`) && l.includes('"node"'))
}
const tsOf = (line) => Date.parse(line.slice(0, line.indexOf(' ')))
async function pool(items, n, fn) {
  let i = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const k = i++
        await fn(items[k], k)
      }
    })
  )
}

// ------------------------------------------------------------------ 1. generate (the bench's own generator)

const require = createRequire(join(REPO, 'apps/nextcloud/package.json'))
const esbuild = require('esbuild')
const work = await mkdtemp(join(tmpdir(), 'ohhi-bench-'))
const genOut = join(work, 'gen-vault.mjs')
await esbuild.build({
  entryPoints: [join(REPO, 'libs/workspace/bench/gen-vault.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: genOut,
  logLevel: 'error',
})
const { generateVault } = await import(pathToFileURL(genOut).href)
const vaultDir = join(work, 'vault')
const gen = await generateVault(vaultDir, COUNT, SEED)
results.generated = { files: gen.files, bytes: gen.bytes, maxDepth: gen.maxDepth }
log(`generated ${gen.files} notes, ${(gen.bytes / 1e6).toFixed(2)} MB, depth ≤ ${gen.maxDepth}`)

// ------------------------------------------------------------------ 2. upload

mem('before')
let t1 = t()
const dirs = [...new Set(gen.paths.flatMap((p) => p.split('/').slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join('/'))))].sort(
  (a, b) => a.split('/').length - b.split('/').length
)
if ((await dav('MKCOL', FOLDER)).status !== 201) throw new Error('MKCOL root failed')
for (const d of dirs) {
  const s = (await dav('MKCOL', `${FOLDER}/${d}`)).status
  if (s !== 201 && s !== 405) throw new Error(`MKCOL ${d} → ${s}`)
}
await pool(gen.paths, PARALLEL, async (p) => {
  const res = await dav('PUT', `${FOLDER}/${p}`, { body: await readFile(join(vaultDir, p)), headers: { 'content-type': 'text/markdown' } })
  if (!res.ok) throw new Error(`PUT ${p} → ${res.status}`)
})
results.upload_s = +((t() - t1) / 1000).toFixed(1)
log(`uploaded ${dirs.length} folders + ${gen.paths.length} notes in ${results.upload_s} s`)
const pf = await dav('PROPFIND', FOLDER, {
  headers: { depth: '0', 'content-type': 'application/xml' },
  body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><oc:fileid/></d:prop></d:propfind>',
})
const fileId = Number(/<oc:fileid>(\d+)<\/oc:fileid>/.exec(await pf.text())?.[1])
log(`folder fileId ${fileId}`)

// ------------------------------------------------------------------ 3. enrol

let vaultId = ''
try {
  t1 = t()
  const enrolledAt = new Date().toISOString()
  const row = await api('POST', 'vaults', { fileId })
  if (row.status !== 200) throw new Error(`enrol → ${row.status} ${JSON.stringify(row.body)}`)
  vaultId = row.body.id
  results.enrol_request_ms = Math.round(t() - t1)
  log(`POST /api/vaults → ${row.status} in ${results.enrol_request_ms} ms (vault ${vaultId})`)
  let runningAt = null
  let lastState = null
  let lastLog = 0
  let st = null
  for (;;) {
    st = (await api('GET', `vaults/${vaultId}/status`)).body
    const files = Object.values(st?.files ?? {})
    const match = files.filter((s) => s === 'match').length
    if (st?.custodian !== lastState) {
      log(`custodian state: ${st?.custodian} (${Math.round(t() - t1)} ms)`)
      lastState = st?.custodian
    }
    if (runningAt === null && st?.custodian === 'running') {
      runningAt = t() - t1
      results.enrol_to_running_ms = Math.round(runningAt)
      log(`custodian running after ${Math.round(runningAt)} ms`)
    }
    if (t() - lastLog > 5000) {
      lastLog = t()
      log(`status: ${st?.custodian} files=${files.length} match=${match} holds=${st?.holds?.length ?? '?'} peers=${st?.peers}`)
    }
    if (match >= COUNT && st?.custodian === 'running') break
    if (t() - t1 > 15 * 60_000) throw new Error(`timeout: ${match}/${COUNT} match`)
    await sleep(250)
  }
  results.enrol_to_all_match_s = +((t() - t1) / 1000).toFixed(1)
  log(`files: ${COUNT} match and custodian running after ${results.enrol_to_all_match_s} s`)
  const enrolLines = accessLog(enrolledAt)
  results.enrol_requests = countMethods(enrolLines)
  log(`custodian requests during enrol: ${JSON.stringify(results.enrol_requests)}`)
  mem('after_enrol')

  // ---------------------------------------------------------------- 4. idle, no peer
  const idleFrom = new Date().toISOString()
  log(`idle for ${IDLE_S} s with no peer…`)
  await sleep(IDLE_S * 1000)
  const idle = accessLog(idleFrom)
  results.idle_no_peer = { seconds: IDLE_S, ...perMinute(countMethods(idle), IDLE_S) }
  log(`idle, no peer: ${JSON.stringify(results.idle_no_peer)}`)
  mem('idle')

  // ---------------------------------------------------------------- 5a. Files → custodian, no peer
  const target = gen.paths.find((p) => !/[^A-Za-z0-9/._-]/.test(p)) ?? gen.paths[0]
  results.changed_note = target
  results.files_to_custodian_no_peer_ms = await changeAndWatch(target, 'no peer', 120_000)

  // ---------------------------------------------------------------- 5b. with a Hocuspocus peer
  const peer = await connectPeer(vaultId, target)
  await sleep(5000)
  const peerFrom = new Date().toISOString()
  const pw0 = t()
  results.files_to_custodian_with_peer_ms = await changeAndWatch(target, 'with peer', 60_000, peer)
  await sleep(Math.max(0, 60_000 - (t() - pw0)))
  results.with_peer = { seconds: 60, ...perMinute(countMethods(accessLog(peerFrom)), 60) }
  log(`with a peer (60 s window): ${JSON.stringify(results.with_peer)}`)
  mem('with_peer')
  peer.destroy()

  // ---------------------------------------------------------------- 6. the folder deleted in Files
  if (process.env.BENCH_KEEP !== '1') {
    const delFrom = new Date().toISOString()
    const del = await dav('DELETE', FOLDER)
    log(`DELETE ${FOLDER} → ${del.status}`)
    const seen = []
    const d0 = t()
    while (t() - d0 < 150_000) {
      const s = await api('GET', `vaults/${vaultId}/status`)
      const key = `${s.status} ${s.body?.custodian ?? s.body?.error} ${s.body?.reason ?? ''} ${s.body?.vault?.status ?? ''}`
      if (seen.at(-1)?.key !== key) seen.push({ key, at_ms: Math.round(t() - d0) })
      await sleep(2000)
    }
    results.after_delete = seen
    const r = spawnSync('docker', ['logs', '--since', delFrom, APP_CONTAINER], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    const appLogs = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => l.includes(vaultId))
    results.after_delete_log = { lines: appLogs.length, distinct: [...new Set(appLogs.map((l) => l.replace(vaultId, '<vault>')))] }
    results.after_delete_walks = countMethods(accessLog(delFrom))
    results.container_running = execSync(`docker inspect ${APP_CONTAINER} --format '{{.State.Running}} restarts={{.RestartCount}}'`, { encoding: 'utf8' }).trim()
    log(`after the delete: ${JSON.stringify(seen)}; logs ${JSON.stringify(results.after_delete_log)}; container ${results.container_running}`)
    mem('after_delete')
  }
} finally {
  if (process.env.BENCH_KEEP !== '1') {
    await dav('DELETE', FOLDER).catch(() => {})
    if (vaultId) {
      const del = await api('DELETE', `vaults/${vaultId}`)
      log(`DELETE /api/vaults/${vaultId} → ${del.status}`)
    }
  }
  await rm(work, { recursive: true, force: true })
  console.log(JSON.stringify(results, null, 2))
}

// ------------------------------------------------------------------ measurement helpers

function countMethods(lines) {
  const c = {}
  for (const l of lines) {
    const m = /"([A-Z]+) \/remote\.php/.exec(l)?.[1] ?? '?'
    c[m] = (c[m] ?? 0) + 1
  }
  return c
}
function perMinute(counts, seconds) {
  const out = {}
  for (const [k, v] of Object.entries(counts)) out[`${k}_per_min`] = +((v * 60) / seconds).toFixed(1)
  return out
}

/** PUT a changed note; ms until the custodian GETs it (and, with a peer, until the doc holds the new text). */
async function changeAndWatch(path, label, timeoutMs, peer) {
  const marker = `bench change ${label} ${randomBytes(3).toString('hex')}`
  const old = await (await dav('GET', `${FOLDER}/${path}`)).text()
  const sinceIso = new Date(Date.now() - 1000).toISOString()
  const res = await dav('PUT', `${FOLDER}/${path}`, { body: `${old}\n${marker}\n`, headers: { 'content-type': 'text/markdown' } })
  const putDone = Date.now()
  const p0 = t()
  if (!res.ok) throw new Error(`PUT → ${res.status}`)
  let docMs = null
  if (peer) peer.onText((text) => docMs === null && text.includes(marker) && (docMs = Math.round(t() - p0)))
  const needle = `"GET /remote.php/dav/files/admin/${enc(FOLDER)}/${enc(path)} `
  let getMs = null
  while (t() - p0 < timeoutMs && (getMs === null || (peer && docMs === null))) {
    if (getMs === null) {
      const hit = accessLog(sinceIso).find((l) => l.includes(needle) && tsOf(l) >= putDone - 50)
      if (hit) getMs = tsOf(hit) - putDone
    }
    await sleep(250)
  }
  log(`Files → custodian GET (${label}): ${getMs} ms${peer ? `; Files → doc text at the peer: ${docMs} ms` : ''}`)
  return peer ? { custodian_get: getMs, doc_text: docMs } : getMs
}

/** A Hocuspocus peer on the vault's room (basic auth on the upgrade, the sidecar's Origin). */
async function connectPeer(vaultId, path) {
  const reqWs = createRequire(join(REPO, 'libs/workspace/package.json'))
  const { HocuspocusProvider, HocuspocusProviderWebsocket } = await import(pathToFileURL(reqWs.resolve('@hocuspocus/provider')).href)
  const Y = await import(pathToFileURL(reqWs.resolve('yjs')).href)
  const WS = createRequire(join(REPO, 'apps/relay/package.json'))('ws')
  class AuthedWs extends WS {
    constructor(url, protocols) {
      // The page's own origin, as a browser's handshake carries it (the ExApp requires one).
      super(url, protocols, { headers: { authorization: AUTH, origin: BASE } })
    }
  }
  const grant = (await api('POST', 'session', { vaultId })).body
  // One socket for both docs, as the shell's room socket (libs/workspace/src/providers.ts).
  // The grant names the relay, or (later contracts) the page derives it from its host.
  const relay = grant.relay || `${BASE.replace(/^http/, 'ws')}/exapps/ohhi/ws`
  const socket = new HocuspocusProviderWebsocket({ url: relay, WebSocketPolyfill: AuthedWs })
  const open = (name, doc) =>
    new Promise((resolve, reject) => {
      const p = new HocuspocusProvider({
        websocketProvider: socket,
        name,
        token: grant.token,
        document: doc,
        onSynced: () => resolve(p),
        onAuthenticationFailed: (e) => reject(new Error(`peer auth failed: ${JSON.stringify(e)}`)),
      })
      p.attach()
      setTimeout(() => reject(new Error(`peer ${name} did not sync`)), 30_000)
    })
  const folderDoc = new Y.Doc()
  const t0 = t()
  const folder = await open(`${grant.room}/folder`, folderDoc)
  const entry = folderDoc.getMap('files').get(path)
  results.peer_folder_sync_ms = Math.round(t() - t0)
  log(`peer: folder doc synced in ${results.peer_folder_sync_ms} ms (${folderDoc.getMap('files').size} entries); ${path} → ${entry?.guid}`)
  const noteDoc = new Y.Doc()
  const note = await open(`${grant.room}/${entry.guid}`, noteDoc)
  const listeners = []
  noteDoc.getText('content').observe(() => listeners.forEach((fn) => fn(noteDoc.getText('content').toString())))
  return {
    onText: (fn) => listeners.push(fn),
    destroy: () => {
      note.destroy()
      folder.destroy()
      socket.destroy()
    },
  }
}
