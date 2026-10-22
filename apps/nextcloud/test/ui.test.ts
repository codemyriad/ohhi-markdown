import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { encodeAppApiAuth } from '../src/appapi.js'
import { createRouter, registerRoutes } from '../src/http.js'
import { buildCsp, createUi, inlineScriptHashes, POLICY, POLICY_OVERRIDES, safeRelative } from '../src/ui.js'
import { readEnv } from '../src/types.js'
import { closeServers, serveRouter } from './fixtures.js'

const SECRET = 'ui-secret'
const env = readEnv({ APP_SECRET: SECRET })
const ALICE = { 'authorization-app-api': encodeAppApiAuth('alice', SECRET) }
const THEME = "(function(){document.documentElement.setAttribute('data-theme','x')})()"
const INDEX = `<!doctype html><html><head><script>${THEME}</script><script type="module" src="/exapps/ohhi/ui/assets/index-abc123.js"></script></head><body></body></html>`

let root = ''
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'ohhi-ui-'))
  mkdirSync(join(root, 'web/assets'), { recursive: true })
  mkdirSync(join(root, 'embed'), { recursive: true })
  writeFileSync(join(root, 'web/index.html'), INDEX)
  writeFileSync(join(root, 'web/assets/index-abc123.js'), 'console.log(1)')
  writeFileSync(join(root, 'web/favicon.svg'), '<svg/>')
  writeFileSync(join(root, 'embed/embed.js'), '(function(){})()')
  writeFileSync(join(root, 'secret.txt'), 'outside')
})
afterAll(() => rmSync(root, { recursive: true, force: true }))
afterEach(closeServers)

async function serve(webDist: string) {
  const ui = createUi({ env, webDist, embedDist: join(root, 'embed'), log: () => {} })
  const router = createRouter()
  registerRoutes(router, { ui: ui.ui, uiHead: ui.ui, appIcon: ui.icon })
  return { base: await serveRouter(router), ui }
}

const get = (url: string, init: RequestInit = {}) => fetch(url, { ...init, headers: { ...ALICE, ...(init.headers ?? {}) } })

describe('CSP', () => {
  it('hashes inline scripts the way check-csp.mjs does', () => {
    const want = `'sha256-${createHash('sha256').update(THEME).digest('base64')}'`
    expect(inlineScriptHashes(INDEX)).toEqual([want])
  })

  it('is the hosted web policy apart from connect-src and frame-ancestors', () => {
    const headers = readFileSync(fileURLToPath(new URL('../../web/public/_headers', import.meta.url)), 'utf8')
    const line = headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)![1]!
    const web = new Map(
      line
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([name, ...sources]) => [name!, sources.filter((s) => !s.startsWith("'sha256-"))])
    )
    const ours = new Map(Object.entries(POLICY).map(([k, v]) => [k, [...v]]))
    expect([...ours.keys()].sort()).toEqual([...web.keys()].sort())
    for (const [name, sources] of web) {
      if ((POLICY_OVERRIDES as readonly string[]).includes(name)) continue
      expect(ours.get(name), name).toEqual(sources)
    }
    expect(POLICY['connect-src']).toEqual(["'self'"])
    expect(POLICY['frame-ancestors']).toEqual(["'self'"])
  })
})

describe('static shell', () => {
  it('serves index.html for /ui/ and /ui/index.html with our CSP and no-store', async () => {
    const { base, ui } = await serve(join(root, 'web'))
    for (const path of ['/ui/', 'ui/index.html'.replace(/^/, '/')]) {
      const res = await get(base + path)
      expect(res.status).toBe(200)
      expect(await res.text()).toBe(INDEX)
      expect(res.headers.get('content-type')).toMatch(/^text\/html/)
      expect(res.headers.get('cache-control')).toBe('no-store')
      expect(res.headers.get('content-security-policy')).toBe(buildCsp(inlineScriptHashes(INDEX)))
      expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'self'")
      expect(res.headers.get('content-security-policy')).toContain("connect-src 'self';")
      expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN')
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    }
    expect(ui.csp).toContain(inlineScriptHashes(INDEX)[0])
  })

  it('caches hashed assets for a year and the rest not at all', async () => {
    const { base } = await serve(join(root, 'web'))
    const asset = await get(`${base}/ui/assets/index-abc123.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(asset.headers.get('content-type')).toMatch(/^text\/javascript/)
    expect(await asset.text()).toBe('console.log(1)')
    const other = await get(`${base}/ui/favicon.svg`)
    expect(other.headers.get('cache-control')).toBe('no-cache')
    expect(other.headers.get('content-type')).toBe('image/svg+xml')
  })

  it('serves embed.js from the embed build', async () => {
    const { base } = await serve(join(root, 'web'))
    const res = await get(`${base}/ui/embed.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('(function(){})()')
    expect(res.headers.get('content-type')).toMatch(/^text\/javascript/)
  })

  it('HEAD answers headers without a body', async () => {
    const { base } = await serve(join(root, 'web'))
    const res = await get(`${base}/ui/assets/index-abc123.js`, { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('14')
    expect(await res.text()).toBe('')
  })

  it('refuses traversal and unknown files', async () => {
    const { base } = await serve(join(root, 'web'))
    for (const path of ['/ui/..%2fsecret.txt', '/ui/%2e%2e/secret.txt', '/ui/assets/../../secret.txt', '/ui/nope.js', '/ui/assets/', '/ui/%E0%A4%A']) {
      expect((await get(base + path)).status, path).toBe(404)
    }
    expect(safeRelative('a/../b')).toBeNull()
    expect(safeRelative('a%5cb')).toBeNull()
    expect(safeRelative('assets/x.js')).toBe('assets/x.js')
  })

  it('needs a verified user', async () => {
    const { base } = await serve(join(root, 'web'))
    expect((await fetch(`${base}/ui/`)).status).toBe(401)
    expect((await fetch(`${base}/ui/`, { headers: { 'authorization-app-api': encodeAppApiAuth('', SECRET) } })).status).toBe(401)
    expect((await fetch(`${base}/img/app.svg`)).status).toBe(401)
  })

  it('serves the icon', async () => {
    const { base } = await serve(join(root, 'web'))
    const res = await get(`${base}/img/app.svg`)
    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(await res.text()).toMatch(/^<svg /)
  })

  it('answers 503 when the web build is missing', async () => {
    const { base, ui } = await serve(join(root, 'missing'))
    expect(ui.csp).toBeNull()
    expect((await get(`${base}/ui/`)).status).toBe(503)
  })
})
