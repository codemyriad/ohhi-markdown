/**
 * The ExApp tests' shared fixtures: a throwaway dir, polling, a router served
 * on an ephemeral port, a vault row, the in-process relay with the
 * custodian's device token, a header-carrying WebSocket (Node 22's undici
 * WebSocket takes `{headers}`), a Hocuspocus peer, and a fake Nextcloud
 * answering SEARCH / PROPFIND / GET for a small per-uid tree.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { createRelay, type Relay } from '@ohhi/relay'
import type { Clock } from '@ohhi/vault'
import * as Y from 'yjs'
import { encodeAppApiAuth } from '../src/appapi.js'
import { handleRequest, type Router } from '../src/http.js'
import { createAuthenticate } from '../src/relay-auth.js'
import type { VaultRow } from '../src/types.js'

export const SECRET = 'test-app-secret'
export const NC_ORIGIN_PLACEHOLDER = 'http://nc.invalid'

export function tempDir(label: string): { path: string; remove(): void } {
  const path = mkdtempSync(join(tmpdir(), `ohhi-nc-${label}-`))
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) }
}

export async function until(cond: () => boolean, what: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

const servers = new Set<Server>()

/** `router` behind `handleRequest` on 127.0.0.1:<ephemeral>; its base URL. `closeServers` in `afterEach`. */
export async function serveRouter(router: Router): Promise<string> {
  const server = createServer((req, res) => void handleRequest(router, req, res))
  servers.add(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

export async function closeServers(): Promise<void> {
  for (const server of [...servers]) {
    servers.delete(server)
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  }
}

/** A vault row owned by alice over `Notes`, fresh id and room unless overridden. */
export function vaultRow(over: Partial<VaultRow> = {}): VaultRow {
  return {
    id: crypto.randomUUID(),
    fileId: 10,
    ownerUid: 'alice',
    ownerPath: 'Notes',
    room: crypto.randomUUID(),
    epoch: 1,
    createdAt: new Date(0).toISOString(),
    status: 'active',
    ...over,
  }
}

/** The in-process relay, listening, with the custodian's device `token` in its shares table. */
export async function relayWithDeviceToken(opts: {
  dbPath: string
  clock: Clock
  token: string
  vaultIdForRoom: (room: string) => string | null
}): Promise<Relay> {
  const relay: Relay = createRelay({
    dbPath: opts.dbPath,
    authenticate: createAuthenticate({
      relayDb: { getShare: (t) => relay.db.getShare(t) },
      appSecret: SECRET,
      origins: { ncOrigin: null, publicOrigins: [] },
      clock: opts.clock,
      vaultIdForRoom: opts.vaultIdForRoom,
    }),
  })
  await relay.listen()
  relay.db.addShare({ token: opts.token, folderGuid: 'instance', kind: 'device', ncUid: null, vaultId: null })
  return relay
}

export function authHeader(uid: string, secret = SECRET): string {
  return encodeAppApiAuth(uid, secret)
}

/** A WebSocket class that sends `headers` on the upgrade (what HaRP + the browser add). */
export function headerWebSocket(headers: Record<string, string>): typeof WebSocket {
  return class HeaderWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, { headers, ...(protocols !== undefined ? { protocols } : {}) } as unknown as string[])
    }
  } as unknown as typeof WebSocket
}

export interface Peer {
  doc: Y.Doc
  provider: HocuspocusProvider
  socket: HocuspocusProviderWebsocket
  reason(): string | null
  closed(): boolean
  destroy(): void
}

export function connectPeer(port: number, name: string, token: string, headers: Record<string, string> = {}): Peer {
  const doc = new Y.Doc()
  let reason: string | null = null
  let closed = false
  const socket = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${port}`,
    WebSocketPolyfill: headerWebSocket(headers),
    // A closed peer must stay closed in a test that asserts the close.
    maxAttempts: 1,
  })
  socket.on('close', () => {
    closed = true
  })
  const provider = new HocuspocusProvider({
    name,
    document: doc,
    token,
    websocketProvider: socket,
    onAuthenticationFailed: (data) => {
      reason = data.reason
    },
  })
  provider.attach()
  return {
    doc,
    provider,
    socket,
    reason: () => reason,
    closed: () => closed,
    destroy() {
      provider.destroy()
      socket.destroy()
    },
  }
}

/** One entry of the fake Nextcloud tree, as `uid` sees it. */
export interface FakeNode {
  /** Home-relative path; '' is the home itself. */
  path: string
  fileId: number
  dir: boolean
  owner: string
  permissions: string
  mountType?: string
  bytes?: string
}

export interface FakeNextcloud {
  url: string
  /** Per uid: the tree that uid sees. Mutate freely between calls. */
  trees: Map<string, FakeNode[]>
  requests: { method: string; url: string; uid: string | null; redirect?: string }[]
  /** Answer SEARCH with this status instead (e.g. 501 to force the /f/ fallback). */
  searchStatus: number | null
  /** Answer PROPFIND Depth: infinity with this status (403 forces the walk). */
  infinityStatus: number | null
  close(): Promise<void>
}

function uidOf(req: IncomingMessage): string | null {
  const h = req.headers['authorization-app-api']
  if (typeof h !== 'string') return null
  const [uid, secret] = Buffer.from(h, 'base64').toString('utf8').split(':')
  return secret === SECRET ? (uid ?? null) : null
}

function enc(path: string): string {
  return path
    .split('/')
    .filter((s) => s !== '')
    .map(encodeURIComponent)
    .join('/')
}

function responseXml(uid: string, n: FakeNode): string {
  const href = `/remote.php/dav/files/${encodeURIComponent(uid)}/${enc(n.path)}${n.dir && n.path !== '' ? '/' : ''}`
  return (
    `<d:response><d:href>${href}</d:href><d:propstat><d:prop>` +
    `<oc:fileid>${n.fileId}</oc:fileid><oc:permissions>${n.permissions}</oc:permissions>` +
    `<oc:owner-id>${n.owner}</oc:owner-id><nc:mount-type>${n.mountType ?? ''}</nc:mount-type>` +
    `<d:resourcetype>${n.dir ? '<d:collection/>' : ''}</d:resourcetype><d:getetag>"e${n.fileId}"</d:getetag>` +
    `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  )
}

function multistatus(uid: string, nodes: FakeNode[]): string {
  return (
    `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">` +
    nodes.map((n) => responseXml(uid, n)).join('') +
    `</d:multistatus>`
  )
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export async function startFakeNextcloud(): Promise<FakeNextcloud> {
  const fake: Omit<FakeNextcloud, 'url' | 'close'> = { trees: new Map(), requests: [], searchStatus: null, infinityStatus: null }
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const uid = uidOf(req)
      const url = new URL(req.url ?? '/', 'http://x')
      fake.requests.push({ method: req.method ?? '', url: url.pathname, uid })
      const body = await bodyOf(req)
      if (uid === null) {
        res.writeHead(401).end()
        return
      }
      const tree = fake.trees.get(uid) ?? []
      if (req.method === 'SEARCH' && url.pathname === '/remote.php/dav/') {
        if (fake.searchStatus !== null) return void res.writeHead(fake.searchStatus).end()
        const id = Number(/<d:literal>(\d+)<\/d:literal>/.exec(body)?.[1])
        const hit = tree.filter((n) => n.fileId === id)
        res.writeHead(207, { 'content-type': 'application/xml' }).end(multistatus(uid, hit))
        return
      }
      const m = /^\/index\.php\/f\/(\d+)$/.exec(url.pathname)
      if (req.method === 'GET' && m) {
        const hit = tree.find((n) => n.fileId === Number(m[1]))
        if (!hit) return void res.writeHead(404).end()
        res.writeHead(303, { location: `/apps/files/files/${hit.fileId}?dir=/${hit.path}` }).end()
        return
      }
      const prefix = `/remote.php/dav/files/${encodeURIComponent(uid)}/`
      if (url.pathname.startsWith(prefix)) {
        const path = decodeURIComponent(url.pathname.slice(prefix.length)).replace(/\/+$/, '')
        const node = tree.find((n) => n.path === path)
        if (req.method === 'GET') {
          if (!node || node.dir) return void res.writeHead(404).end()
          res.writeHead(200).end(node.bytes ?? '')
          return
        }
        if (req.method === 'DELETE') {
          if (!node || node.dir) return void res.writeHead(404).end()
          tree.splice(tree.indexOf(node), 1)
          res.writeHead(204).end()
          return
        }
        if (req.method === 'PROPFIND') {
          if (!node) return void res.writeHead(404).end()
          const depth = req.headers.depth ?? '1'
          if (depth === 'infinity' && fake.infinityStatus !== null) return void res.writeHead(fake.infinityStatus).end()
          const under = (p: string): boolean => path === '' || p === path || p.startsWith(`${path}/`)
          const nodes =
            depth === '0'
              ? [node]
              : depth === '1'
                ? tree.filter((n) => n.path === path || (under(n.path) && n.path.split('/').length === (path === '' ? 0 : path.split('/').length) + 1 && n.path !== ''))
                : tree.filter((n) => under(n.path))
          res.writeHead(207, { 'content-type': 'application/xml' }).end(multistatus(uid, nodes))
          return
        }
      }
      res.writeHead(404).end()
    })()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return Object.assign(fake as FakeNextcloud, {
    url,
    close: () => new Promise<void>((r) => server.close(() => r())),
  })
}
