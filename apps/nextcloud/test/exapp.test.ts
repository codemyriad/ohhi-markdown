import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SimClock } from '@ohhi/testkit'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeAppApiAuth, type OcsClient } from '../src/appapi.js'
import { FILES_ACTION_ROUTE, FILES_MENU_ENTRY, FILES_MENU_PATH, SCRIPT_PATH, STATUS_PATH, TOP_MENU_PATH } from '../src/exapp.js'
import { registerCore } from '../src/handlers-core.js'
import { addFallbacks, createRouter, ROUTES } from '../src/http.js'
import { readEnv } from '../src/types.js'
import { closeServers, serveRouter } from './fixtures.js'

const SECRET = 'lifecycle-secret'
const env = readEnv({ APP_ID: 'ohhi', APP_SECRET: SECRET, APP_VERSION: '0.1.0', NEXTCLOUD_URL: 'http://nextcloud.test' })
const APP = { 'authorization-app-api': encodeAppApiAuth('', SECRET) }
const ALICE = { 'authorization-app-api': encodeAppApiAuth('alice', SECRET) }

interface Call {
  method: string
  path: string
  body: unknown
  uid: string
}

function fakeOcs(reply: (c: Call) => { status: number; data: unknown } = () => ({ status: 200, data: [] })) {
  const calls: Call[] = []
  const record = (method: string) => async (path: string, body?: unknown, o?: { uid?: string }) => {
    const c = { method, path, body, uid: o?.uid ?? '' }
    calls.push(c)
    return reply(c)
  }
  const ocs: OcsClient = {
    get: ((path: string, o?: { uid?: string }) => record('GET')(path, undefined, o)) as OcsClient['get'],
    post: record('POST') as OcsClient['post'],
    put: record('PUT') as OcsClient['put'],
  }
  return { ocs, calls }
}

afterEach(closeServers)

async function boot(ocs: OcsClient) {
  const router = createRouter()
  const lines: string[] = []
  const core = registerCore(router, { env, clock: new SimClock(), ocs, webDist: '/nonexistent', embedDist: '/nonexistent', log: (l) => lines.push(l), instance: 'inst-1' })
  addFallbacks(router)
  return { base: await serveRouter(router), core, lines }
}

describe('lifecycle', () => {
  it('GET /heartbeat answers with or without a header', async () => {
    const { base } = await boot(fakeOcs().ocs)
    for (const headers of [{}, APP]) {
      const res = await fetch(`${base}/heartbeat`, { headers })
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ status: 'ok' })
    }
  })

  it('POST /init answers 200, then reports progress 100 as the app', async () => {
    const { ocs, calls } = fakeOcs()
    const { base, core, lines } = await boot(ocs)
    const res = await fetch(`${base}/init`, { method: 'POST', headers: APP })
    expect(res.status).toBe(200)
    await core.lifecycle.settled()
    expect(calls).toEqual([{ method: 'PUT', path: STATUS_PATH, body: { progress: 100, error: '' }, uid: '' }])
    expect(lines).toContain('init: reported progress=100')
  })

  it('lifecycle calls refuse a user, a forged secret and no header', async () => {
    const { ocs, calls } = fakeOcs()
    const { base } = await boot(ocs)
    for (const headers of [ALICE, { 'authorization-app-api': encodeAppApiAuth('', 'guess') }, {}]) {
      expect((await fetch(`${base}/init`, { method: 'POST', headers })).status).toBe(401)
      expect((await fetch(`${base}/enabled?enabled=1`, { method: 'PUT', headers })).status).toBe(401)
    }
    expect(calls).toEqual([])
  })

  it('PUT /enabled?enabled=1 registers the top menu, its script and the Files menu entry', async () => {
    const { ocs, calls } = fakeOcs()
    const { base, core, lines } = await boot(ocs)
    const res = await fetch(`${base}/enabled?enabled=1`, { method: 'PUT', headers: APP })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: '' })
    await core.lifecycle.settled()
    expect(calls).toEqual([
      { method: 'POST', path: TOP_MENU_PATH, body: { name: 'app', displayName: 'Oh Hi', icon: 'img/app.svg', adminRequired: 0 }, uid: '' },
      { method: 'POST', path: SCRIPT_PATH, body: { type: 'top_menu', name: 'app', path: 'ui/embed' }, uid: '' },
      { method: 'POST', path: FILES_MENU_PATH, body: FILES_MENU_ENTRY, uid: '' },
    ])
    expect(FILES_MENU_PATH).toBe('/ocs/v2.php/apps/app_api/api/v2/ui/files-actions-menu')
    expect(FILES_MENU_ENTRY).toMatchObject({ name: 'open-in-ohhi', displayName: 'Open in Oh Hi', mime: 'httpd/unix-directory' })
    // The entry's handler is a declared route (AppAPI's PHP proxy strips the leading slash).
    expect(FILES_ACTION_ROUTE.pattern.test(FILES_MENU_ENTRY.actionHandler)).toBe(true)
    expect(lines.filter((l) => l.startsWith('ERROR: ui') || l.startsWith('ERROR: init'))).toEqual([])
  })

  it('a failing registration is logged and does not stop the next one', async () => {
    const { ocs, calls } = fakeOcs((c) => (c.path === TOP_MENU_PATH ? { status: 400, data: null } : { status: 200, data: [] }))
    const { base, core, lines } = await boot(ocs)
    await fetch(`${base}/enabled?enabled=1`, { method: 'PUT', headers: APP })
    await core.lifecycle.settled()
    expect(calls).toHaveLength(3)
    expect(lines).toContain('ERROR: ui top-menu: HTTP 400')
  })

  it('PUT /enabled?enabled=0 deregisters nothing', async () => {
    const { ocs, calls } = fakeOcs()
    const { base, core } = await boot(ocs)
    expect((await fetch(`${base}/enabled?enabled=0`, { method: 'PUT', headers: APP })).status).toBe(200)
    await core.lifecycle.settled()
    expect(calls).toEqual([])
  })
})

describe('core routes', () => {
  it('api/me answers the uid and the OCS display name, as the caller', async () => {
    const { ocs, calls } = fakeOcs(() => ({ status: 200, data: { id: 'alice', displayname: 'Alice A.' } }))
    const { base } = await boot(ocs)
    const res = await fetch(`${base}/api/me`, { headers: ALICE })
    expect(await res.json()).toEqual({ uid: 'alice', displayName: 'Alice A.' })
    expect(calls).toEqual([{ method: 'GET', path: '/ocs/v2.php/cloud/user', body: undefined, uid: 'alice' }])
    expect((await fetch(`${base}/api/me`, { headers: APP })).status).toBe(401)
    expect((await fetch(`${base}/api/me`)).status).toBe(401)
  })

  it('api/me falls back to the uid', async () => {
    const { base } = await boot(fakeOcs(() => ({ status: 500, data: null })).ocs)
    expect(await (await fetch(`${base}/api/me`, { headers: ALICE })).json()).toEqual({ uid: 'alice', displayName: 'alice' })
  })

  it('healthz and admin/status', async () => {
    const { base } = await boot(fakeOcs().ocs)
    expect(await (await fetch(`${base}/healthz`, { headers: ALICE })).json()).toEqual({ ok: true })
    expect((await fetch(`${base}/healthz`)).status).toBe(401)
    expect(await (await fetch(`${base}/admin/status`, { headers: ALICE })).json()).toMatchObject({ instance: 'inst-1', uptime: 0 })
  })

  it('routes nobody registered still answer 501 behind the fallback', async () => {
    const { base } = await boot(fakeOcs().ocs)
    expect((await fetch(`${base}/api/vaults`, { headers: ALICE })).status).toBe(501)
  })

  it('the Files action redirects to the top-menu page', async () => {
    const { base } = await boot(fakeOcs().ocs)
    const post = (headers: Record<string, string>, body: unknown) =>
      fetch(`${base}/api/files-action`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const res = await post(ALICE, { files: [{ fileId: 42, name: 'Notes', mime: 'httpd/unix-directory' }] })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ redirect_handler: 'app' })
    expect((await post(ALICE, { files: [] })).status).toBe(400)
    expect((await post({}, { files: [{ fileId: 42 }] })).status).toBe(401)
  })
})

/** info.xml's `<url>` for a route pattern: named groups dropped, every `/` escaped (AppAPI's `/…/i` delimiters). */
function xmlUrl(pattern: RegExp): string {
  const src = pattern.source.replace(/\(\?<[A-Za-z]+>/g, '(')
  let out = ''
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!
    if (ch === '\\') {
      out += ch + (src[i + 1] ?? '')
      i++
    } else out += ch === '/' ? '\\/' : ch
  }
  // A group left wrapping the whole capture (`(.*)`, `([0-9a-f-]{36})`) is the info.xml form without it.
  return out.replace(/\((\.\*|\[0-9a-f-\]\{36\}|\[\^\\\/\]\+)\)/g, '$1')
}

describe('appinfo/info.xml', () => {
  const xml = readFileSync(fileURLToPath(new URL('../appinfo/info.xml', import.meta.url)), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  const routes = [...xml.matchAll(/<route>([\s\S]*?)<\/route>/g)].map((m) => {
    const field = (name: string) => m[1]!.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim()
    return {
      url: field('url')!,
      verbs: field('verb')!.split(',').map((v) => v.trim()).sort(),
      access: field('access_level')!,
      headersToExclude: field('headers_to_exclude'),
      bruteforce: field('bruteforce_protection'),
    }
  })

  it('declares exactly ROUTES (the Files action included), verbs and access levels included', () => {
    const want = new Map<string, { verbs: string[]; access: string }>()
    for (const r of ROUTES) {
      const url = xmlUrl(r.pattern)
      const entry = want.get(url) ?? { verbs: [], access: r.access }
      expect(entry.access).toBe(r.access)
      entry.verbs.push(r.method)
      want.set(url, entry)
    }
    const got = new Map(routes.map((r) => [r.url, { verbs: r.verbs, access: r.access }]))
    expect(got.size).toBe(routes.length)
    expect(Object.fromEntries(got)).toEqual(Object.fromEntries([...want].map(([k, v]) => [k, { ...v, verbs: v.verbs.sort() }])))
  })

  it('every pattern is ^\\/?…$ with every slash escaped, and carries the brief’s options', () => {
    for (const r of routes) {
      expect(r.url).toMatch(/^\^\\\/\?.*\$$/)
      expect(r.url.replace(/\\./g, '')).not.toContain('/')
      expect(r.headersToExclude).toBe('[]')
      expect(r.bruteforce).toBe('[401, 500]')
    }
  })

  it('declares every OHHI_* variable readEnv reads, with a default', () => {
    const declared = [...xml.matchAll(/<variable>[\s\S]*?<name>([^<]+)<\/name>[\s\S]*?<default>[^<]*<\/default>[\s\S]*?<\/variable>/g)].map((m) => m[1])
    const read = [...readFileSync(fileURLToPath(new URL('../src/types.ts', import.meta.url)), 'utf8').matchAll(/env\.(OHHI_[A-Z_]+)/g)].map((m) => m[1])
    expect(new Set(read)).toEqual(new Set(['OHHI_PUBLIC_ORIGINS', 'OHHI_LOG_LEVEL']))
    expect(declared.sort()).toEqual([...new Set(read)].sort())
  })

  it('names the app and its image', () => {
    expect(xml).toContain('<id>ohhi</id>')
    expect(xml).toContain('<name>Oh Hi</name>')
    expect(xml).toMatch(/<nextcloud min-version="32" max-version="36"\/>/)
    expect(xml).toContain('<image>codemyriad/ohhi-nextcloud</image>')
    const version = xml.match(/<version>([^<]+)<\/version>/)![1]
    expect(xml).toContain(`<image-tag>${version}</image-tag>`)
    expect(xml).toContain('<category>office</category>')
    expect(xml).toContain('<category>tools</category>')
  })
})
