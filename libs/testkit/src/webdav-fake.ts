/**
 * An in-memory WebDAV server on `node:http`, shaped like Nextcloud Files as
 * measured in spike S16 (Q2/Q3): PROPFIND Depth 0/1 with `d:getetag`
 * (quoted), `oc:fileid`, `oc:permissions`, `oc:owner-id`, `nc:mount-type`,
 * `d:resourcetype`, `d:getcontentlength`; folder etags that change whenever
 * anything below them changes; `PUT` honouring `If-Match` / `If-None-Match: *`
 * (412) and answering `ETag` + `OC-ETag`; `MKCOL` (405 exists, 409 no parent);
 * `MOVE` with an absolute `Destination` and `Overwrite` (409 no parent);
 * `DELETE` with `If-Match` (never matching a collection). Measured Nextcloud quirks are mirrored: `GET` on a
 * collection is 200 with an HTML notice and no ETag; `PUT` under a missing
 * parent is 404. `fileid`s are stable across MOVE.
 *
 * With `clock`, every response carries `Date`, files carry `Last-Modified` /
 * `d:getlastmodified` (second resolution), and — with `sameSecondEtags` — a
 * second write to a file inside the same clock second KEEPS its etag, which
 * is what Nextcloud 35 does (measured: `a` → `bbbbbb` in one second kept the
 * etag). Folder etags always move.
 *
 * The served root is `<url>` = `http://127.0.0.1:<port>/remote.php/dav/files/<owner>/`;
 * every path below (the map keys, `requests[].path`) is relative to it, `''`
 * being the root itself.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface WebDavFakeEntry {
  kind: 'file' | 'dir'
  bytes: Uint8Array
  /** Quoted, as Nextcloud sends it: `"…"`. */
  etag: string
  fileid: number
  /** Overrides the owner for this entry and everything below it. */
  owner?: string
  /** `nc:mount-type` for this entry and everything below it (`''` = home). */
  mountType?: string
  /** Last modification, epoch ms floored to the second (only with a `clock`). */
  mtime?: number
}

export interface WebDavFakeOptions {
  owner: string
  /** Time source for `Date` / `Last-Modified` (a SimClock in tests). */
  clock?: { now(): number }
  /** Keep a file's etag for a rewrite inside the same clock second (NC 35). Needs `clock`. */
  sameSecondEtags?: boolean
}

export interface WebDavFakeRequest {
  method: string
  /** Decoded, root-relative path (`''` = the root); the raw URL path when outside it. */
  path: string
  depth?: string
}

export interface WebDavFake {
  /** The owner's root collection URL, with a trailing slash. */
  url: string
  close(): Promise<void>
  /** Every entry, files AND dirs, by root-relative path; `''` is the root. */
  files: Map<string, WebDavFakeEntry>
  /** Seed a file (parents created), as an external writer would. Bumps etags. */
  put(path: string, content: string | Uint8Array): void
  /** Seed a directory (parents created). */
  mkdir(path: string): void
  setOwner(path: string, uid: string): void
  setMountType(path: string, type: string): void
  etagOf(path: string): string | undefined
  /** A new etag for `path` (and its ancestors), same bytes. */
  bump(path: string): void
  /** Answer the next `times` requests matching `method` (and `path`, when given) with `status`. */
  failNext(method: string, status: number, opts?: { path?: string; times?: number }): void
  /** Move an entry (and its subtree) as another client would: file ids kept, etags bumped. */
  move(from: string, to: string): void
  /** Called with each request's method and root-relative path BEFORE it is answered (races in tests). */
  beforeRequest: ((method: string, path: string) => void) | null
  requests: WebDavFakeRequest[]
}

const enc = new TextEncoder()

const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    req.on('error', reject)
  })
}

export async function createWebDavFake(opts: WebDavFakeOptions): Promise<WebDavFake> {
  const owner = opts.owner
  const second = (): number | undefined =>
    opts.clock ? Math.floor(opts.clock.now() / 1000) * 1000 : undefined
  const httpDate = (ms: number): string => new Date(ms).toUTCString()
  const rootPath = `/remote.php/dav/files/${encodeURIComponent(owner)}/`
  const files = new Map<string, WebDavFakeEntry>()
  const requests: WebDavFakeRequest[] = []
  const failures: { method: string; status: number; path?: string; times: number }[] = []
  let etagSeq = 0
  let fileidSeq = 100
  const newEtag = (): string => `"fake${(++etagSeq).toString(16).padStart(8, '0')}"`

  files.set('', { kind: 'dir', bytes: new Uint8Array(), etag: newEtag(), fileid: fileidSeq++ })

  /** New etag for `path`'s ancestors (and `path` itself when `self`). */
  const touch = (path: string, self = true): void => {
    if (self) {
      const e = files.get(path)
      if (e) e.etag = newEtag()
    }
    for (let p = path; p !== ''; ) {
      p = parentOf(p)
      const e = files.get(p)
      if (e) e.etag = newEtag()
    }
  }

  const ensureDir = (path: string): void => {
    if (path === '' || files.has(path)) return
    ensureDir(parentOf(path))
    files.set(path, { kind: 'dir', bytes: new Uint8Array(), etag: newEtag(), fileid: fileidSeq++ })
    touch(path, false)
  }

  const putFile = (path: string, bytes: Uint8Array): 'created' | 'updated' => {
    const cur = files.get(path)
    const now = second()
    if (cur) {
      const sticky = opts.sameSecondEtags === true && now !== undefined && cur.mtime === now
      cur.bytes = bytes
      cur.mtime = now
      touch(path, !sticky)
      return 'updated'
    }
    files.set(path, { kind: 'file', bytes, etag: newEtag(), fileid: fileidSeq++, mtime: now })
    touch(path, false)
    return 'created'
  }

  const subtree = (path: string): string[] =>
    [...files.keys()].filter((p) => p === path || (path === '' ? p !== '' : p.startsWith(`${path}/`)))

  const inherited = (path: string, key: 'owner' | 'mountType'): string | undefined => {
    for (let p = path; ; p = parentOf(p)) {
      const v = files.get(p)?.[key]
      if (v !== undefined) return v
      if (p === '') return undefined
    }
  }

  const hrefOf = (path: string, e: WebDavFakeEntry): string =>
    rootPath +
    (path === '' ? '' : path.split('/').map(encodeURIComponent).join('/') + (e.kind === 'dir' ? '/' : ''))

  const propXml = (path: string, e: WebDavFakeEntry): string => {
    const isDir = e.kind === 'dir'
    return (
      `<d:response><d:href>${xmlEscape(hrefOf(path, e))}</d:href><d:propstat><d:prop>` +
      `<d:getetag>${xmlEscape(e.etag)}</d:getetag>` +
      `<d:resourcetype>${isDir ? '<d:collection/>' : ''}</d:resourcetype>` +
      (isDir ? '' : `<d:getcontentlength>${e.bytes.length}</d:getcontentlength>`) +
      (e.mtime === undefined ? '' : `<d:getlastmodified>${httpDate(e.mtime)}</d:getlastmodified>`) +
      `<oc:fileid>${e.fileid}</oc:fileid>` +
      `<oc:permissions>${isDir ? 'RGDNVCK' : 'RGDNVW'}</oc:permissions>` +
      `<oc:owner-id>${xmlEscape(inherited(path, 'owner') ?? owner)}</oc:owner-id>` +
      `<nc:mount-type>${xmlEscape(inherited(path, 'mountType') ?? '')}</nc:mount-type>` +
      `</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
    )
  }

  /** Root-relative decoded path of a URL path, or null when outside the root / unsafe. */
  const relOf = (urlPath: string): string | null => {
    if (!urlPath.startsWith(rootPath) && urlPath !== rootPath.slice(0, -1)) return null
    const rest = urlPath.slice(rootPath.length)
    let segs: string[]
    try {
      segs = rest
        .split('/')
        .filter((s) => s !== '')
        .map((s) => decodeURIComponent(s))
    } catch {
      return null
    }
    if (segs.some((s) => s === '.' || s === '..' || s.includes('/'))) return null
    return segs.join('/')
  }

  const ifMatchOk = (header: string | undefined, e: WebDavFakeEntry | undefined): boolean => {
    if (header === undefined) return true
    if (!e) return false
    if (header.trim() === '*') return true
    return header.split(',').some((t) => t.trim() === e.etag)
  }

  let beforeRequest: ((method: string, path: string) => void) | null = null
  const moveEntry = (path: string, dest: string): void => {
    const moving = subtree(path).map((p) => [p, files.get(p)!] as const)
    for (const [p] of moving) files.delete(p)
    for (const [p, n] of moving) files.set(dest + p.slice(path.length), n)
    touch(path, false)
    touch(dest, false)
  }

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const urlPath = new URL(req.url ?? '/', 'http://fake').pathname
    const body = await readBody(req)
    const path = relOf(urlPath)
    const depth = req.headers.depth as string | undefined
    requests.push({ method, path: path ?? urlPath, ...(depth !== undefined ? { depth } : {}) })
    beforeRequest?.(method, path ?? urlPath)
    const reply = (status: number, headers: Record<string, string> = {}, out?: Uint8Array | string): void => {
      const now = second()
      res.writeHead(status, now === undefined ? headers : { Date: httpDate(now), ...headers })
      res.end(out)
    }

    const fail = failures.find(
      (f) => f.times > 0 && f.method === method && (f.path === undefined || f.path === path)
    )
    if (fail) {
      fail.times--
      return reply(fail.status)
    }
    if (path === null) return reply(404)
    const e = files.get(path)

    switch (method) {
      case 'PROPFIND': {
        if (!e) return reply(404)
        const entries: [string, WebDavFakeEntry][] = [[path, e]]
        if (e.kind === 'dir' && depth !== '0') {
          for (const [p, c] of files) if (p !== path && p !== '' && parentOf(p) === path) entries.push([p, c])
        }
        const xml =
          '<?xml version="1.0"?>\n<d:multistatus xmlns:d="DAV:" xmlns:s="http://sabredav.org/ns" ' +
          'xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">' +
          entries.map(([p, c]) => propXml(p, c)).join('') +
          '</d:multistatus>'
        return reply(207, { 'Content-Type': 'application/xml; charset=utf-8' }, xml)
      }
      case 'GET': {
        if (!e) return reply(404)
        // Nextcloud 35 (measured): a collection GET is 200, an HTML notice, no ETag.
        if (e.kind === 'dir') return reply(200, { 'Content-Type': 'text/html; charset=UTF-8' }, 'This is the WebDAV interface.')
        return reply(
          200,
          {
            ETag: e.etag,
            'OC-ETag': e.etag,
            'Content-Type': 'application/octet-stream',
            ...(e.mtime === undefined ? {} : { 'Last-Modified': httpDate(e.mtime) }),
          },
          e.bytes
        )
      }
      case 'PUT': {
        // A missing parent is 404 on Nextcloud 35 (measured), not Sabre's 409.
        if (path === '' || files.get(parentOf(path))?.kind !== 'dir') return reply(404)
        if (e?.kind === 'dir') return reply(405)
        const inm = req.headers['if-none-match'] as string | undefined
        if (inm !== undefined && inm.trim() === '*' && e) return reply(412)
        if (!ifMatchOk(req.headers['if-match'] as string | undefined, e)) return reply(412)
        const what = putFile(path, body)
        const etag = files.get(path)!.etag
        return reply(what === 'created' ? 201 : 204, {
          ETag: etag,
          'OC-ETag': etag,
          'OC-FileId': String(files.get(path)!.fileid),
        })
      }
      case 'MKCOL': {
        if (e) return reply(405)
        if (files.get(parentOf(path))?.kind !== 'dir') return reply(409)
        ensureDir(path)
        return reply(201)
      }
      case 'MOVE': {
        const destHeader = req.headers.destination as string | undefined
        if (!destHeader) return reply(400)
        let dest: string | null
        try {
          dest = relOf(new URL(destHeader).pathname)
        } catch {
          dest = null
        }
        if (dest === null || dest === '') return reply(403)
        if (!e || path === '') return reply(404)
        if (dest === path || dest.startsWith(`${path}/`)) return reply(409)
        if (files.get(parentOf(dest))?.kind !== 'dir') return reply(409)
        if (!ifMatchOk(req.headers['if-match'] as string | undefined, e)) return reply(412)
        const existed = files.has(dest)
        if (existed) {
          if ((req.headers.overwrite as string | undefined)?.toUpperCase() === 'F') return reply(412)
          for (const p of subtree(dest)) files.delete(p)
        }
        moveEntry(path, dest)
        return reply(existed ? 204 : 201)
      }
      case 'DELETE': {
        if (!e || path === '') return reply(404)
        const ifMatch = req.headers['if-match'] as string | undefined
        // Nextcloud 35 (measured): If-Match never matches a collection.
        if (ifMatch !== undefined && e.kind === 'dir') return reply(412)
        if (!ifMatchOk(ifMatch, e)) return reply(412)
        for (const p of subtree(path)) files.delete(p)
        touch(path, false)
        return reply(204)
      }
      default:
        return reply(405)
    }
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.unref()
  const port = (server.address() as AddressInfo).port

  const must = (path: string): WebDavFakeEntry => {
    const e = files.get(path)
    if (!e) throw new Error(`webdav-fake: no entry at ${path}`)
    return e
  }

  return {
    url: `http://127.0.0.1:${port}${rootPath}`,
    files,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
    put(path, content) {
      ensureDir(parentOf(path))
      putFile(path, typeof content === 'string' ? enc.encode(content) : content.slice())
    },
    mkdir: ensureDir,
    setOwner(path, uid) {
      must(path).owner = uid
    },
    setMountType(path, type) {
      must(path).mountType = type
    },
    etagOf: (path) => files.get(path)?.etag,
    bump(path) {
      must(path)
      touch(path)
    },
    failNext(method, status, o = {}) {
      failures.push({ method, status, path: o.path, times: o.times ?? 1 })
    },
    move(from, to) {
      must(from)
      ensureDir(parentOf(to))
      moveEntry(from, to)
    },
    get beforeRequest() {
      return beforeRequest
    },
    set beforeRequest(fn) {
      beforeRequest = fn
    },
  }
}
