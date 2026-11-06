import { afterEach, describe, expect, it } from 'vitest'
import { addFallbacks, createRouter, json, registerRoutes, ROUTES, type Handler, type RouteName, type Router } from '../src/http.js'
import { closeServers, serveRouter as serve } from './fixtures.js'

afterEach(closeServers)

/** Every route in `ROUTES`: the given handlers, then the 501 fallbacks (main.ts's order). */
function appRouter(handlers: Partial<Record<RouteName, Handler>> = {}): Router {
  const router = createRouter()
  registerRoutes(router, handlers)
  addFallbacks(router)
  return router
}

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function matching(path: string, method: string) {
  return ROUTES.filter((r) => r.method === method && r.pattern.test(path)).map((r) => r.name)
}

describe('ROUTES', () => {
  it('matches with and without the leading slash (info.xml ^\\/? rule)', () => {
    expect(matching('/api/me', 'GET')).toEqual(['me'])
    expect(matching('api/me', 'GET')).toEqual(['me'])
    expect(matching('/healthz', 'GET')).toEqual(['healthz'])
    expect(matching('healthz', 'GET')).toEqual(['healthz'])
    expect(matching(`api/vaults/${ID}/status`, 'GET')).toEqual(['vaultStatus'])
  })

  it('anchors both ends', () => {
    expect(matching('/api/me/x', 'GET')).toEqual([])
    expect(matching('/x/api/me', 'GET')).toEqual([])
    expect(matching('//api/me', 'GET')).toEqual([])
    expect(matching('/api/vaults/not-a-uuid/status', 'GET')).toEqual([])
  })

  it('names are unique and cover the brief’s table', () => {
    const names = ROUTES.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names).toEqual(
      expect.arrayContaining(['ui', 'appIcon', 'ws', 'me', 'session', 'vaultsList', 'vaultsCreate', 'vaultStatus', 'vaultHold', 'healthz', 'adminStatus'])
    )
    expect(ROUTES.find((r) => r.name === 'adminStatus')!.access).toBe('ADMIN')
  })
})

describe('router', () => {
  it('passes named groups as params and ignores the query', async () => {
    const seen: unknown[] = []
    const base = await serve(
      appRouter({
        vaultHold: async (_req, res, params) => {
          seen.push(params)
          json(res, 200, { ok: true })
        },
      })
    )
    const res = await fetch(`${base}/api/vaults/${ID}/holds/h1?x=1`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(seen).toEqual([{ id: ID, holdId: 'h1' }])
  })

  it('answers 501 for a declared route nothing bound', async () => {
    const base = await serve(appRouter())
    const res = await fetch(`${base}/api/me`)
    expect(res.status).toBe(501)
    expect(await res.json()).toEqual({ error: 'not implemented' })
  })

  it('answers 404 for an unknown path', async () => {
    const base = await serve(appRouter())
    const res = await fetch(`${base}/nope`)
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('answers 405 for a known path with the wrong method', async () => {
    const base = await serve(appRouter())
    const res = await fetch(`${base}/api/session`)
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('handle() reports false without writing when nothing matched', async () => {
    const router = createRouter()
    router.add('GET', /^\/?a$/, async (_req, res) => json(res, 200, {}))
    let wrote = false
    const res = { writeHead: () => (wrote = true), end: () => (wrote = true), setHeader: () => {} }
    expect(await router.handle({ url: '/b', method: 'GET' } as never, res as never)).toBe(false)
    expect(wrote).toBe(false)
  })

  it('answers 500 when a handler throws', async () => {
    const base = await serve(
      appRouter({
        healthz: async () => {
          throw new Error('boom')
        },
      })
    )
    expect((await fetch(`${base}/healthz`)).status).toBe(500)
  })
})
