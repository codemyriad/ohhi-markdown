/**
 * The ExApp's JSON API, as the shell calls it (nextcloud-build
 * §HTTP). Every call is same-origin with the Nextcloud session cookie
 * (`credentials: 'same-origin'`), carries `X-Ohhi-Request: 1` (the server's
 * CSRF guard on every POST and DELETE, decision 14) and speaks JSON; an error answer is
 * `{error, reason?}` and becomes an `NcApiError` the caller words through
 * i18n (`ncErrorText`).
 *
 * The shapes mirror `apps/nextcloud/src/types.ts` — the contract's home. The
 * web build cannot import a Node package, so they are restated here, field
 * for field; change both together.
 */
import { getLL } from '@ohhi/i18n'
import type { DiskState } from '@ohhi/workspace'

export interface NcMe {
  uid: string
  displayName: string
}

export interface NcVaultRow {
  id: string
  fileId: number
  ownerUid: string
  ownerPath: string
  room: string
  epoch: number
  createdAt: string
  status: 'active' | 'needs-operator' | 'lease-lost' | 'paused'
  /** Why the row is not active, when it is a machine reason (`folder-gone`). */
  reason?: string
}

export interface NcSessionGrant {
  token: string
  expiresAt: number
  readOnly: boolean
  room: string
  vaultId: string
}

export interface NcHold {
  id: string
  kind: 'breaker' | 'review'
  paths: string[]
  since: number
  guid?: string
}

/** The custodian's per-file claim (`@ohhi/workspace`'s `DiskState`, the awareness payload's vocabulary). */
export type NcDiskState = DiskState

export interface NcVaultStatus {
  vault: NcVaultRow
  /** `enrolling` while an enrolment is in flight: `files` counts what is done so far. */
  custodian: 'running' | 'enrolling' | 'idle' | 'needs-operator' | 'lease-lost'
  /** A machine reason for `needs-operator` (`folder-gone`). */
  reason?: string
  holds: NcHold[]
  files: Record<string, NcDiskState>
  peers: number
}

export interface NcVaultList {
  own: NcVaultRow[]
  recent: NcVaultRow[]
}

/** A hold's answer: a breaker batch is confirmed or discarded, a review keeps one side. */
export type NcHoldAction = 'confirm' | 'discard' | 'disk' | 'doc'

/** The server said no (or could not be reached: `status` 0). */
export class NcApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly reason?: string
  ) {
    super(code || `HTTP ${status}`)
    this.name = 'NcApiError'
  }
}

export interface NcApi {
  me(): Promise<NcMe>
  vaults(): Promise<NcVaultList>
  /** Enrol a folder this user owns, by its Nextcloud file id. */
  enrol(fileId: number): Promise<NcVaultRow>
  /** `POST /api/session`: a short-lived token for a vault (by id, or by a folder's file id from the Files menu). */
  grant(target: { vaultId: string } | { fileId: number }): Promise<NcSessionGrant>
  status(vaultId: string): Promise<NcVaultStatus>
  resolveHold(vaultId: string, holdId: string, action: NcHoldAction): Promise<NcVaultStatus>
  /** `DELETE /api/vaults/:id`: unenrol a vault you own (its folder in Files is left as it is, minus the marker). */
  remove(vaultId: string): Promise<void>
}

export function createNcApi(base: string, fetchFn: typeof fetch = (...args) => fetch(...args)): NcApi {
  const root = base.replace(/\/+$/, '')

  async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetchFn(`${root}${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'X-Ohhi-Request': '1',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (err) {
      throw new NcApiError(0, err instanceof Error ? err.message : String(err))
    }
    let data: unknown = null
    try {
      data = await res.json()
    } catch {
      /* an empty or non-JSON body: the status speaks for it */
    }
    if (!res.ok) {
      const e = (data ?? {}) as { error?: unknown; reason?: unknown }
      throw new NcApiError(
        res.status,
        typeof e.error === 'string' ? e.error : '',
        typeof e.reason === 'string' ? e.reason : undefined
      )
    }
    return data as T
  }

  return {
    me: () => call<NcMe>('GET', '/me'),
    vaults: () => call<NcVaultList>('GET', '/vaults'),
    enrol: (fileId) => call<NcVaultRow>('POST', '/vaults', { fileId }),
    grant: (target) => call<NcSessionGrant>('POST', '/session', target),
    status: (vaultId) => call<NcVaultStatus>('GET', `/vaults/${encodeURIComponent(vaultId)}/status`),
    resolveHold: (vaultId, holdId, action) =>
      call<NcVaultStatus>(
        'POST',
        `/vaults/${encodeURIComponent(vaultId)}/holds/${encodeURIComponent(holdId)}`,
        { action }
      ),
    remove: async (vaultId) => {
      await call<unknown>('DELETE', `/vaults/${encodeURIComponent(vaultId)}`)
    },
  }
}

/** An API failure in words, for the manager's failure line and the notices. */
export function ncErrorText(err: unknown): string {
  const t = getLL().web.nextcloud.manager.errors
  if (!(err instanceof NcApiError)) return t.unexpected({ message: err instanceof Error ? err.message : String(err) })
  switch (err.status) {
    case 0:
      return t.unreachable()
    case 401:
      return t.signed_out()
    case 403:
      return t.forbidden()
    case 404:
      return t.not_found()
    case 409:
      return err.reason ? t.refused_reason({ reason: err.reason }) : t.refused()
    case 501:
      return t.not_ready()
    default:
      return t.server({ status: err.status })
  }
}

/** A Nextcloud file id as text (typed, pasted, or from `?fileIds=`): digits only and positive, else null. */
export function parseFileId(input: string): number | null {
  const s = input.trim()
  if (!/^\d{1,18}$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}
