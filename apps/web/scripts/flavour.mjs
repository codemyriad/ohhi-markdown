#!/usr/bin/env node
/**
 * The build flavour (docs/public-deploy.md): ONE switch, `VITE_FLAVOUR`,
 * that says which deployment a web (and desktop) build is for, and what
 * that implies. Build config, not a fork: the source is the same, only the
 * `VITE_*` values and the content security policy differ.
 *
 *   team    a self-hosted team host that serves the web app and the relay
 *           from one origin. Needs `VITE_TEAM_HOST`;
 *           the release workflow pins both policies to it first
 *           (apps/desktop/scripts/pin-csp.mjs) and bakes in its relay.
 *           Downloads: https://<host>/updates/downloads.json.
 *   public  app.ohhi.md (Cloudflare Pages) and the public
 *           desktop builds on dist.ohhi.md. No team host, no built-in relay
 *           (the person enters one, or a share link carries it), and the
 *           committed, UNPINNED policy: `connect-src` keeps `wss: https:`, so
 *           any relay and the AI providers the harness calls are reachable.
 *           Downloads: https://<dist host>/stable/downloads.json; desktop
 *           share links point at https://<web host>/join.
 *   (unset) a local or generic build: nothing is derived or checked.
 *
 * `vite.config.ts` applies `resolveFlavour` before Vite reads the env (a
 * contradiction fails the build) and runs `checkHeaders` over `dist/_headers`
 * after it. The release workflow runs this file as a CLI to get the same
 * answers (`node apps/web/scripts/flavour.mjs public` prints key=value lines
 * for $GITHUB_OUTPUT), so the hosts have one default, here.
 *
 * Pure apart from the CLI block at the bottom; node builtins only (the
 * release workflow runs it before any install).
 */
import { pathToFileURL } from 'node:url'

export const FLAVOURS = /** @type {const} */ (['team', 'public'])

/** The public web app's host; the repo variable `PUBLIC_WEB_HOST` overrides it. */
export const PUBLIC_WEB_HOST = 'app.ohhi.md'
/** The public download host (an R2 bucket's custom domain); `PUBLIC_DIST_HOST` overrides it. */
export const PUBLIC_DIST_HOST = 'dist.ohhi.md'

/** The settings only a team build may carry: a public build that has one is a mistake. */
export const TEAM_ONLY = ['VITE_TEAM_HOST', 'VITE_DEFAULT_RELAY', 'VITE_TEAM_SECRET_HINT', 'VITE_TEAM_NETWORK_NOTE']

const BARE_HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i
const text = (v) => (typeof v === 'string' ? v.trim() : '')

/**
 * @typedef {object} Flavour
 * @property {'' | 'team' | 'public'} flavour
 * @property {Record<string, string>} env    VITE_* values to set (defaults only: an explicit value wins)
 * @property {string[]} errors               non-empty → refuse to build
 * @property {string} [updaterEndpoint]      the desktop update feed
 * @property {string} [distBase]             where versioned files are served (public only)
 * @property {string} [downloadsUrl]
 * @property {string} [webOrigin]            public only
 * @property {string} [teamHost]             team only
 */

/**
 * What a flavour means for this environment.
 * @param {Record<string, string | undefined>} env  usually `process.env`
 * @returns {Flavour}
 */
export function resolveFlavour(env) {
  const flavour = text(env.VITE_FLAVOUR)
  if (!flavour) return { flavour: '', env: {}, errors: [] }
  if (!FLAVOURS.includes(/** @type {never} */ (flavour))) {
    return { flavour: '', env: {}, errors: [`VITE_FLAVOUR must be one of ${FLAVOURS.join(', ')}; got "${flavour}"`] }
  }
  const errors = []
  const host = (name, fallback) => {
    const value = text(env[name]) || fallback
    if (!BARE_HOST.test(value)) errors.push(`${name} must be a bare host name (no scheme or path); got "${value}"`)
    return value.toLowerCase()
  }

  if (flavour === 'public') {
    for (const name of TEAM_ONLY) {
      if (text(env[name])) errors.push(`${name} is a team setting; a public build must not set it (got "${text(env[name])}")`)
    }
    const webHost = host('PUBLIC_WEB_HOST', PUBLIC_WEB_HOST)
    const distHost = host('PUBLIC_DIST_HOST', PUBLIC_DIST_HOST)
    const downloadsUrl = text(env.VITE_DOWNLOADS_URL) || `https://${distHost}/stable/downloads.json`
    const webOrigin = text(env.VITE_WEB_ORIGIN) || `https://${webHost}`
    return {
      flavour,
      env: { VITE_FLAVOUR: flavour, VITE_DOWNLOADS_URL: downloadsUrl, VITE_WEB_ORIGIN: webOrigin },
      errors,
      updaterEndpoint: `https://${distHost}/stable/latest.json`,
      distBase: `https://${distHost}`,
      downloadsUrl,
      webOrigin,
    }
  }

  const teamHost = text(env.VITE_TEAM_HOST).toLowerCase()
  if (!teamHost) errors.push('a team build needs VITE_TEAM_HOST (the release workflow passes TEAM_HOST)')
  else if (!BARE_HOST.test(teamHost)) errors.push(`VITE_TEAM_HOST must be a bare host name; got "${teamHost}"`)
  const downloadsUrl = text(env.VITE_DOWNLOADS_URL) || (teamHost ? `https://${teamHost}/updates/downloads.json` : '')
  return {
    flavour,
    env: { VITE_FLAVOUR: flavour, ...(downloadsUrl ? { VITE_DOWNLOADS_URL: downloadsUrl } : {}) },
    errors,
    updaterEndpoint: teamHost ? `https://${teamHost}/updates/latest.json` : '',
    downloadsUrl,
    teamHost,
  }
}

/**
 * The rules of a Cloudflare-style `_headers` file: a line at column 0 is a
 * URL pattern, indented `Name: value` lines below it are its headers, `#`
 * starts a comment. The format Cloudflare Pages reads natively and the one
 * a team host's deploy script can turn into Caddy `header` lines (reading the
 * `/*` rule only), so one file serves both kinds of host.
 * @param {string} text
 * @returns {{ pattern: string, headers: { name: string, value: string }[] }[]}
 */
export function parseHeaders(text) {
  const rules = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      rules.push({ pattern: line.trim(), headers: [] })
      continue
    }
    const m = line.trim().match(/^([A-Za-z0-9-]+):\s*(.*)$/)
    if (m && rules.length) rules[rules.length - 1].headers.push({ name: m[1], value: m[2] })
  }
  return rules
}

/** `connect-src`'s sources in a CSP value, or null without the directive. */
export function connectSources(csp) {
  const directive = csp
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0] === 'connect-src')
  return directive ? directive.slice(1) : null
}

/** Cloudflare Pages' `_headers` limits (developers.cloudflare.com/pages/configuration/headers). */
export const PAGES_MAX_RULES = 100
export const PAGES_MAX_LINE = 2000

/**
 * What is wrong with a built `_headers` for a flavour; [] when nothing is.
 * Public: the policy must be the unpinned one (`wss:` and `https:` in
 * `connect-src` — any relay, the AI providers, dist.ohhi.md) and the file
 * must fit Pages' limits. Team: pinned to exactly the team host
 * (pin-csp.mjs ran), no bare `wss:`/`https:` left.
 * @param {string} text  the `_headers` file
 * @param {{ flavour: '' | 'team' | 'public', teamHost?: string }} opts
 * @returns {string[]}
 */
export function checkHeaders(text, { flavour, teamHost = '' }) {
  if (!flavour) return []
  const errors = []
  const rules = parseHeaders(text)
  const all = rules.find((r) => r.pattern === '/*')
  const csp = all?.headers.find((h) => h.name.toLowerCase() === 'content-security-policy')
  if (!csp) return ['_headers has no Content-Security-Policy in its /* rule']
  const sources = connectSources(csp.value)?.map((s) => s.toLowerCase())
  if (!sources) return ['the Content-Security-Policy has no connect-src']

  if (flavour === 'public') {
    for (const s of ['wss:', 'https:']) {
      if (!sources.includes(s)) errors.push(`a public build's connect-src must allow ${s} (any relay, the AI providers); it is pinned: ${sources.join(' ')}`)
    }
    if (rules.length > PAGES_MAX_RULES) errors.push(`_headers has ${rules.length} rules; Cloudflare Pages reads at most ${PAGES_MAX_RULES}`)
    for (const line of text.split(/\r?\n/)) {
      if (line.length > PAGES_MAX_LINE) errors.push(`a _headers line is ${line.length} characters; Cloudflare Pages reads at most ${PAGES_MAX_LINE}`)
    }
  } else {
    const host = teamHost.toLowerCase()
    for (const s of [`wss://${host}`, `https://${host}`]) {
      if (!sources.includes(s)) errors.push(`a team build's connect-src must name ${s} (pin-csp.mjs); got ${sources.join(' ')}`)
    }
    for (const s of ['wss:', 'https:']) {
      if (sources.includes(s)) errors.push(`a team build's connect-src still allows every ${s} host: run apps/desktop/scripts/pin-csp.mjs first`)
    }
  }
  return errors
}

// ---- CLI: `node apps/web/scripts/flavour.mjs <team|public>` → key=value lines ----

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const f = resolveFlavour({ ...process.env, VITE_FLAVOUR: process.argv[2] ?? process.env.VITE_FLAVOUR })
  if (f.errors.length) {
    for (const e of f.errors) console.error(`flavour: ${e}`)
    process.exit(1)
  }
  const out = {
    flavour: f.flavour,
    updater_endpoint: f.updaterEndpoint ?? '',
    downloads_url: f.downloadsUrl ?? '',
    web_origin: f.webOrigin ?? '',
    dist_base: f.distBase ?? '',
  }
  for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`)
}
