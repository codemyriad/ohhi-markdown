/**
 * The vault routes (nextcloud-build §HTTP): `POST /api/session`,
 * `GET|POST /api/vaults`, `DELETE /api/vaults/:id`, `GET /api/vaults/:id/status`,
 * `POST /api/vaults/:id/holds/:holdId`. Every one needs the AppAPI header's
 * uid (`requireUser`); every POST and DELETE passes `requireSameOrigin`
 * (decision 14).
 * Errors are `{error}` (+ `reason` on a 409 refusal) and never echo a path.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { HttpError, readJson, requireSameOrigin, requireUser, withHttpErrors } from './appapi.js'
import { mintGrant, type GrantDeps } from './grants.js'
import { HOLD_ACTIONS, type HoldAction } from './holds.js'
import { fileIdOf, json, registerRoutes, type Handler, type RouteName, type Router } from './http.js'
import type { Env } from './types.js'
import type { VaultService } from './vaults.js'

export interface VaultHandlerDeps {
  env: Pick<Env, 'appSecret' | 'nextcloudUrl' | 'publicOrigins'>
  vaults: VaultService
  grants: GrantDeps
  log?: (msg: string) => void
}

type Fn = (uid: string, req: IncomingMessage, res: ServerResponse, params: Record<string, string>) => Promise<void>

/**
 * The caller's uid (401 without one) and, for a POST, the same-origin guard
 * (403). An error that is not an `HttpError` is Nextcloud failing under us:
 * 502, logged by class name only.
 */
function guarded(deps: VaultHandlerDeps, post: boolean, fn: Fn): Handler {
  return withHttpErrors(
    async (req, res, params) => {
      const uid = requireUser(req, deps.env)
      if (post) requireSameOrigin(req, deps.env)
      await fn(uid, req, res, params)
    },
    { unknown: [502, 'nextcloud unavailable'], ...(deps.log ? { log: deps.log } : {}) }
  )
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const v = await readJson(req, 16 * 1024)
  if (v === undefined) return {}
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'expected a JSON object')
  return v as Record<string, unknown>
}

export function vaultHandlers(deps: VaultHandlerDeps): Partial<Record<RouteName, Handler>> {
  return {
    session: guarded(deps, true, async (uid, req, res) => {
      const b = await body(req)
      const vaultId = typeof b.vaultId === 'string' ? b.vaultId : undefined
      const fileId = fileIdOf(b.fileId)
      if (vaultId === undefined && fileId === undefined) throw new HttpError(400, 'vaultId or fileId required')
      const ref = vaultId !== undefined ? { vaultId } : { fileId: fileId! }
      const grant = await mintGrant(deps.grants, uid, ref)
      res.setHeader('cache-control', 'no-store')
      json(res, 200, grant)
    }),
    vaultsList: guarded(deps, false, async (uid, _req, res) => {
      json(res, 200, deps.vaults.list(uid))
    }),
    vaultsCreate: guarded(deps, true, async (uid, req, res) => {
      const fileId = fileIdOf((await body(req)).fileId)
      if (fileId === undefined) throw new HttpError(400, 'fileId required')
      json(res, 200, await deps.vaults.enrol(uid, fileId))
    }),
    vaultDelete: guarded(deps, true, async (uid, _req, res, params) => {
      await deps.vaults.remove(uid, params.id ?? '')
      json(res, 200, { removed: params.id })
    }),
    vaultStatus: guarded(deps, false, async (uid, _req, res, params) => {
      json(res, 200, await deps.vaults.status(uid, params.id ?? ''))
    }),
    vaultHold: guarded(deps, true, async (uid, req, res, params) => {
      const action = (await body(req)).action
      if (typeof action !== 'string' || !HOLD_ACTIONS.has(action)) throw new HttpError(400, 'unknown action')
      json(res, 200, await deps.vaults.hold(uid, params.id ?? '', params.holdId ?? '', action as HoldAction))
    }),
  }
}

/** The vault routes on the process router (main.ts binds them before the 501 fallbacks). */
export function registerVaults(router: Router, deps: VaultHandlerDeps): void {
  registerRoutes(router, vaultHandlers(deps))
}
