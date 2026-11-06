/**
 * The ExApp's shared shapes (nextcloud-build §Contracts): the
 * modules and the web client's `nextcloud/api.ts` mirror these, so a change
 * starts here, never in a copy.
 */
import type { DiskState } from '@ohhi/workspace'

/** A vault row's persisted status; the db reads anything else as `needs-operator`. */
export const VAULT_STATUSES = ['active', 'needs-operator', 'lease-lost', 'paused'] as const

export interface VaultRow {
  id: string
  fileId: number
  ownerUid: string
  ownerPath: string
  room: string
  epoch: number
  createdAt: string
  status: (typeof VAULT_STATUSES)[number]
  /** Why the row is not `active`, when it is a machine reason (`folder-gone`); absent otherwise. */
  reason?: string
}
export interface Access {
  read: boolean
  write: boolean
  path: string | null
} // from permissions.ts
export interface SessionGrant {
  token: string
  expiresAt: number
  readOnly: boolean
  room: string
  vaultId: string
}
export interface Hold {
  id: string
  kind: 'breaker' | 'review'
  paths: string[]
  since: number
  guid?: string
}
/**
 * What `GET /api/vaults/:id/status` reports for a custodian lifecycle or a
 * row status: the two states an operator must see by name, `running`, and
 * `idle` for everything in between. (`enrolling` is the custodian's own
 * answer while an enrolment is in flight — custodian.ts `status`.)
 */
export function reportedCustodian(s: string): VaultStatus['custodian'] {
  return s === 'running' || s === 'needs-operator' || s === 'lease-lost' ? s : 'idle'
}

export interface VaultStatus {
  vault: VaultRow
  custodian: 'running' | 'enrolling' | 'idle' | 'needs-operator' | 'lease-lost'
  /** A machine reason for `needs-operator` (`folder-gone`: the folder was deleted, moved or unshared). */
  reason?: string
  holds: Hold[]
  files: Record<string, DiskState>
  peers: number
}

/**
 * What AppAPI hands the container (its deploy env). `APP_SECRET` is required:
 * every request's `AUTHORIZATION-APP-API` header is verified against it, so
 * the process refuses to start without one (decision 14).
 */
export interface Env {
  appId: string
  appSecret: string
  appPort: number
  appHost: string
  appVersion: string
  aaVersion: string
  /** `NEXTCLOUD_URL` without a trailing slash; its host is one the origin rule admits (appapi.ts `originAllowed`). */
  nextcloudUrl: string
  /**
   * `OHHI_PUBLIC_ORIGINS`: comma-separated origins browsers reach Nextcloud
   * at, admitted by the origin rule besides the request's own Host and
   * `NEXTCLOUD_URL`'s (a proxy that rewrites Host). Normalised; invalid
   * items dropped.
   */
  publicOrigins: string[]
  /** `APP_PERSISTENT_STORAGE` — the volume holding the SQLite db and the mount stores. */
  persistentStorage: string
  /** `OHHI_LOG_LEVEL`: `debug` adds a line per watch walk with its cost (PROPFINDs). */
  logLevel: 'info' | 'debug'
}

export function readEnv(env: Record<string, string | undefined> = process.env): Env {
  const appSecret = env.APP_SECRET ?? ''
  if (appSecret === '') throw new Error('APP_SECRET is not set: refusing to start without the AppAPI secret')
  const appId = env.APP_ID || 'ohhi'
  const port = Number(env.APP_PORT || '23000')
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`APP_PORT is not a port: ${env.APP_PORT}`)
  return {
    appId,
    appSecret,
    appPort: port,
    appHost: env.APP_HOST || '127.0.0.1',
    appVersion: env.APP_VERSION || '0.0.0',
    aaVersion: env.AA_VERSION || '',
    nextcloudUrl: (env.NEXTCLOUD_URL || '').replace(/\/+$/, ''),
    publicOrigins: parseOrigins(env.OHHI_PUBLIC_ORIGINS),
    persistentStorage: env.APP_PERSISTENT_STORAGE || `/nc_app_${appId}_data`,
    logLevel: env.OHHI_LOG_LEVEL === 'debug' ? 'debug' : 'info',
  }
}

/** `a, https://b.example/` → the valid origins, normalised (`new URL(x).origin`), duplicates dropped. */
export function parseOrigins(list: string | undefined): string[] {
  const out: string[] = []
  for (const item of (list ?? '').split(',')) {
    const s = item.trim()
    if (s === '') continue
    try {
      const o = new URL(s).origin
      if (o !== 'null' && !out.includes(o)) out.push(o)
    } catch {
      // not an origin: dropped
    }
  }
  return out
}
