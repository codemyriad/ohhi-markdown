/**
 * What a share link LOOKS like when it leaves the app, and the sentence it
 * travels in (first-run-shaping C1/C4). Pure: every environmental fact (are
 * we on the desktop, what is `location.origin`, which relay is the team's)
 * is an argument, so the share sheet, the join page and anything else that
 * hands a link to a person produce the same text.
 *
 *  - `linkOrigin`: which join page a link points at. In a browser, the page's
 *    own origin (the join page lives beside the app that made the link); on
 *    the desktop (whose origin is the webview's, which no teammate can open)
 *    `https://<TEAM_HOST>` — and ONLY when the room's relay is on the team
 *    host, which serves the app and the relay from one origin. Anyone
 *    else's `wss://<host>/relay` may serve no app at all, so otherwise there
 *    is no origin, and the link stays the bare `editor1:` form — unless the
 *    build names a public web app (`webOrigin`, the public flavour's
 *    `VITE_WEB_ORIGIN`, e.g. `https://write.ohhi.md`): its CSP is unpinned, so
 *    its join page can reach any `wss:` relay, and the link points there.
 *  - `presentLink`: the URL form when an origin is known, else the bare link.
 *  - `shareMessage`: "I shared <folder> with you in Oh hi markdown. Open this
 *    link: <link>" (with no origin, the bare link and how to paste it in the
 *    app instead), then the build's network sentence when the relay is the
 *    team's, then "New to the app? <guide>" when there is an origin to put
 *    the guide on.
 */
import { getLL, type TranslationFunctions } from '@ohhi/i18n'
import { relayHost } from '@ohhi/workspace'
import { guideHref } from './guide.js'
import { encodeShareLink, encodeShareUrl, originForRelay, type ShareTarget } from './share-link.js'

/** An origin a teammate can open: http(s) only (`'null'`, `tauri://…`, `file://` are not). */
function webOrigin(origin: string | null | undefined): string | null {
  const o = origin?.trim()
  return o && /^https?:\/\/[^/\s]+$/i.test(o) ? o : null
}

/** Loopback hosts: a relay there is the sharer's own machine, which nobody else's join page can reach. */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/i

/**
 * The join page's origin for a link to a room on `relayUrl`: the browser's
 * own origin; on the desktop the team host (`teamHost`, the build's
 * `TEAM_HOST`) when the relay is on it, else the build's public web app
 * (`publicOrigin`) when the relay is a `wss:` one off this machine; else
 * null (the bare link).
 */
export function linkOrigin(env: {
  desktop: boolean
  locationOrigin?: string | null
  relayUrl: string
  /** The build's team host (`TEAM_HOST`); '' = none, so the desktop has no join page to point at. */
  teamHost?: string
  /** The build's public web app (`WEB_ORIGIN`); '' = none. */
  publicOrigin?: string
}): string | null {
  if (!env.desktop) return webOrigin(env.locationOrigin)
  const team = env.teamHost?.trim().toLowerCase()
  const host = relayHost(env.relayUrl)?.toLowerCase()
  if (team && host === team) return originForRelay(env.relayUrl)
  const open = webOrigin(env.publicOrigin)
  return open && isRemoteWss(env.relayUrl) ? open : null
}

/** A `wss:` relay on another machine — one a join page elsewhere can reach. */
function isRemoteWss(relayUrl: string): boolean {
  try {
    const url = new URL(relayUrl.trim())
    return url.protocol === 'wss:' && !!url.hostname && !LOOPBACK.test(url.hostname)
  } catch {
    return false
  }
}

/** The link as a person receives it: the URL form when an origin is known, else `editor1:…`. */
export function presentLink(target: ShareTarget, origin: string | null): string {
  return origin ? encodeShareUrl(target, origin) : encodeShareLink(target)
}

/** The getting-started guide on `origin`, or null without one. */
export function guideUrl(origin: string | null): string | null {
  return origin ? `${origin.replace(/\/+$/, '')}${guideHref('start')}` : null
}

/**
 * Whether `relayUrl` is the team's relay: the build was given a default
 * relay and this one has the same host.
 */
export function isTeamRelay(relayUrl: string, build: { defaultRelay: string; configured: boolean }): boolean {
  if (!build.configured) return false
  const host = relayHost(relayUrl)
  return !!host && host === relayHost(build.defaultRelay)
}

export interface ShareMessageInput {
  /** What was shared: the folder's path. */
  folder: string
  /** The link as `presentLink` made it. */
  link: string
  /** The build's network sentence (`TEAM_NETWORK_NOTE`), when the relay is the team's; '' otherwise. */
  networkNote?: string
  /** The join page's origin (`linkOrigin`), for the guide link; null → no guide link. */
  origin: string | null
}

/** The message *Copy message* puts on the clipboard. */
export function shareMessage(input: ShareMessageInput, LL: TranslationFunctions = getLL()): string {
  const t = LL.web.share.sheet
  const parts: string[] = [
    input.origin ? t.message({ folder: input.folder, link: input.link }) : t.message_bare({ folder: input.folder, link: input.link }),
  ]
  const note = input.networkNote?.trim()
  if (note) parts.push(note)
  const guide = guideUrl(input.origin)
  if (guide) parts.push(t.message_guide({ url: guide }))
  return parts.join(' ')
}
