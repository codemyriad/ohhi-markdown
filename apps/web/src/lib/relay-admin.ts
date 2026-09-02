/**
 * Client for the relay's operator admin API (apps/relay/src/admin.ts, M4):
 * mint/list/revoke share tokens with the operator secret from Settings. The
 * relay URL users configure is the ws:// endpoint; the admin API lives on the
 * same server over http(s).
 */
export interface RelayShare {
  token: string
  folderGuid: string
  readOnly: boolean
  label: string | null
  createdAt?: string
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
    throw new Error(`relay unreachable at ${adminBaseUrl(relayWsUrl)} — is it running?`)
  }
  const payload = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) {
    if (res.status === 401) throw new Error('relay rejected the operator secret — check Settings')
    if (res.status === 404 && payload.error === 'not found') {
      throw new Error('this relay has no admin API enabled (OPERATOR_SECRET unset)')
    }
    throw new Error(payload.error ?? `relay admin call failed (${res.status})`)
  }
  return payload as T
}

export function mintShare(
  relayWsUrl: string,
  secret: string,
  opts: { folderGuid: string; label?: string; readOnly?: boolean }
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
