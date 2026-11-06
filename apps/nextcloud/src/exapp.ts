/**
 * AppAPI's lifecycle endpoints (nextcloud-build decision 14;
 * spike S16): reached by AppAPI directly, never through a declared route, so
 * they live outside `ROUTES`. `/init` and `/enabled` require AppAPI's own
 * header (verified secret, EMPTY uid).
 *
 * `GET /heartbeat` answers without a header: AppAPI sends one only on a HaRP
 * daemon (`AppAPIService::heartbeatExApp`), a Docker Socket Proxy daemon
 * polls bare, and the reply (`{status:'ok'}`) says nothing.
 *
 * - `POST /init` → 200 at once, then `PUT /ocs/v2.php/apps/app_api/ex-app/status
 *   {progress:100}` (until that lands, `app_api:app:register --wait-finish` polls).
 * - `PUT /enabled?enabled=1` → 200 `{error:''}`, then the top-menu entry, its
 *   script (`ui/embed` — AppAPI appends `.js`) and the Files menu entry. All
 *   three upsert server-side, so every enable re-registers. `enabled=0`
 *   deregisters nothing: AppAPI drops an app's UI entries on disable.
 *
 * The Files entry "Open in Oh Hi" (NC3, §HTTP note on `?fileIds=`) is
 * registered through AppAPI's FileActionsMenu **v2**
 * (`OCSUiController::registerFileActionMenuV2`). On click, AppAPI's Files
 * plugin (`src/filesplugin.js`, `registerFileAction33`) POSTs
 * `{files: [NodeInfo]}` to `/apps/app_api/proxy/<appid>/<actionHandler>` —
 * `ROUTES`' `filesAction`, declared in info.xml like every other — and, when
 * the reply carries `redirect_handler`, navigates to
 * `/apps/app_api/embedded/<appid>/<redirect_handler>?fileIds=<id>[,<id>…]`:
 * the top-menu page, whose `embed.js` passes `?fileIds=` into the iframe.
 * The handler itself changes nothing: opening (or enrolling) happens in the
 * shell through `POST /api/session {fileId}`.
 */
import { HttpError, readJson, requireEmptyUser, requireUser, withHttpErrors, type OcsClient } from './appapi.js'
import { fileIdOf, json, ROUTES, type Handler, type Router } from './http.js'
import type { Env } from './types.js'

export const STATUS_PATH = '/ocs/v2.php/apps/app_api/ex-app/status'
export const TOP_MENU_PATH = '/ocs/v2.php/apps/app_api/api/v1/ui/top-menu'
export const SCRIPT_PATH = '/ocs/v2.php/apps/app_api/api/v1/ui/script'
export const FILES_MENU_PATH = '/ocs/v2.php/apps/app_api/api/v2/ui/files-actions-menu'

/** The top-menu entry's name; the Files action redirects to it. */
export const TOP_MENU_NAME = 'app'

export const TOP_MENU_ENTRY = { name: TOP_MENU_NAME, displayName: 'Oh Hi', icon: 'img/app.svg', adminRequired: 0 } as const
export const TOP_MENU_SCRIPT = { type: 'top_menu', name: TOP_MENU_NAME, path: 'ui/embed' } as const

/** The handler AppAPI's Files plugin POSTs to (through the PHP proxy, so the path may arrive without its leading slash). */
export const FILES_ACTION_ROUTE = ROUTES.find((r) => r.name === 'filesAction')!

export const FILES_MENU_ENTRY = {
  name: 'open-in-ohhi',
  displayName: 'Open in Oh Hi',
  actionHandler: 'api/files-action',
  icon: 'img/app.svg',
  /** Folders only — AppAPI matches with `node.mime.includes(mime)`. */
  mime: 'httpd/unix-directory',
  /** Stored by AppAPI (OCP permission bits); 1 = read, so read-only recipients see the entry too. */
  permissions: 1,
  order: 0,
} as const

export const LIFECYCLE_ROUTES = {
  heartbeat: /^\/?heartbeat$/,
  init: /^\/?init$/,
  enabled: /^\/?enabled$/,
} as const

export interface LifecycleDeps {
  env: Env
  ocs: OcsClient
  log?: (line: string) => void
  /** Told after `PUT /enabled` answered (main.ts starts or stops the custodians here). */
  onEnabled?: (enabled: boolean) => void
}

export interface Lifecycle {
  /** Resolves when every background callback started so far has finished (tests). */
  settled(): Promise<void>
}

function queryOf(url: string | undefined): URLSearchParams {
  const q = (url ?? '').indexOf('?')
  return new URLSearchParams(q === -1 ? '' : (url ?? '').slice(q + 1))
}

/** The UI registrations `PUT /enabled?enabled=1` makes, in order; each logs its status. */
export async function registerUi(ocs: OcsClient, log: (line: string) => void): Promise<void> {
  const steps: [string, () => Promise<number>][] = [
    ['top-menu', async () => (await ocs.post(TOP_MENU_PATH, TOP_MENU_ENTRY)).status],
    ['script', async () => (await ocs.post(SCRIPT_PATH, TOP_MENU_SCRIPT)).status],
    ['files-menu', async () => (await ocs.post(FILES_MENU_PATH, FILES_MENU_ENTRY)).status],
  ]
  for (const [name, step] of steps) {
    try {
      const status = await step()
      log(status >= 200 && status < 300 ? `ui ${name}: registered` : `ERROR: ui ${name}: HTTP ${status}`)
    } catch (err) {
      log(`ERROR: ui ${name}: ${(err as Error).message}`)
    }
  }
}

export function registerLifecycle(router: Router, deps: LifecycleDeps): Lifecycle {
  const log = deps.log ?? ((line: string) => console.log(`[exapp] ${line}`))
  const pending = new Set<Promise<void>>()
  const background = (task: () => Promise<void>) => {
    const p = task()
      .catch((err: unknown) => log(`ERROR: ${(err as Error).message}`))
      .finally(() => pending.delete(p))
    pending.add(p)
  }

  router.add('GET', LIFECYCLE_ROUTES.heartbeat, async (_req, res) => json(res, 200, { status: 'ok' }))

  router.add(
    'POST',
    LIFECYCLE_ROUTES.init,
    withHttpErrors(async (req, res) => {
      requireEmptyUser(req, deps.env)
      json(res, 200, {})
      background(async () => {
        const { status } = await deps.ocs.put(STATUS_PATH, { progress: 100, error: '' })
        log(
          status >= 200 && status < 300
            ? 'init: reported progress=100'
            : `ERROR: init: status report HTTP ${status} — app_api:app:register --wait-finish will wait until its timeout`
        )
      })
    })
  )

  router.add(
    'PUT',
    LIFECYCLE_ROUTES.enabled,
    withHttpErrors(async (req, res) => {
      requireEmptyUser(req, deps.env)
      const enabled = queryOf(req.url).get('enabled') === '1'
      json(res, 200, { error: '' })
      log(`enabled=${enabled ? 1 : 0}`)
      deps.onEnabled?.(enabled)
      if (enabled) background(() => registerUi(deps.ocs, log))
    })
  )

  return {
    async settled() {
      while (pending.size > 0) await Promise.all([...pending])
    },
  }
}

/** One `NodeInfo` as AppAPI's Files plugin builds it (`buildNodeInfo`); only `fileId` is read. */
interface FilesActionBody {
  files?: { fileId?: unknown }[]
}

/** `POST /api/files-action` → `{redirect_handler: 'app'}`; 400 when no file id came. */
export function filesActionHandler(env: Env): Handler {
  return withHttpErrors(async (req, res) => {
    requireUser(req, env)
    const body = (await readJson(req)) as FilesActionBody | undefined
    const ids = (body?.files ?? []).map((f) => fileIdOf(f?.fileId)).filter((id) => id !== undefined)
    if (ids.length === 0) throw new HttpError(400, 'no fileId')
    json(res, 200, { redirect_handler: TOP_MENU_NAME })
  })
}
