/**
 * Share-link codec (onboarding-shaping A4/A5, extended by
 * device-link-shaping A4-B). A share link is a single opaque,
 * copy-pasteable string that carries everything a peer needs to join a
 * shared folder: the relay URL, the folder GUID (room), and the bearer token —
 * and, optionally (first-run-shaping C1), a `label` (what the sharer calls the
 * thing: the folder's path, or the vault's name for a device link) and a
 * `from` (the sharer's SELF-REPORTED display name — "the name they typed",
 * never a verified account). Both are additive: trimmed, capped at
 * `LINK_TEXT_MAX` characters, absent from the JSON when empty, so every link
 * written before them decodes exactly as before.
 *
 * It is base64url(JSON) behind a versioned `editor1:` prefix. Two reasons it's
 * opaque rather than a query URL: (1) it keeps the secret token out of the
 * address bar / browser history (R5), and (2) it hides the `mode`/`role`/`seed`
 * dev scaffolding from the human-facing artifact.
 *
 * Two kinds of link:
 *   - `folder` (the default, and what every link written before N2 is): one
 *     room, one token. A folder token never reaches the vault it was carved
 *     out of — that rule is the relay's, not the link's.
 *   - `device` — *Link a device*: a full-access credential for one person's
 *     own devices. It may carry `grants`, the {room, relay, token} triples
 *     the linking device holds for its mounts (own and foreign) at link time,
 *     so shared folders arrive already connected on the new device.
 *
 * The payload can travel in two forms (Fork 1-A):
 *   - bare: `editor1:<base64url>` (`encodeShareLink`);
 *   - a URL: `https://<origin>/join#editor1:<base64url>` (`encodeShareUrl`).
 *     The payload sits in the FRAGMENT, which a browser never sends to a
 *     server, so no server, proxy or access log sees the token (R2).
 * Decoding accepts both, plus the web app's older deep-link query
 * `…?share=editor1:<base64url>`.
 *
 * Which origin a URL link points at is the CALLER's choice: a browser can use
 * its own `location.origin`; the desktop can use `originForRelay`, which
 * derives `https://<host>` from a relay at `wss://<host>/relay`. That
 * derivation holds only because such a team host serves the web app and the
 * relay from one origin (its reverse proxy routes `/relay` to the relay,
 * everything else to the app). Any other relay shape (ws://,
 * localhost, another path) has no known join page, so `originForRelay`
 * returns null and the caller falls back to the bare `editor1:` link.
 *
 * Grants are refused on a folder link, encoding and decoding: handing a
 * teammate a link that also carries the vault's tokens is exactly what R5
 * forbids, and a typo must not be able to do it.
 *
 * Every refusal is a `ShareLinkError` with a `code`, never a sentence: the
 * same failure is rendered in a dialog's error line, in a field refusal and
 * in the Log view, and a codec that threw English would put untranslated
 * copy in all three (the i18n rule). `shareLinkErrorText` maps a code to the
 * dictionary for the rendering sites.
 */
import { getLL } from '@ohhi/i18n'

export type ShareKind = 'folder' | 'device'

/** Why a share link could not be built or read. Stable; maps to `web.share.link_error.*`. */
export type ShareLinkErrorCode =
  /** Not decodable at all: bad base64, bad JSON, empty. */
  | 'malformed'
  /** Decoded, but without relay / room / token. */
  | 'missing_fields'
  /** A `kind` this build does not know. */
  | 'unknown_kind'
  /** A grant entry that is not a complete {room, relay, token}. */
  | 'bad_grant'
  /** Grants on a folder link — R5's whole point, refused both ways. */
  | 'grants_on_folder_link'
  /** Asked to ENCODE a target with no relay / room / token. */
  | 'incomplete_target'

export class ShareLinkError extends Error {
  readonly code: ShareLinkErrorCode
  constructor(code: ShareLinkErrorCode) {
    // The message is the code on purpose: it is a developer-facing label, and
    // anything a user reads comes from `shareLinkErrorText` instead.
    super(`share link: ${code}`)
    this.name = 'ShareLinkError'
    this.code = code
  }
}

/** One room's credential, bundled into a device link (A4-B). */
export interface ShareGrant {
  room: string
  relay: string
  token: string
}

export interface ShareTarget {
  relay: string
  /** Folder GUID — the relay "room" and the CRDT doc-name prefix. */
  room: string
  token: string
  /** Absent ⇒ 'folder', so every link written before N2 still decodes. */
  kind?: ShareKind
  /** Device links only: tokens for the mounts the linking device holds. */
  grants?: ShareGrant[]
  /**
   * What the sharer calls the thing: the folder's path for a folder link,
   * the vault's name for a device link. Display only — never a key.
   */
  label?: string
  /** The sharer's self-reported display name ("the name they typed"). */
  from?: string
}

/**
 * What `decodeShareLink` returns: `kind` and `grants` are always resolved;
 * `label` and `from` are `undefined` when the link does not carry them.
 */
export interface DecodedShareLink extends ShareTarget {
  kind: ShareKind
  grants: ShareGrant[]
  label: string | undefined
  from: string | undefined
}

const PREFIX = 'editor1:'

/** Cap on `label` and `from`, in characters (code points). */
export const LINK_TEXT_MAX = 120

/**
 * Normalises an optional display field: a non-string is ignored, a string is
 * trimmed and truncated to `LINK_TEXT_MAX` code points (never split inside a
 * surrogate pair), and an empty result is absent.
 */
function linkText(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const chars = Array.from(v.trim())
  const out = (chars.length > LINK_TEXT_MAX ? chars.slice(0, LINK_TEXT_MAX).join('') : chars.join('')).trim()
  return out === '' ? undefined : out
}

/** `scheme://…` — what separates a URL spelling from a bare payload. */
const URL_SHAPE = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * The `editor1:…` payload inside a pasted string, or null if there is none.
 * Accepts the bare payload, a URL whose fragment is the payload, and a URL
 * carrying `?share=<payload>`. A string that is neither a URL nor prefixed is
 * returned as-is (the decoder still accepts a prefix-less body).
 */
function payloadOf(s: string): string | null {
  const trimmed = s.trim()
  if (!URL_SHAPE.test(trimmed)) return trimmed
  // The fragment, read from the raw string: it is never percent-decoded by
  // anything on the way here, and base64url needs no escaping.
  const hash = trimmed.indexOf('#')
  if (hash >= 0) {
    const frag = trimmed.slice(hash + 1).trim()
    if (frag.startsWith(PREFIX)) return frag
  }
  try {
    const share = new URL(trimmed).searchParams.get('share')?.trim()
    if (share?.startsWith(PREFIX)) return share
  } catch {
    // Not a parseable URL: no payload in it.
  }
  return null
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Normalises the grant list: every entry complete (a half-formed grant is an
 * error, never silently dropped — a link that looks fine but is missing a
 * token would show up later as an unexplained "link needed"), one entry per
 * room, and never a grant for the link's own room (the link carries that
 * token already).
 */
function normalizeGrants(grants: ShareGrant[], ownRoom: string): ShareGrant[] {
  const out: ShareGrant[] = []
  const seen = new Set<string>([ownRoom])
  for (const g of grants) {
    if (!g || typeof g !== 'object') throw new ShareLinkError('bad_grant')
    const { room, relay, token } = g
    if (typeof room !== 'string' || typeof relay !== 'string' || typeof token !== 'string') {
      throw new ShareLinkError('bad_grant')
    }
    if (!room || !relay || !token) throw new ShareLinkError('bad_grant')
    if (seen.has(room)) continue
    seen.add(room)
    out.push({ room, relay, token })
  }
  return out
}

export function encodeShareLink(t: ShareTarget): string {
  if (!t.relay || !t.room || !t.token) {
    throw new ShareLinkError('incomplete_target')
  }
  const kind = t.kind ?? 'folder'
  if (kind !== 'folder' && kind !== 'device') throw new ShareLinkError('unknown_kind')
  const grants = normalizeGrants(t.grants ?? [], t.room)
  if (grants.length > 0 && kind !== 'device') {
    throw new ShareLinkError('grants_on_folder_link')
  }
  const label = linkText(t.label)
  const from = linkText(t.from)
  // `kind`/`grants`/`label`/`from` are omitted when they carry nothing, so a
  // folder link is byte-identical to the ones this codec has always produced.
  const json = JSON.stringify({
    v: 1,
    relay: t.relay,
    room: t.room,
    token: t.token,
    ...(kind === 'device' ? { kind } : {}),
    ...(grants.length > 0 ? { grants } : {}),
    ...(label !== undefined ? { label } : {}),
    ...(from !== undefined ? { from } : {}),
  })
  return PREFIX + toBase64Url(new TextEncoder().encode(json))
}

/**
 * The URL form of a link (Fork 1-A): `<origin>/join#editor1:…`. The payload
 * is in the fragment so no server or log ever sees it (R2). `origin` is the
 * caller's choice — `location.origin` in a browser, `originForRelay(relay)`
 * on the team host; a trailing slash on it is dropped.
 */
export function encodeShareUrl(target: ShareTarget, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/join#${encodeShareLink(target)}`
}

/** Hosts that only ever mean "this machine": no teammate can open a join page there. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The join page's origin for a relay, when it can be derived: a relay of the
 * team-host shape `wss://<host>/relay` (secure, path `/relay`, one trailing
 * slash tolerated, no query or fragment) → `https://<host>`, because the team
 * host serves the app and the relay from one origin (see the file comment).
 * Anything else — `ws://`, a loopback host, another path, an unparseable
 * string — is null, and the caller falls back to the bare `editor1:` link.
 */
export function originForRelay(relayWsUrl: string): string | null {
  let url: URL
  try {
    url = new URL(relayWsUrl.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'wss:') return null
  if (url.pathname !== '/relay' && url.pathname !== '/relay/') return null
  if (url.search || url.hash || url.username || url.password) return null
  const hostname = url.hostname.toLowerCase()
  if (!hostname || LOOPBACK.has(hostname) || hostname.endsWith('.localhost')) return null
  return `https://${url.host}`
}

/**
 * Build a *Link a device* link (A1/A4-B): the root room's device token plus
 * the grants this device holds for its mounts. The copy that surrounds it
 * must say what it is — a full-access credential for your own devices, never
 * to be given to someone else.
 */
export function encodeDeviceLink(t: {
  relay: string
  room: string
  token: string
  grants?: ShareGrant[]
  /** The vault's name, as the new device should show it. */
  label?: string
  from?: string
}): string {
  return encodeShareLink({ ...t, kind: 'device' })
}

/**
 * Decode a share link. Accepts, trimmed: the bare `editor1:…` (or its body
 * without the prefix), a URL whose fragment is `editor1:…`, and a URL
 * carrying `?share=editor1:…`. A URL with neither is `malformed`.
 * Throws a `ShareLinkError` on anything it cannot read.
 */
export function decodeShareLink(link: string): DecodedShareLink {
  const trimmed = payloadOf(link)
  if (trimmed === null) throw new ShareLinkError('malformed')
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed
  let obj: unknown
  try {
    obj = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    throw new ShareLinkError('malformed')
  }
  const o = obj as Record<string, unknown>
  if (typeof o.relay !== 'string' || typeof o.room !== 'string' || typeof o.token !== 'string') {
    throw new ShareLinkError('missing_fields')
  }
  if (o.kind !== undefined && o.kind !== 'folder' && o.kind !== 'device') {
    throw new ShareLinkError('unknown_kind')
  }
  const kind: ShareKind = o.kind === 'device' ? 'device' : 'folder'
  if (o.grants !== undefined && !Array.isArray(o.grants)) {
    throw new ShareLinkError('bad_grant')
  }
  // Strict, not lenient: a malformed grant means the link was built wrong or
  // tampered with, and half-applying it would leave a device silently short
  // of a token it was told it had.
  const grants = normalizeGrants((o.grants ?? []) as ShareGrant[], o.room)
  if (grants.length > 0 && kind !== 'device') {
    throw new ShareLinkError('grants_on_folder_link')
  }
  return {
    relay: o.relay,
    room: o.room,
    token: o.token,
    kind,
    grants,
    // Display-only and lenient, unlike grants: a damaged label costs a
    // sentence, never a token.
    label: linkText(o.label),
    from: linkText(o.from),
  }
}

/**
 * True if a pasted string looks like one of our share links (cheap check for
 * UI): the bare `editor1:…`, or a URL carrying it in its fragment or in
 * `?share=`.
 */
export function looksLikeShareLink(s: string): boolean {
  return payloadOf(s)?.startsWith(PREFIX) ?? false
}

/**
 * The sentence to SHOW for a failure that came out of this codec.
 *
 * The dictionary lookup lives beside the codes rather than in each dialog:
 * four rendering sites (two paste dialogs, the device dialog, App's notice
 * path) show the same failures, and a copy of the switch in each is how they
 * drift apart. Anything that is not a `ShareLinkError` is somebody else's
 * error — the relay's, the workspace's — and passes through with its own
 * (already translated) message.
 */
export function shareLinkErrorText(err: unknown): string {
  if (!(err instanceof ShareLinkError)) {
    return err instanceof Error ? err.message : String(err)
  }
  return getLL().web.share.link_error[err.code]()
}
