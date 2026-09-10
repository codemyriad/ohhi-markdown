/**
 * Client for the relay's operator admin API (apps/relay/src/admin.ts, M4):
 * mint/list/revoke share tokens with the operator secret from Settings. The
 * relay URL users configure is the ws:// endpoint; the admin API lives on the
 * same server over http(s).
 */
import { getLL } from '@editor/i18n'
import type { ShareKind } from './share-link.js'

/**
 * The kind is the link's kind (share-link.ts): `folder` — exact-room token,
 * never grants the vault it was carved out of; `device` — one of my own
 * devices, which also reaches rooms carved out of this one, so a folder
 * shared after linking needs no paste (device-link-shaping A4-A, R5).
 * Absent on a relay predating N3 → treat as 'folder'.
 */
export type { ShareKind }

export interface RelayShare {
  token: string
  folderGuid: string
  readOnly: boolean
  label: string | null
  createdAt?: string
  kind?: ShareKind
  /** Echoed back when the mint recorded an ancestry edge. */
  parent?: string
}

export function adminBaseUrl(relayWsUrl: string): string {
  return relayWsUrl.trim().replace(/^ws/, 'http').replace(/\/+$/, '')
}

async function call<T>(
  relayWsUrl: string,
  secret: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${adminBaseUrl(relayWsUrl)}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
  } catch {
    throw new Error(getLL().web.relay.unreachable({ url: adminBaseUrl(relayWsUrl) }))
  }
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    const t = getLL().web.relay
    if (res.status === 401) throw new Error(t.bad_secret())
    if (res.status === 404 && payload.error === 'not found') {
      throw new Error(t.no_admin())
    }
    throw new Error(payload.error ?? t.failed({ status: res.status }))
  }
  return payload as T
}

/**
 * Mint a token. `kind:'device'` mints a device credential for a root room;
 * `parent` records that `folderGuid` was carved out of that room, which is
 * the edge a device token walks. The relay refuses the two together.
 */
export function mintShare(
  relayWsUrl: string,
  secret: string,
  opts: {
    folderGuid: string
    label?: string
    readOnly?: boolean
    kind?: ShareKind
    parent?: string
  }
): Promise<RelayShare> {
  return call<RelayShare>(relayWsUrl, secret, 'POST', '/shares', opts)
}

export async function listShares(
  relayWsUrl: string,
  secret: string,
  folderGuid?: string
): Promise<RelayShare[]> {
  const q = folderGuid ? `?folder=${encodeURIComponent(folderGuid)}` : ''
  return (await call<{ shares: RelayShare[] }>(relayWsUrl, secret, 'GET', `/shares${q}`)).shares
}

export function revokeShare(relayWsUrl: string, secret: string, token: string): Promise<void> {
  return call<void>(relayWsUrl, secret, 'DELETE', `/shares/${encodeURIComponent(token)}`)
}
