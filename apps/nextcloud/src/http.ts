/**
 * A tiny dependency-free router over `node:http`, and the ExApp's route table
 * (nextcloud-build §HTTP and decision 14).
 *
 * AppAPI/HaRP forwards `/exapps/ohhi/<route>` to the container as `/<route>`;
 * patterns follow info.xml's `^\/?…$` rule (the leading slash is optional), so
 * one regex serves both. `ROUTES` is the table info.xml and the router share
 * (`test/exapp.test.ts` holds them equal): handlers are bound by route name
 * (`registerRoutes`), and `addFallbacks` answers `501` for a declared route
 * nothing bound — so info.xml can never forward to a path the process 404s.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

export type Params = Record<string, string>
export type Handler = (req: IncomingMessage, res: ServerResponse, params: Params) => Promise<void>
export type Method = 'GET' | 'HEAD' | 'POST' | 'DELETE'
/** AppAPI route access level (info.xml `<access_level>`). */
export type AccessLevel = 'PUBLIC' | 'USER' | 'ADMIN'

export interface Router {
  add(method: string, pattern: RegExp, handler: Handler): void
  /** Dispatch; `false` when no route's pattern matched the path (nothing written). */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
}

export interface RouteDesc {
  name: RouteName
  method: Method
  pattern: RegExp
  access: AccessLevel
}

const VAULT_ID = '(?<id>[0-9a-f-]{36})'

/** Declared routes (info.xml). Lifecycle endpoints (`/heartbeat`, `/init`, `/enabled`) are AppAPI-direct and undeclared. */
export const ROUTES = [
  { name: 'ui', method: 'GET', pattern: /^\/?ui\/(?<path>.*)$/, access: 'USER' },
  { name: 'uiHead', method: 'HEAD', pattern: /^\/?ui\/(?<path>.*)$/, access: 'USER' },
  { name: 'appIcon', method: 'GET', pattern: /^\/?img\/app\.svg$/, access: 'USER' },
  /** The Hocuspocus upgrade; a plain GET reaching the router is not an upgrade. */
  { name: 'ws', method: 'GET', pattern: /^\/?ws$/, access: 'USER' },
  { name: 'me', method: 'GET', pattern: /^\/?api\/me$/, access: 'USER' },
  { name: 'session', method: 'POST', pattern: /^\/?api\/session$/, access: 'USER' },
  { name: 'vaultsList', method: 'GET', pattern: /^\/?api\/vaults$/, access: 'USER' },
  { name: 'vaultsCreate', method: 'POST', pattern: /^\/?api\/vaults$/, access: 'USER' },
  /** Unenrol (owner only): the custodian stopped, the marker, row, store and room forgotten. */
  { name: 'vaultDelete', method: 'DELETE', pattern: new RegExp(`^\\/?api\\/vaults\\/${VAULT_ID}$`), access: 'USER' },
  { name: 'vaultStatus', method: 'GET', pattern: new RegExp(`^\\/?api\\/vaults\\/${VAULT_ID}\\/status$`), access: 'USER' },
  {
    name: 'vaultHold',
    method: 'POST',
    pattern: new RegExp(`^\\/?api\\/vaults\\/${VAULT_ID}\\/holds\\/(?<holdId>[^/]+)$`),
    access: 'USER',
  },
  /** The Files menu "Open in Oh Hi" handler (exapp.ts; AppAPI's FileActionsMenu v2 POSTs `{files}`). */
  { name: 'filesAction', method: 'POST', pattern: /^\/?api\/files-action$/, access: 'USER' },
  { name: 'healthz', method: 'GET', pattern: /^\/?healthz$/, access: 'USER' },
  { name: 'adminStatus', method: 'GET', pattern: /^\/?admin\/status$/, access: 'ADMIN' },
] as const satisfies readonly { name: string; method: Method; pattern: RegExp; access: AccessLevel }[]

export type RouteName = (typeof ROUTES)[number]['name']

export function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(bytes) })
  res.end(bytes)
}

export const notImplemented: Handler = async (_req, res) => {
  json(res, 501, { error: 'not implemented' })
}

function pathOf(req: IncomingMessage): string {
  const url = req.url ?? '/'
  const q = url.indexOf('?')
  return q === -1 ? url : url.slice(0, q)
}

export function createRouter(): Router {
  const routes: { method: string; pattern: RegExp; handler: Handler }[] = []
  return {
    add(method, pattern, handler) {
      routes.push({ method: method.toUpperCase(), pattern, handler })
    },
    async handle(req, res) {
      const path = pathOf(req)
      const method = (req.method ?? 'GET').toUpperCase()
      const allowed = new Set<string>()
      for (const route of routes) {
        const m = route.pattern.exec(path)
        if (!m) continue
        if (route.method !== method) {
          allowed.add(route.method)
          continue
        }
        const params: Params = {}
        for (const [k, v] of Object.entries(m.groups ?? {})) if (v !== undefined) params[k] = v
        await route.handler(req, res, params)
        return true
      }
      if (allowed.size === 0) return false
      res.setHeader('allow', [...allowed].join(', '))
      json(res, 405, { error: 'method not allowed' })
      return true
    },
  }
}

/** Bind each handler under its `ROUTES` entry (that entry's method and pattern). */
export function registerRoutes(router: Router, handlers: Partial<Record<RouteName, Handler>>): void {
  for (const route of ROUTES) {
    const handler = handlers[route.name]
    if (handler) router.add(route.method, route.pattern, handler)
  }
}

/**
 * The `501` stub under every route in `ROUTES`. Added last: the router takes
 * the first route whose pattern and method match, so a bound handler wins.
 */
export function addFallbacks(router: Router): void {
  for (const route of ROUTES) router.add(route.method, route.pattern, notImplemented)
}

/** A Nextcloud file id as a JSON body carries it: a positive safe integer, else undefined. */
export function fileIdOf(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined
}

/** Router dispatch with the fallbacks: 404 for an unrouted path, 500 for a handler that threw. */
export async function handleRequest(router: Router, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (!(await router.handle(req, res))) json(res, 404, { error: 'not found' })
  } catch {
    if (!res.headersSent) json(res, 500, { error: 'internal error' })
    else res.end()
  }
}
