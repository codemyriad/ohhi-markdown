import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { SimClock } from '@ohhi/testkit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeAppApiAuth,
  HttpError,
  ocsClient,
  requireEmptyUser,
  normalHost,
  originAllowed,
  originHost,
  requireSameOrigin,
  requireUser,
  userFromRequest,
  verifyAppApiAuth,
  withHttpErrors,
} from '../src/appapi.js'
import { createRouter, handleRequest } from '../src/http.js'
import { parseOrigins, readEnv } from '../src/types.js'

const SECRET = 's3cret-of-some-length'
const env = readEnv({ APP_ID: 'ohhi', APP_SECRET: SECRET, APP_VERSION: '0.1.0', AA_VERSION: '5.0.0', NEXTCLOUD_URL: 'https://cloud.example.org/' })

function req(headers: Record<string, string>): IncomingMessage {
  return { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) } as unknown as IncomingMessage
}

describe('verifyAppApiAuth', () => {
  it('round-trips a user and the empty (app) uid', () => {
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', SECRET), SECRET)).toEqual({ uid: 'alice' })
    expect(verifyAppApiAuth(encodeAppApiAuth('', SECRET), SECRET)).toEqual({ uid: '' })
  })

  it('accepts a secret holding a colon (the split is on the first)', () => {
    expect(verifyAppApiAuth(encodeAppApiAuth('bob', 'a:b:c'), 'a:b:c')).toEqual({ uid: 'bob' })
  })

  it('refuses a wrong, shorter, longer or missing secret', () => {
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', 'nope'), SECRET)).toBeNull()
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', SECRET.slice(0, -1)), SECRET)).toBeNull()
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', SECRET + 'x'), SECRET)).toBeNull()
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', ''), SECRET)).toBeNull()
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', SECRET), '')).toBeNull()
  })

  it('refuses malformed values', () => {
    expect(verifyAppApiAuth(undefined, SECRET)).toBeNull()
    expect(verifyAppApiAuth(['a', 'b'], SECRET)).toBeNull()
    expect(verifyAppApiAuth('', SECRET)).toBeNull()
    expect(verifyAppApiAuth('not base64!', SECRET)).toBeNull()
    expect(verifyAppApiAuth(Buffer.from(`alice${SECRET}`).toString('base64'), SECRET)).toBeNull() // no colon
    expect(verifyAppApiAuth(Buffer.from(`al\nice:${SECRET}`).toString('base64'), SECRET)).toBeNull()
  })

  it('compares with timingSafeEqual', async () => {
    const crypto = await import('node:crypto')
    expect(crypto.timingSafeEqual).toBeTypeOf('function')
    // A secret that differs only in its last byte is still refused (no early-exit shortcut to rely on).
    const near = SECRET.slice(0, -1) + (SECRET.endsWith('h') ? 'g' : 'h')
    expect(verifyAppApiAuth(encodeAppApiAuth('alice', near), SECRET)).toBeNull()
  })
})

describe('request helpers', () => {
  const user = req({ 'authorization-app-api': encodeAppApiAuth('alice', SECRET) })
  const app = req({ 'authorization-app-api': encodeAppApiAuth('', SECRET) })
  const forged = req({ 'authorization-app-api': encodeAppApiAuth('alice', 'guess') })
  const none = req({})

  it('userFromRequest reads the header', () => {
    expect(userFromRequest(user, env)).toEqual({ uid: 'alice' })
    expect(userFromRequest(app, env)).toEqual({ uid: '' })
    expect(userFromRequest(forged, env)).toBeNull()
    expect(userFromRequest(none, env)).toBeNull()
  })

  it('requireUser wants a non-empty verified uid', () => {
    expect(requireUser(user, env)).toBe('alice')
    for (const r of [app, forged, none]) expect(() => requireUser(r, env)).toThrow(HttpError)
  })

  it('requireEmptyUser wants AppAPI itself', () => {
    expect(() => requireEmptyUser(app, env)).not.toThrow()
    for (const r of [user, forged, none]) expect(() => requireEmptyUser(r, env)).toThrow(/unauthorized/)
  })

  it('requireSameOrigin wants X-Ohhi-Request and a same-origin request', () => {
    const ok = (h: Record<string, string>) => () => requireSameOrigin(req(h), env)
    expect(ok({ 'x-ohhi-request': '1', origin: 'https://cloud.example.org' })).not.toThrow()
    expect(ok({ 'x-ohhi-request': '1', 'sec-fetch-site': 'same-origin', origin: 'http://localhost:28090' })).not.toThrow()
    expect(ok({ 'x-ohhi-request': '1', origin: 'http://localhost:28090', host: 'localhost:28090' })).not.toThrow()
    expect(ok({ origin: 'https://cloud.example.org' })).toThrow(/X-Ohhi-Request/)
    expect(ok({ 'x-ohhi-request': 'yes', origin: 'https://cloud.example.org' })).toThrow(HttpError)
    expect(ok({ 'x-ohhi-request': '1', origin: 'https://evil.example' })).toThrow(/cross-origin/)
    expect(ok({ 'x-ohhi-request': '1', 'sec-fetch-site': 'cross-site', origin: 'https://cloud.example.org' })).toThrow(/cross-origin/)
    expect(ok({ 'x-ohhi-request': '1', 'sec-fetch-site': 'same-site' })).toThrow(/cross-origin/)
    expect(ok({ 'x-ohhi-request': '1' })).toThrow(/cross-origin/)
    expect(ok({ 'x-ohhi-request': '1', host: 'cloud.example.org' })).toThrow(/cross-origin/)
  })

  describe('originAllowed (the one rule, POSTs and the upgrade)', () => {
    const policy = { ncOrigin: 'http://reverse-proxy', publicOrigins: ['https://notes.example.org'] }
    const h = (origin: string | null, host: string | null = 'nc_app_ohhi:23000', secFetchSite: string | null = null) => ({
      origin,
      host,
      secFetchSite,
    })

    it("admits an Origin whose host is the request's own Host, scheme ignored", () => {
      // Chromium's WebSocket handshake: Origin, no Sec-Fetch-Site; the page and the upgrade share the front door.
      expect(originAllowed(h('http://localhost:28090', 'localhost:28090'), policy)).toBe(true)
      expect(originAllowed(h('https://cloud.example.org', 'cloud.example.org'), policy)).toBe(true)
      expect(originAllowed(h('https://Cloud.Example.org', 'cloud.example.org:443'), policy)).toBe(true)
      expect(originAllowed(h('http://localhost:28090', 'localhost:28091'), policy)).toBe(false)
      expect(originAllowed(h('http://evil.example', 'cloud.example.org'), policy)).toBe(false)
    })

    it("admits NEXTCLOUD_URL's host, whatever the Host header says", () => {
      expect(originAllowed(h('http://reverse-proxy'), policy)).toBe(true)
      expect(originAllowed(h('https://reverse-proxy'), policy)).toBe(true)
      expect(originAllowed(h('http://reverse-proxy:8080'), policy)).toBe(false)
      expect(originAllowed(h('http://reverse-proxy', null), { ncOrigin: null, publicOrigins: [] })).toBe(false)
    })

    it('admits an origin listed in OHHI_PUBLIC_ORIGINS (exactly)', () => {
      expect(originAllowed(h('https://notes.example.org'), policy)).toBe(true)
      expect(originAllowed(h('http://notes.example.org'), policy)).toBe(false)
      expect(originAllowed(h('https://other.example.org'), policy)).toBe(false)
    })

    it('a missing Origin is refused; Sec-Fetch-Site, when sent, decides', () => {
      expect(originAllowed(h(null), policy)).toBe(false)
      expect(originAllowed(h(null, 'localhost:28090'), policy)).toBe(false)
      expect(originAllowed(h('null'), policy)).toBe(false)
      expect(originAllowed(h('not a url'), policy)).toBe(false)
      expect(originAllowed(h(null, null, 'same-origin'), policy)).toBe(true)
      expect(originAllowed(h('http://evil.example', null, 'same-origin'), policy)).toBe(true)
      expect(originAllowed(h('http://localhost:28090', 'localhost:28090', 'cross-site'), policy)).toBe(false)
      expect(originAllowed(h('http://reverse-proxy', null, 'same-site'), policy)).toBe(false)
    })

    it('normalHost / originHost / parseOrigins', () => {
      expect(normalHost(' Example.org:443 ')).toBe('example.org')
      expect(normalHost('example.org:80')).toBe('example.org')
      expect(normalHost('a b')).toBeNull()
      expect(normalHost('')).toBeNull()
      expect(originHost('https://x.example:8443/path')).toBe('x.example:8443')
      expect(originHost('file:///x')).toBeNull()
      expect(parseOrigins(' https://a.example/ ,nope, http://b.example:8080,https://a.example')).toEqual([
        'https://a.example',
        'http://b.example:8080',
      ])
      expect(parseOrigins(undefined)).toEqual([])
    })
  })
})

describe('withHttpErrors', () => {
  let server: Server | null = null
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())))

  it('answers a thrown HttpError with its status and {error}', async () => {
    const router = createRouter()
    router.add('GET', /^\/?x$/, withHttpErrors(async (r) => void requireUser(r, env)))
    server = createServer((q, s) => void handleRequest(router, q, s))
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const res = await fetch(`${base}/x`)
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })
})

describe('ocsClient', () => {
  function fakeFetch(reply: unknown = { ocs: { meta: { status: 'ok' }, data: { id: 'alice' } } }, status = 200) {
    return vi.fn(async (_url: URL | RequestInfo, _init?: RequestInit) => new Response(JSON.stringify(reply), { status }))
  }

  it('sends the AppAPI headers as the app or a user, with manual redirects', async () => {
    const f = fakeFetch()
    const ocs = ocsClient(env, new SimClock(), { fetch: f as unknown as typeof fetch })
    const r = await ocs.get('/ocs/v2.php/cloud/user', { uid: 'alice' })
    expect(r).toEqual({ status: 200, data: { id: 'alice' } })
    const [url, init] = f.mock.calls[0]!
    expect(String(url)).toBe('https://cloud.example.org/ocs/v2.php/cloud/user')
    const h = init!.headers as Record<string, string>
    expect(verifyAppApiAuth(h['AUTHORIZATION-APP-API'], SECRET)).toEqual({ uid: 'alice' })
    expect(h).toMatchObject({ 'EX-APP-ID': 'ohhi', 'EX-APP-VERSION': '0.1.0', 'AA-VERSION': '5.0.0', 'OCS-APIRequest': 'true', Accept: 'application/json' })
    expect(init!.redirect).toBe('manual')

    await ocs.put('ocs/v2.php/apps/app_api/ex-app/status', { progress: 100 })
    const [url2, init2] = f.mock.calls[1]!
    expect(String(url2)).toBe('https://cloud.example.org/ocs/v2.php/apps/app_api/ex-app/status')
    expect(init2!.method).toBe('PUT')
    expect(init2!.body).toBe('{"progress":100}')
    expect((init2!.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(verifyAppApiAuth((init2!.headers as Record<string, string>)['AUTHORIZATION-APP-API'], SECRET)).toEqual({ uid: '' })
  })

  it('refuses another origin, so the AppAPI header never leaves NEXTCLOUD_URL', async () => {
    const f = fakeFetch({ x: 1 })
    const ocs = ocsClient(env, new SimClock(), { fetch: f as unknown as typeof fetch })
    for (const url of ['https://evil.example/ocs', 'http://cloud.example.org/ocs', 'https://cloud.example.org:8443/ocs']) {
      await expect(ocs.post(url, { a: 1 })).rejects.toThrow(/outside NEXTCLOUD_URL/)
    }
    expect(f).not.toHaveBeenCalled()
  })

  it('reports a redirect as its status instead of following it', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }))
    const ocs = ocsClient(env, new SimClock(), { fetch: f as unknown as typeof fetch })
    expect(await ocs.get('/index.php/f/12')).toEqual({ status: 302, data: null })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('aborts on the injected clock', async () => {
    const clock = new SimClock()
    const f = vi.fn(
      (_url: URL | RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))))
    )
    const ocs = ocsClient(env, clock, { fetch: f as unknown as typeof fetch, timeoutMs: 1000 })
    const p = ocs.get('/ocs/v2.php/cloud/user')
    clock.advance(1000)
    await expect(p).rejects.toThrow(/aborted/)
  })

  it('refuses to run without NEXTCLOUD_URL', async () => {
    const ocs = ocsClient({ ...env, nextcloudUrl: '' }, new SimClock(), { fetch: fakeFetch() as unknown as typeof fetch })
    await expect(ocs.get('/x')).rejects.toThrow(/NEXTCLOUD_URL/)
  })
})
