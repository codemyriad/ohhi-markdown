/**
 * AppAPI authentication, both directions (nextcloud-build decisions
 * 14 and 15).
 *
 * Inbound: AppAPI (PHP proxy) and HaRP (HAProxy) set
 * `AUTHORIZATION-APP-API: base64(<uid>:<APP_SECRET>)` on every request they
 * forward, the WebSocket upgrade included. The uid is the signed-in
 * Nextcloud user; it is EMPTY on AppAPI's own lifecycle calls (`/init`,
 * `/enabled`). The secret is compared in constant time.
 *
 * Outbound: `ncFetch` is every call into Nextcloud, as the app (empty uid)
 * or as a user: `NEXTCLOUD_URL`'s origin only, `redirect: 'manual'`, a clock
 * timeout. `ocsClient` (OCS JSON) and permissions.ts's `NcDav` (WebDAV) sit
 * on it.
 *
 * The header value is a credential: nothing here logs it, and nothing here
 * puts it in an error message.
 */
import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Clock } from '@ohhi/vault'
import { json, type Handler } from './http.js'
import type { Env } from './types.js'

export const APPAPI_AUTH_HEADER = 'authorization-app-api'
/** The header every mutating browser request carries (decision 14). */
export const OHHI_REQUEST_HEADER = 'x-ohhi-request'

/**
 * An error a handler throws to answer with `status`: `{error}`, or — a 409
 * refusal carrying a machine `reason` — `{error: 'refused', reason}`, the
 * shape the shell words through i18n (`ncErrorText`). Never a path.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly reason?: string
  ) {
    super(message)
    this.name = 'HttpError'
  }

  body(): { error: string; reason?: string } {
    return this.status === 409 && this.reason !== undefined ? { error: 'refused', reason: this.reason } : { error: this.message }
  }
}

export function encodeAppApiAuth(uid: string, secret: string): string {
  return Buffer.from(`${uid}:${secret}`, 'utf8').toString('base64')
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

/** Fixed-length digest, so `timingSafeEqual` compares equal-length buffers and the length of the secret is not leaked. */
function digest(bytes: Buffer): Buffer {
  return createHash('sha256').update(bytes).digest()
}

/**
 * `{uid}` when `headerValue` is `base64(<uid>:<secret>)` for this secret,
 * else null. The uid may be empty (AppAPI's own calls). A uid holding a
 * control character or a `:` (the split is on the first one) is refused.
 */
export function verifyAppApiAuth(headerValue: string | string[] | undefined, secret: string): { uid: string } | null {
  if (typeof headerValue !== 'string' || secret === '') return null
  const raw = headerValue.trim()
  if (raw.length === 0 || raw.length % 4 !== 0 || !BASE64.test(raw)) return null
  const decoded = Buffer.from(raw, 'base64')
  const sep = decoded.indexOf(0x3a) // ':'
  if (sep < 0) return null
  const got = decoded.subarray(sep + 1)
  const want = Buffer.from(secret, 'utf8')
  // Both comparisons always run: the digest compare is constant-time, the
  // length compare is folded in after it.
  const same = timingSafeEqual(digest(got), digest(want)) && got.length === want.length
  if (!same) return null
  const uid = decoded.subarray(0, sep).toString('utf8')
  if (/[\u0000-\u001f\u007f]/.test(uid)) return null
  return { uid }
}

/** The caller per the AppAPI header, or null when it is missing or does not verify. `uid` is '' for AppAPI's own calls. */
export function userFromRequest(req: IncomingMessage, env: Pick<Env, 'appSecret'>): { uid: string } | null {
  return verifyAppApiAuth(req.headers[APPAPI_AUTH_HEADER], env.appSecret)
}

/** The signed-in user's uid; throws 401 when the header is missing, wrong, or carries the empty (app) uid. */
export function requireUser(req: IncomingMessage, env: Pick<Env, 'appSecret'>): string {
  const who = userFromRequest(req, env)
  if (!who || who.uid === '') throw new HttpError(401, 'unauthorized')
  return who.uid
}

/** AppAPI's own (lifecycle) call: a verified header with the EMPTY uid; anything else is 401. */
export function requireEmptyUser(req: IncomingMessage, env: Pick<Env, 'appSecret'>): void {
  const who = userFromRequest(req, env)
  if (!who || who.uid !== '') throw new HttpError(401, 'unauthorized')
}

/** `new URL(u).origin`, or null for something that is not a URL (or has an opaque origin). */
export function originOf(url: string): string | null {
  try {
    const o = new URL(url).origin
    return o === 'null' ? null : o
  } catch {
    return null
  }
}

/** A header's first value — the first element, then the first comma-separated item — or null when absent or empty. */
export function first(v: string | string[] | undefined): string | null {
  if (v === undefined) return null
  const s = Array.isArray(v) ? v[0] : v
  return s ? (s.split(',')[0] ?? '').trim() || null : null
}

/**
 * A `host[:port]` as compared by the origin rule: lowercased, the default
 * ports dropped (scheme is ignored — TLS terminates upstream, so an
 * `https://` page reaches us as plain HTTP with the same Host). Null for
 * nothing usable.
 */
export function normalHost(host: string | null | undefined): string | null {
  const h = (host ?? '').trim().toLowerCase()
  if (h === '' || /[\s/@]/.test(h)) return null
  return h.replace(/:(80|443)$/, '')
}

/** The host of an origin URL (`https://a.example:8443` → `a.example:8443`), normalised; null when it is not one. */
export function originHost(origin: string | null): string | null {
  if (origin === null) return null
  try {
    const u = new URL(origin)
    return u.origin === 'null' ? null : normalHost(u.host)
  } catch {
    return null
  }
}

/** Who may call us from a browser: `NEXTCLOUD_URL`'s origin and `OHHI_PUBLIC_ORIGINS`. */
export interface OriginPolicy {
  /** `NEXTCLOUD_URL`'s origin (null when unset). */
  ncOrigin: string | null
  /** `OHHI_PUBLIC_ORIGINS`, each normalised to an origin. */
  publicOrigins: readonly string[]
}

export function originPolicy(env: Pick<Env, 'nextcloudUrl' | 'publicOrigins'>): OriginPolicy {
  return { ncOrigin: originOf(env.nextcloudUrl), publicOrigins: env.publicOrigins }
}

/** What the origin rule reads off a request: its `Origin`, `Sec-Fetch-Site` and `Host`. */
export interface OriginHeaders {
  origin: string | null
  secFetchSite: string | null
  host: string | null
}

/** The three headers, from a `node:http` request or a `Headers`-like `get`. */
export function originHeaders(get: (name: string) => string | null): OriginHeaders {
  return { origin: get('origin'), secFetchSite: get('sec-fetch-site'), host: get('host') }
}

/**
 * The one origin rule (decision 14; amended 2026-10-11 so a browser's
 * WebSocket is admitted, see below), for a POST and for the relay's upgrade:
 *
 * - `Sec-Fetch-Site`, when the browser sent one, decides: only
 *   `same-origin` passes (a `cross-site` request is refused whatever its
 *   Origin says).
 * - Otherwise an `Origin` is required, and passes when its host (hostname and
 *   port; scheme ignored) equals the request's own `Host` — the page and this
 *   request came through the same front door — or equals `NEXTCLOUD_URL`'s
 *   host, or the origin is listed in `OHHI_PUBLIC_ORIGINS`.
 *
 * Chromium sends `Origin` but no `Sec-Fetch-Site` on a WebSocket handshake,
 * and `NEXTCLOUD_URL` is often an internal name the browser never sees (the
 * local stack's `http://reverse-proxy`): the Host comparison is what admits a
 * browser socket there. A request with neither header is refused here; the
 * custodian's own loopback socket never reaches this rule (relay-auth.ts
 * admits its device token only WITHOUT an Origin).
 */
export function originAllowed(h: OriginHeaders, policy: OriginPolicy): boolean {
  if (h.secFetchSite !== null) return h.secFetchSite === 'same-origin'
  const from = originHost(h.origin)
  if (from === null) return false
  const self = normalHost(h.host)
  if (self !== null && from === self) return true
  if (from === originHost(policy.ncOrigin)) return true
  const exact = originOf(h.origin ?? '')
  return exact !== null && policy.publicOrigins.includes(exact)
}

/**
 * The mutating-request guard (decision 14): `X-Ohhi-Request: 1` (a custom
 * header no cross-site form or simple request can carry), and `originAllowed`.
 * Throws 403.
 */
export function requireSameOrigin(req: IncomingMessage, env: Pick<Env, 'nextcloudUrl' | 'publicOrigins'>): void {
  if (first(req.headers[OHHI_REQUEST_HEADER]) !== '1') throw new HttpError(403, 'missing X-Ohhi-Request')
  const ok = originAllowed(
    originHeaders((name) => first(req.headers[name])),
    originPolicy(env)
  )
  if (!ok) throw new HttpError(403, 'cross-origin request')
}

export interface HttpErrorOptions {
  /** Answer any other error with this status and message (logged by class name) instead of the router's 500. */
  unknown?: readonly [status: number, message: string]
  log?: (line: string) => void
}

/** Wrap a handler so a thrown `HttpError` answers its `body()` with its status. */
export function withHttpErrors(handler: Handler, opts: HttpErrorOptions = {}): Handler {
  return async (req, res, params) => {
    try {
      await handler(req, res, params)
    } catch (err) {
      if (!(err instanceof HttpError) && !opts.unknown) throw err
      if (res.headersSent) {
        res.end()
        return
      }
      if (err instanceof HttpError) {
        json(res, err.status, err.body())
        return
      }
      const [status, message] = opts.unknown!
      opts.log?.(`route failed (${err instanceof Error ? err.name : 'error'})`)
      json(res, status, { error: message })
    }
  }
}

/** Read a JSON request body (bounded); throws 400 on malformed JSON, 413 past `limit`. */
export async function readJson(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    size += buf.length
    if (size > limit) throw new HttpError(413, 'request body too large')
    chunks.push(buf)
  }
  if (size === 0) return undefined
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'malformed JSON')
  }
}

export interface OcsResponse<T = unknown> {
  status: number
  /** `ocs.data` when the reply is an OCS envelope, else the parsed JSON body; null for a non-JSON body. */
  data: T | null
}

export interface OcsRequestOptions {
  /** The Nextcloud user to act as; '' or absent = the app itself. */
  uid?: string
}

export interface OcsClient {
  get<T = unknown>(path: string, opts?: OcsRequestOptions): Promise<OcsResponse<T>>
  post<T = unknown>(path: string, body: unknown, opts?: OcsRequestOptions): Promise<OcsResponse<T>>
  put<T = unknown>(path: string, body: unknown, opts?: OcsRequestOptions): Promise<OcsResponse<T>>
}

export interface OcsClientOptions {
  fetch?: typeof fetch
  /** Abort a call after this long (default 15 s). */
  timeoutMs?: number
}

/** The AppAPI request headers for calls into Nextcloud as `uid` ('' = the app). */
export function appApiHeaders(env: Pick<Env, 'appId' | 'appSecret' | 'appVersion' | 'aaVersion'>, uid = ''): Record<string, string> {
  return {
    'AUTHORIZATION-APP-API': encodeAppApiAuth(uid, env.appSecret),
    'EX-APP-ID': env.appId,
    'EX-APP-VERSION': env.appVersion,
    'AA-VERSION': env.aaVersion,
  }
}

export interface NcFetchRequest {
  /** The Nextcloud user to act as; '' = the app itself. */
  uid: string
  method: string
  /** Resolved against `NEXTCLOUD_URL` (a path, or an absolute URL on its origin). */
  url: string | URL
  headers?: Record<string, string>
  body?: string
  /** Abort after this long on the injected clock (default 15 s). */
  timeoutMs?: number
}

export type NcFetch = (req: NcFetchRequest) => Promise<Response>

/**
 * Every outbound call into Nextcloud (decision 15) goes through here: the
 * AppAPI headers for `uid` are attached, a URL off `NEXTCLOUD_URL`'s origin
 * is refused (the header is a credential), a redirect is never followed
 * (`redirect: 'manual'`, so a 30x cannot carry the header to another host),
 * and a call that hangs is aborted on the clock.
 */
export function ncFetch(
  env: Pick<Env, 'nextcloudUrl' | 'appSecret' | 'appId' | 'appVersion' | 'aaVersion'>,
  clock: Clock,
  opts: { fetch?: typeof fetch } = {}
): NcFetch {
  const doFetch = opts.fetch ?? fetch
  return async (r) => {
    if (env.nextcloudUrl === '') throw new Error('NEXTCLOUD_URL is not set')
    const base = new URL(`${env.nextcloudUrl}/`)
    const url = new URL(typeof r.url === 'string' ? r.url.replace(/^\/+/, '') : r.url, base)
    if (url.origin !== base.origin) throw new Error('refusing a request outside NEXTCLOUD_URL')
    const abort = new AbortController()
    const cancel = clock.schedule(() => abort.abort(), r.timeoutMs ?? 15_000)
    try {
      return await doFetch(url, {
        method: r.method,
        redirect: 'manual',
        headers: { ...appApiHeaders(env, r.uid), ...(r.headers ?? {}) },
        ...(r.body !== undefined ? { body: r.body } : {}),
        signal: abort.signal,
      })
    } finally {
      cancel()
    }
  }
}

/** OCS calls into Nextcloud through `ncFetch`, JSON both ways; `ocs.data` is unwrapped. */
export function ocsClient(env: Env, clock: Clock, opts: OcsClientOptions = {}): OcsClient {
  const call0 = ncFetch(env, clock, opts.fetch ? { fetch: opts.fetch } : {})

  async function call<T>(method: string, path: string, body: unknown, o: OcsRequestOptions = {}): Promise<OcsResponse<T>> {
    const headers: Record<string, string> = { 'OCS-APIRequest': 'true', Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await call0({
      uid: o.uid ?? '',
      method,
      url: path,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    })
    const text = await res.text()
    let data: unknown = null
    try {
      const parsed: unknown = text === '' ? null : JSON.parse(text)
      const ocs = (parsed as { ocs?: { data?: unknown } } | null)?.ocs
      data = ocs && typeof ocs === 'object' && 'data' in ocs ? ocs.data : parsed
    } catch {
      data = null
    }
    return { status: res.status, data: data as T | null }
  }

  return {
    get: (path, o) => call('GET', path, undefined, o),
    post: (path, body, o) => call('POST', path, body, o),
    put: (path, body, o) => call('PUT', path, body, o),
  }
}

/** For logs: the request's AppAPI trace id (safe to log), never the auth header. */
export function requestId(req: IncomingMessage): string {
  return first(req.headers['aa-request-id']) ?? '-'
}

