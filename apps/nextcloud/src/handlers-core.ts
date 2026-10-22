/**
 * The process's core handlers, registered on the router by one call in
 * main.ts: the AppAPI lifecycle and the Files-menu action (exapp.ts), the
 * static shell and icon (ui.ts), and the small JSON routes `api/me`,
 * `healthz` and `admin/status` (nextcloud-build §HTTP).
 *
 * Registration order matters only against main.ts's 501 fallbacks, added
 * after every `register…` call: the router takes the first route whose
 * pattern and method match.
 */
import { randomUUID } from 'node:crypto'
import type { Clock } from '@ohhi/vault'
import { json, registerRoutes, type Router } from './http.js'
import { ocsClient, requireUser, withHttpErrors, type OcsClient } from './appapi.js'
import { filesActionHandler, registerLifecycle, type Lifecycle } from './exapp.js'
import { createUi } from './ui.js'
import type { Env } from './types.js'

export interface CoreDeps {
  env: Env
  clock: Clock
  /** Defaults to `ocsClient(env, clock)`. */
  ocs?: OcsClient
  /** The shell's build (`OHHI_WEB_DIST`) and the embed bootstrap's folder (`OHHI_EMBED_DIST`). */
  webDist?: string
  embedDist?: string
  /** This process's id in `admin/status` (and the custodian's awareness); defaults to a fresh uuid. */
  instance?: string
  log?: (line: string) => void
  onEnabled?: (enabled: boolean) => void
  /** How many vaults are enrolled, for `admin/status`; the field is left out without it. */
  vaultCount?: () => number
}

export interface Core {
  instance: string
  lifecycle: Lifecycle
}

interface CloudUser {
  displayname?: unknown
  'display-name'?: unknown
}

export function registerCore(router: Router, deps: CoreDeps): Core {
  const { env, clock } = deps
  const ocs = deps.ocs ?? ocsClient(env, clock)
  const instance = deps.instance ?? randomUUID()
  const startedAt = clock.now()

  const lifecycle = registerLifecycle(router, { env, ocs, log: deps.log, onEnabled: deps.onEnabled })
  const ui = createUi({
    env,
    webDist: deps.webDist ?? process.env.OHHI_WEB_DIST ?? '/app/web',
    embedDist: deps.embedDist ?? process.env.OHHI_EMBED_DIST ?? '/app/embed',
    log: deps.log,
  })

  registerRoutes(router, {
    filesAction: filesActionHandler(env),
    ui: ui.ui,
    uiHead: ui.ui,
    appIcon: ui.icon,
    me: withHttpErrors(async (req, res) => {
      const uid = requireUser(req, env)
      let displayName = uid
      try {
        const r = await ocs.get<CloudUser>('/ocs/v2.php/cloud/user', { uid })
        const name = r.status === 200 ? (r.data?.displayname ?? r.data?.['display-name']) : undefined
        if (typeof name === 'string' && name.trim() !== '') displayName = name
      } catch {
        // Nextcloud unreachable: the uid stands in for the display name.
      }
      json(res, 200, { uid, displayName })
    }),
    healthz: withHttpErrors(async (req, res) => {
      requireUser(req, env)
      json(res, 200, { ok: true })
    }),
    // ADMIN in info.xml: AppAPI refuses non-admins before forwarding.
    adminStatus: withHttpErrors(async (req, res) => {
      requireUser(req, env)
      const uptime = Math.round((clock.now() - startedAt) / 1000)
      json(res, 200, { instance, version: env.appVersion, uptime, ...(deps.vaultCount ? { vaults: deps.vaultCount() } : {}) })
    }),
  })

  return { instance, lifecycle }
}
