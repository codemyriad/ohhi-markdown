/**
 * Share-link codec (onboarding-shaping.md A4/A5). A share link is a single
 * opaque, copy-pasteable string that carries everything a peer needs to join a
 * shared folder: the relay URL, the folder GUID (room), and the bearer token.
 *
 * It is base64url(JSON) behind a versioned `editor1:` prefix. Two reasons it's
 * opaque rather than a query URL: (1) it keeps the secret token out of the
 * address bar / browser history (R5), and (2) it hides the `mode`/`role`/`seed`
 * dev scaffolding from the human-facing artifact.
 */
export interface ShareTarget {
  relay: string
  /** Folder GUID — the relay "room" and the CRDT doc-name prefix. */
  room: string
  token: string
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

export function encodeShareLink(t: ShareTarget): string {
  if (!t.relay || !t.room || !t.token) {
    throw new Error('share target needs relay, room, and token')
  }
  const json = JSON.stringify({ v: 1, relay: t.relay, room: t.room, token: t.token })
  return PREFIX + toBase64Url(new TextEncoder().encode(json))
}

/** Decode a share link. Accepts the string with or without the prefix. Throws on malformed input. */
export function decodeShareLink(link: string): ShareTarget {
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
  return { relay: o.relay, room: o.room, token: o.token }
}

/** True if a pasted string looks like one of our share links (cheap check for UI). */
export function looksLikeShareLink(s: string): boolean {
  return s.trim().startsWith(PREFIX)
}
