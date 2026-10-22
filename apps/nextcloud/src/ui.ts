/**
 * Static serving of the shell (nextcloud-build decision 1).
 *
 * - `/ui/` and `/ui/index.html` — the web build made with
 *   `--base /exapps/ohhi/ui/` (`OHHI_WEB_DIST`), sent with OUR Content
 *   Security Policy: the hosted web policy (`apps/web/public/_headers`) with
 *   `connect-src 'self'` (same-host `ws:`/`wss:` included) and
 *   `frame-ancestors 'self'`, since the page is an iframe inside Nextcloud's
 *   embedded page. The inline pre-paint theme script's sha256 is computed from
 *   the served `index.html` at startup, the way `check-csp.mjs` does, so it is
 *   never stale. `no-store`.
 * - `/ui/assets/*` — content-hashed, `immutable` for a year.
 * - `/ui/embed.js` — the embedded page's bootstrap IIFE (`OHHI_EMBED_DIST`),
 *   registered as the top-menu entry's script; `no-cache`.
 * - `/img/app.svg` — the navigation and Files-menu icon.
 *
 * Every request needs a verified AppAPI user header (decision 14).
 */
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import type { ServerResponse } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { Handler } from './http.js'
import { HttpError, requireUser, withHttpErrors } from './appapi.js'
import type { Env } from './types.js'

/**
 * The hosted web policy (`apps/web/public/_headers`) minus its inline-script
 * hashes, with the two Nextcloud-host changes. `test/ui.test.ts` fails when
 * `_headers` moves and this does not.
 */
export const POLICY: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  // Nextcloud host: the shell talks only to this container (API + relay).
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-src': ["'none'"],
  // Nextcloud host: framed by Nextcloud's own embedded page (same origin).
  'frame-ancestors': ["'self'"],
}
/** Directives deliberately different from the hosted web policy. */
export const POLICY_OVERRIDES = ['connect-src', 'frame-ancestors'] as const

const PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), browsing-topics=()'

/** `'sha256-…'` of every inline `<script>` in `html` (the same match as apps/desktop/scripts/check-csp.mjs). */
export function inlineScriptHashes(html: string): string[] {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`
  )
}

export function buildCsp(hashes: readonly string[]): string {
  return Object.entries(POLICY)
    .map(([name, sources]) => [name, ...sources, ...(name === 'script-src' ? hashes : [])].join(' '))
    .join('; ')
}

export const APP_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M7 5h18a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H15l-6 5v-5H7a4 4 0 0 1-4-4V9a4 4 0 0 1 4-4z"/>' +
  '<path d="M11 10v9M11 15.5c0-1.9 1.2-2.9 2.7-2.9s2.6 1 2.6 2.9V19M21 14.5V19"/>' +
  '<circle cx="21" cy="10.6" r="0.4" fill="#fff"/></svg>'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

const IMMUTABLE = 'public, max-age=31536000, immutable'

export interface UiOptions {
  env: Env
  /** The `build:nextcloud` output (`OHHI_WEB_DIST`, image default `/app/web`). */
  webDist: string
  /** The folder holding `embed.js` (`OHHI_EMBED_DIST`, image default `/app/embed`). */
  embedDist: string
  log?: (line: string) => void
}

export interface Ui {
  ui: Handler
  icon: Handler
  /** The CSP sent with `index.html` (null when the web build is missing). */
  csp: string | null
}

/** Headers every HTML response from the container carries. */
export function htmlHeaders(csp: string): Record<string, string> {
  return {
    'content-security-policy': csp,
    'x-frame-options': 'SAMEORIGIN',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'permissions-policy': PERMISSIONS_POLICY,
  }
}

/** Decode and check a request path below a root; null when it would escape or is malformed. */
export function safeRelative(path: string): string | null {
  let decoded: string[]
  try {
    decoded = path.split('/').map((s) => decodeURIComponent(s))
  } catch {
    return null
  }
  for (const seg of decoded) {
    if (seg === '' || seg === '.' || seg === '..' || /[\\\u0000]/.test(seg) || seg.includes('/')) return null
  }
  return decoded.join('/')
}

function within(root: string, rel: string): string | null {
  const base = resolve(root)
  const full = resolve(base, rel)
  return full.startsWith(base + sep) ? full : null
}

async function sendFile(res: ServerResponse, head: boolean, file: string, headers: Record<string, string>): Promise<boolean> {
  let size: number
  try {
    const st = await stat(file)
    if (!st.isFile()) return false
    size = st.size
  } catch {
    return false
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-length': String(size),
    'x-content-type-options': 'nosniff',
    ...headers,
  })
  if (head) {
    res.end()
    return true
  }
  await pipeline(createReadStream(file), res)
  return true
}

export function createUi(opts: UiOptions): Ui {
  const log = opts.log ?? ((line: string) => console.log(`[ui] ${line}`))
  let index: Buffer | null = null
  let csp: string | null = null
  try {
    index = readFileSync(join(opts.webDist, 'index.html'))
    const hashes = inlineScriptHashes(index.toString('utf8'))
    csp = buildCsp(hashes)
    log(`web build at ${opts.webDist} (${hashes.length} inline script hash${hashes.length === 1 ? '' : 'es'} pinned)`)
  } catch {
    log(`ERROR: no web build at ${opts.webDist} (index.html missing): /ui/ answers 503`)
  }

  const ui: Handler = withHttpErrors(async (req, res, params) => {
    requireUser(req, opts.env)
    const head = req.method === 'HEAD'
    const raw = params.path ?? ''
    if (raw === '' || raw === 'index.html') {
      if (!index || !csp) throw new HttpError(503, 'web build missing')
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': String(index.length),
        'cache-control': 'no-store',
        ...htmlHeaders(csp),
      })
      res.end(head ? undefined : index)
      return
    }
    const rel = safeRelative(raw)
    if (rel === null) throw new HttpError(404, 'not found')
    if (rel === 'embed.js') {
      const file = within(opts.embedDist, 'embed.js')
      if (file && (await sendFile(res, head, file, { 'cache-control': 'no-cache' }))) return
      throw new HttpError(404, 'not found')
    }
    const file = within(opts.webDist, rel)
    if (!file) throw new HttpError(404, 'not found')
    const isHtml = extname(file).toLowerCase() === '.html'
    const headers: Record<string, string> = {
      'cache-control': rel.startsWith('assets/') ? IMMUTABLE : 'no-cache',
      ...(isHtml && csp ? htmlHeaders(csp) : {}),
    }
    if (isHtml && !csp) throw new HttpError(503, 'web build missing')
    if (await sendFile(res, head, file, headers)) return
    throw new HttpError(404, 'not found')
  })

  const iconBytes = Buffer.from(APP_ICON_SVG, 'utf8')
  const icon: Handler = withHttpErrors(async (req, res) => {
    requireUser(req, opts.env)
    res.writeHead(200, {
      'content-type': 'image/svg+xml',
      'content-length': String(iconBytes.length),
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    })
    res.end(req.method === 'HEAD' ? undefined : iconBytes)
  })

  return { ui, icon, csp }
}

