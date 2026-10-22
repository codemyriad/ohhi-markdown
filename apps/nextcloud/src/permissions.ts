/**
 * Nextcloud permissions → relay grants (nextcloud-build decisions 5, 15).
 *
 * `NcDav` is the ExApp's small WebDAV client for the CALLER's view of Files:
 * find a file id's path (`SEARCH` on `oc:fileid`, verified on the local NC 35
 * stack; fallback `GET /index.php/f/<id>`'s redirect `?dir=`), PROPFIND a
 * folder (depth 0/1/infinity) and read one file. Every call goes through
 * appapi.ts's `ncFetch` (the AppAPI header for the uid it acts as,
 * `NEXTCLOUD_URL`'s origin only, no redirect followed, a clock timeout), and
 * every path segment through the vault's `pathSegments` (no `..`). Nothing
 * logs a URL with a path.
 *
 * `createPermissions` turns `oc:permissions` into `Access`: read needs `G`;
 * write needs all of `C K N V D`; cached per `(uid, fileId)` for 60 s on the
 * injected clock.
 * Multistatus parsing is `@ohhi/vault`'s (`parseMultistatus`), shared with the
 * custodian's WebDAV adapter.
 */
import { DAV_PROPS, DAV_XMLNS, parseMultistatus as parseDav, pathSegments, PROPFIND_BODY, type Clock } from '@ohhi/vault'
import { ncFetch, type NcFetch } from './appapi.js'
import type { Access, Env } from './types.js'

/** One entry of a user's view of Files (not `@ohhi/vault`'s vault-relative `NcEntry`). */
export interface NcEntry {
  /** Home-relative path, no leading/trailing slash; '' is the user's home. */
  path: string
  fileId: number | null
  permissions: string | null
  ownerId: string | null
  /** `nc:mount-type`: '' for the user's own storage; 'shared', 'group', 'external'… otherwise. */
  mountType: string | null
  isDir: boolean
  etag: string | null
}

export class NcHttpError extends Error {
  override readonly name = 'NcHttpError'
  constructor(
    readonly status: number,
    readonly method: string
  ) {
    super(`Nextcloud ${method}: HTTP ${status}`)
  }
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Percent-encode each segment of a home-relative path (outer slashes ignored); throws `WebDavPathError` on `..`, `.` or `a//b`. */
export function encodePath(path: string): string {
  const trimmed = path.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? '' : pathSegments(trimmed).map(encodeURIComponent).join('/')
}

/** A multistatus as entries relative to `homeUrl` (the user's `…/remote.php/dav/files/<uid>/`). */
export function parseHome(xml: string, homeUrl: string): NcEntry[] {
  return parseDav(xml, homeUrl).map((e) => ({
    path: e.path,
    fileId: /^\d+$/.test(e.fileid) ? Number(e.fileid) : null,
    permissions: e.permissions === '' ? null : e.permissions,
    ownerId: e.ownerId === '' ? null : e.ownerId,
    mountType: e.mountType,
    isDir: e.isDir,
    etag: e.etag === '' ? null : e.etag,
  }))
}

export interface NcDavOptions {
  env: Pick<Env, 'nextcloudUrl' | 'appSecret' | 'appId' | 'appVersion' | 'aaVersion'>
  clock: Clock
  fetch?: typeof fetch
}

export class NcDav {
  private readonly base: URL
  private readonly fetchNc: NcFetch

  constructor(opts: NcDavOptions) {
    if (!opts.env.nextcloudUrl) throw new Error('NEXTCLOUD_URL is not set')
    this.base = new URL(`${opts.env.nextcloudUrl.replace(/\/+$/, '')}/`)
    this.fetchNc = ncFetch(opts.env, opts.clock, opts.fetch ? { fetch: opts.fetch } : {})
  }

  /** The WebDAV URL of a home-relative path, for the custodian's adapter (trailing slash). */
  davUrl(uid: string, path: string): string {
    const rel = encodePath(path)
    return new URL(`remote.php/dav/files/${encodeURIComponent(uid)}/${rel === '' ? '' : `${rel}/`}`, this.base).toString()
  }

  /** One request to Nextcloud as `uid` (`ncFetch`: same origin only, never a redirect followed). */
  call(uid: string, method: string, relUrl: string, init: { headers?: Record<string, string>; body?: string } = {}): Promise<Response> {
    return this.fetchNc({
      uid,
      method,
      url: new URL(relUrl, this.base),
      headers: { 'OCS-APIRequest': 'true', ...(init.headers ?? {}) },
      ...(init.body !== undefined ? { body: init.body } : {}),
    })
  }

  /**
   * Where `fileId` is in `uid`'s view of Files, with the caller's permissions
   * on it; null when the caller cannot see it. `SEARCH` first; the `/f/<id>`
   * redirect when SEARCH is refused (folders only — a file's `dir` is its parent).
   */
  async findById(uid: string, fileId: number): Promise<NcEntry | null> {
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><d:searchrequest ${DAV_XMLNS}><d:basicsearch>` +
      `<d:select><d:prop>${DAV_PROPS}</d:prop></d:select>` +
      `<d:from><d:scope><d:href>/files/${xmlEscape(uid)}</d:href><d:depth>infinity</d:depth></d:scope></d:from>` +
      `<d:where><d:eq><d:prop><oc:fileid/></d:prop><d:literal>${fileId}</d:literal></d:eq></d:where>` +
      `<d:orderby/></d:basicsearch></d:searchrequest>`
    const res = await this.call(uid, 'SEARCH', 'remote.php/dav/', {
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body,
    })
    if (res.status === 207) {
      const hit = parseHome(await res.text(), this.davUrl(uid, '')).find((e) => e.fileId === fileId)
      return hit ?? null
    }
    // 401 is AppAPI refusing the APP (disabled, mid-update), never "this user
    // cannot see it": reading it as no access would revoke every live grant
    // (nextcloud-build R1 #7). It throws; every caller treats a throw as "try later".
    if (res.status === 401) throw new NcHttpError(401, 'SEARCH')
    if (res.status === 404) return null
    // SEARCH refused or unsupported: the Files redirect names the folder.
    const f = await this.call(uid, 'GET', `index.php/f/${fileId}`)
    if (f.status < 300 || f.status >= 400) {
      if (f.status === 404 || f.status === 403) return null
      throw new NcHttpError(f.status, 'GET')
    }
    const loc = f.headers.get('location')
    if (!loc) return null
    const dir = new URL(loc, this.base).searchParams.get('dir')
    if (dir === null) return null
    const entries = await this.propfind(uid, dir, '0')
    const hit = entries[0]
    return hit && hit.fileId === fileId ? hit : null
  }

  /** PROPFIND a home-relative path. 404 → []. */
  async propfind(uid: string, path: string, depth: '0' | '1' | 'infinity'): Promise<NcEntry[]> {
    const res = await this.call(uid, 'PROPFIND', this.davUrl(uid, path), {
      headers: { Depth: depth, 'Content-Type': 'text/xml; charset=utf-8' },
      body: PROPFIND_BODY,
    })
    if (res.status === 404) return []
    if (res.status !== 207) throw new NcHttpError(res.status, 'PROPFIND')
    return parseHome(await res.text(), this.davUrl(uid, ''))
  }

  /**
   * Every entry under `path` (itself included): one Depth-infinity PROPFIND
   * when the server allows it, else a Depth-1 walk. Throws past `maxEntries`.
   */
  async walk(uid: string, path: string, maxEntries = 50_000): Promise<NcEntry[]> {
    try {
      const all = await this.propfind(uid, path, 'infinity')
      if (all.length > maxEntries) throw new Error('folder too large to enrol')
      return all
    } catch (err) {
      if (!(err instanceof NcHttpError) || (err.status !== 403 && err.status !== 400 && err.status !== 501)) throw err
    }
    const out: NcEntry[] = []
    const queue = [path]
    const seen = new Set<string>()
    while (queue.length > 0) {
      const dir = queue.shift()!
      const entries = await this.propfind(uid, dir, '1')
      for (const e of entries) {
        if (seen.has(e.path)) continue
        seen.add(e.path)
        out.push(e)
        if (e.isDir && e.path !== dir.replace(/^\/+|\/+$/g, '')) queue.push(e.path)
        if (out.length > maxEntries) throw new Error('folder too large to enrol')
      }
    }
    return out
  }

  /** DELETE one file as `uid` (never a folder); true when it was there. */
  async deleteFile(uid: string, path: string): Promise<boolean> {
    const url = this.davUrl(uid, path).replace(/\/$/, '')
    const res = await this.call(uid, 'DELETE', url)
    await res.arrayBuffer().catch(() => undefined)
    if (res.status === 404) return false
    if (res.status < 200 || res.status >= 300) throw new NcHttpError(res.status, 'DELETE')
    return true
  }

  /** GET one file's bytes as `uid`; null on 404. */
  async readFile(uid: string, path: string): Promise<Uint8Array | null> {
    const url = this.davUrl(uid, path).replace(/\/$/, '')
    const res = await this.call(uid, 'GET', url)
    if (res.status === 404) return null
    if (res.status !== 200) throw new NcHttpError(res.status, 'GET')
    return new Uint8Array(await res.arrayBuffer())
  }
}

/** `oc:permissions` letters → read/write (decision 5). */
export function accessFromPermissions(perms: string | null, path: string | null): Access {
  const p = perms ?? ''
  const read = p.includes('G')
  const write = read && ['C', 'K', 'N', 'V', 'D'].every((l) => p.includes(l))
  return { read, write, path: read ? path : null }
}

export const NO_ACCESS: Access = { read: false, write: false, path: null }

export interface Permissions {
  /** Cached for `ttlMs` per `(uid, fileId)`; `fresh` bypasses (and refreshes) the cache. */
  accessFor(uid: string, fileId: number, opts?: { fresh?: boolean }): Promise<Access>
  invalidate(uid?: string): void
}

export function createPermissions(opts: { dav: Pick<NcDav, 'findById' | 'propfind'>; clock: Clock; ttlMs?: number }): Permissions {
  const ttl = opts.ttlMs ?? 60_000
  const cache = new Map<string, { at: number; access: Access }>()
  const inflight = new Map<string, Promise<Access>>()

  const lookup = async (uid: string, fileId: number): Promise<Access> => {
    const hit = await opts.dav.findById(uid, fileId)
    if (!hit) return NO_ACCESS
    let perms = hit.permissions
    if (perms === null) perms = (await opts.dav.propfind(uid, hit.path, '0'))[0]?.permissions ?? null
    return accessFromPermissions(perms, hit.path)
  }

  return {
    async accessFor(uid, fileId, o) {
      const key = `${uid}\0${fileId}`
      const now = opts.clock.now()
      const c = cache.get(key)
      if (!o?.fresh && c && now - c.at < ttl) return c.access
      const running = inflight.get(key)
      if (running) return running
      const p = lookup(uid, fileId)
        .then((access) => {
          cache.set(key, { at: opts.clock.now(), access })
          return access
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, p)
      return p
    },
    invalidate(uid) {
      if (uid === undefined) cache.clear()
      else for (const k of [...cache.keys()]) if (k.startsWith(`${uid}\0`)) cache.delete(k)
    },
  }
}
