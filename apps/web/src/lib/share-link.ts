/**
 * Share-link codec (onboarding-shaping.md A4/A5, extended by
 * device-link-shaping.md A4-B). A share link is a single opaque,
 * copy-pasteable string that carries everything a peer needs to join a
 * shared folder: the relay URL, the folder GUID (room), and the bearer token.
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
 * Grants are refused on a folder link, encoding and decoding: handing a
 * teammate a link that also carries the vault's tokens is exactly what R5
 * forbids, and a typo must not be able to do it.
 */
export type ShareKind = 'folder' | 'device'

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
}

/** What `decodeShareLink` returns: `kind` and `grants` are always resolved. */
export interface DecodedShareLink extends ShareTarget {
  kind: ShareKind
  grants: ShareGrant[]
}

const PREFIX = 'editor1:'

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
    if (!g || typeof g !== 'object') throw new Error('share link grant is malformed')
    const { room, relay, token } = g
    if (typeof room !== 'string' || typeof relay !== 'string' || typeof token !== 'string') {
      throw new Error('share link grants need relay, room, and token')
    }
    if (!room || !relay || !token) throw new Error('share link grants need relay, room, and token')
    if (seen.has(room)) continue
    seen.add(room)
    out.push({ room, relay, token })
  }
  return out
}

export function encodeShareLink(t: ShareTarget): string {
  if (!t.relay || !t.room || !t.token) {
    throw new Error('share target needs relay, room, and token')
  }
  const kind = t.kind ?? 'folder'
  if (kind !== 'folder' && kind !== 'device') throw new Error('unknown share link kind')
  const grants = normalizeGrants(t.grants ?? [], t.room)
  if (grants.length > 0 && kind !== 'device') {
    throw new Error('only a device link may carry grants')
  }
  // `kind`/`grants` are omitted when they carry nothing, so a folder link is
  // byte-identical to the ones this codec has always produced.
  const json = JSON.stringify({
    v: 1,
    relay: t.relay,
    room: t.room,
    token: t.token,
    ...(kind === 'device' ? { kind } : {}),
    ...(grants.length > 0 ? { grants } : {}),
  })
  return PREFIX + toBase64Url(new TextEncoder().encode(json))
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
}): string {
  return encodeShareLink({ ...t, kind: 'device' })
}

/** Decode a share link. Accepts the string with or without the prefix. Throws on malformed input. */
export function decodeShareLink(link: string): DecodedShareLink {
  const trimmed = link.trim()
  const body = trimmed.startsWith(PREFIX) ? trimmed.slice(PREFIX.length) : trimmed
  let obj: unknown
  try {
    obj = JSON.parse(new TextDecoder().decode(fromBase64Url(body)))
  } catch {
    throw new Error('not a valid share link')
  }
  const o = obj as Record<string, unknown>
  if (typeof o.relay !== 'string' || typeof o.room !== 'string' || typeof o.token !== 'string') {
    throw new Error('share link is missing relay/room/token')
  }
  if (o.kind !== undefined && o.kind !== 'folder' && o.kind !== 'device') {
    throw new Error('unknown share link kind')
  }
  const kind: ShareKind = o.kind === 'device' ? 'device' : 'folder'
  if (o.grants !== undefined && !Array.isArray(o.grants)) {
    throw new Error('share link grant is malformed')
  }
  // Strict, not lenient: a malformed grant means the link was built wrong or
  // tampered with, and half-applying it would leave a device silently short
  // of a token it was told it had.
  const grants = normalizeGrants((o.grants ?? []) as ShareGrant[], o.room)
  if (grants.length > 0 && kind !== 'device') {
    throw new Error('only a device link may carry grants')
  }
  return { relay: o.relay, room: o.room, token: o.token, kind, grants }
}

/** True if a pasted string looks like one of our share links (cheap check for UI). */
export function looksLikeShareLink(s: string): boolean {
  return s.trim().startsWith(PREFIX)
}
