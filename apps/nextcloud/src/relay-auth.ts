/**
 * Who may hold a socket on the in-process relay, and for how long
 * (nextcloud-build decisions 4, 5, 14, 17).
 *
 * - The AppAPI header is verified by appapi.ts's `verifyAppApiAuth`; the
 *   upgrade's Origin rule is its `originAllowed` (an Origin is required of a
 *   browser token; the device token is refused WITH one).
 * - `createAuthenticate` is the relay's `authenticate` hook: a short-lived,
 *   user-bound token from the shares table, the uid HaRP put on the upgrade,
 *   the room prefix and the Origin — or the custodian's own device token.
 * - `startAccessRecheck` re-runs the permission check for every live
 *   `(uid, vault)` on the injected clock and closes what lost its grant.
 *
 * Nothing here logs a header, a token or a path.
 */
import type { AuthenticateInput, AuthenticateResult, RelayDb } from '@ohhi/relay'
import type { Clock } from '@ohhi/vault'
import { APPAPI_AUTH_HEADER, originAllowed, originHeaders, verifyAppApiAuth, type OriginPolicy } from './appapi.js'
import { every } from './every.js'
import type { Access } from './types.js'

// ---------------------------------------------------------- authenticate

/** What every authenticated relay connection carries in `connection.context`. */
export interface RelayContext {
  /** The Nextcloud uid; null for the custodian's own connections. */
  uid: string | null
  vaultId: string
  room: string
  /** When the token this connection authenticated with expires (epoch ms); null for the custodian. */
  expiresAt: number | null
}

export interface AuthenticateDeps {
  relayDb: Pick<RelayDb, 'getShare'>
  appSecret: string
  /** The origins a browser's upgrade may come from besides its own Host (`originAllowed`). */
  origins: OriginPolicy
  clock: Clock
  /** The vault whose room this is, for the custodian's device token; null = not a vault room. */
  vaultIdForRoom: (room: string) => string | null
  /** Live access re-check at connect (cached in permissions.ts); a downgrade wins over the token. */
  accessFor?: (uid: string, vaultId: string) => Promise<Access | null>
  /** A browser was let into this vault's room (compose.ts shortens the WebDAV walk's interval). */
  onBrowserJoin?: (vaultId: string) => void
}

class Refused extends Error {
  constructor() {
    // One message for every refusal: the client learns nothing about which check failed.
    super('forbidden')
  }
}

export function createAuthenticate(deps: AuthenticateDeps): (input: AuthenticateInput) => Promise<AuthenticateResult> {
  return async ({ token, documentName, requestHeaders }) => {
    const share = deps.relayDb.getShare(token)
    if (!share) throw new Refused()
    if (share.expiresAt !== null && share.expiresAt <= deps.clock.now()) throw new Refused()
    const origin = requestHeaders.get('origin')
    const appApi = requestHeaders.get(APPAPI_AUTH_HEADER)
    const room = documentName.split('/')[0] ?? ''
    if (!documentName.startsWith(`${room}/`) || room === '') throw new Refused()

    if (share.kind === 'device' && share.ncUid === null) {
      // The custodian's one internal token. It never leaves the process, so a
      // request that came through the proxy (an AppAPI header) or from a
      // browser (an Origin) is not the custodian, whatever token it holds.
      if (appApi !== null || origin !== null || requestHeaders.get('sec-fetch-site') !== null) throw new Refused()
      const vaultId = deps.vaultIdForRoom(room)
      if (vaultId === null) throw new Refused()
      const context: RelayContext = { uid: null, vaultId, room, expiresAt: null }
      return { readOnly: false, context: { ...context } }
    }

    // Browser tokens are always user-bound, folder-kind and expiring.
    if (share.ncUid === null || share.vaultId === null || share.kind !== 'folder') throw new Refused()
    if (!originAllowed(originHeaders((n) => requestHeaders.get(n)), deps.origins)) throw new Refused()
    const id = verifyAppApiAuth(appApi ?? undefined, deps.appSecret)
    if (!id || id.uid === '' || id.uid !== share.ncUid) throw new Refused()
    if (room !== share.folderGuid) throw new Refused()

    let readOnly = share.readOnly
    if (deps.accessFor) {
      const access = await deps.accessFor(id.uid, share.vaultId)
      if (!access?.read) throw new Refused()
      if (!access.write) readOnly = true
    }
    const context: RelayContext = { uid: id.uid, vaultId: share.vaultId, room, expiresAt: share.expiresAt }
    deps.onBrowserJoin?.(share.vaultId)
    return { readOnly, context: { ...context } }
  }
}

// ------------------------------------------------------ live re-check

/** The slice of a Hocuspocus v4 `Connection` the re-check uses. */
export interface ConnectionLike {
  context: unknown
  readOnly: boolean
  close(event?: { code: number; reason: string }): void
  webSocket: { close(code?: number, reason?: string): void }
}
/** The slice of a Hocuspocus v4 instance: `documents` → `getConnections()`. */
export interface HocuspocusLike {
  documents: Map<string, { name: string; getConnections(): ConnectionLike[] }>
}

/** A connection's `(uid, vaultId)`, or null for the custodian / a context we did not make. */
export function contextOf(conn: ConnectionLike): RelayContext | null {
  const c = conn.context as Partial<RelayContext> | null | undefined
  if (!c || typeof c.vaultId !== 'string' || typeof c.room !== 'string') return null
  return {
    uid: typeof c.uid === 'string' ? c.uid : null,
    vaultId: c.vaultId,
    room: c.room,
    expiresAt: typeof c.expiresAt === 'number' ? c.expiresAt : null,
  }
}

/** Browser peers (not the custodian) currently connected to `room`. */
export function peersInRoom(hocuspocus: HocuspocusLike, room: string): number {
  const sockets = new Set<unknown>()
  for (const doc of hocuspocus.documents.values()) {
    if (!doc.name.startsWith(`${room}/`)) continue
    for (const conn of doc.getConnections()) {
      const ctx = contextOf(conn)
      if (ctx && ctx.uid !== null) sockets.add(conn.webSocket)
    }
  }
  return sockets.size
}

/** 4403: Hocuspocus's Forbidden close code; the client reconnects and asks for a fresh token. */
const REVOKED = { code: 4403, reason: 'access changed' }

export interface RecheckDeps {
  hocuspocus: HocuspocusLike
  clock: Clock
  intervalMs?: number
  /** Fresh (uncached) access for this uid on this vault; null = the vault is gone. */
  accessFor: (uid: string, vaultId: string) => Promise<Access | null>
  /**
   * Forget every token this uid holds on this vault: it lost read. A
   * write→read downgrade revokes nothing — the connections are closed and the
   * connect-time check (fed by this pass's fresh read) makes the reconnect
   * read-only, whichever token the shell's grant cache hands back.
   */
  revokeTokens: (uid: string, vaultId: string) => void
  onError?: (err: unknown) => void
}

export interface Recheck {
  /** One pass now (the loop calls this every interval). Resolves when every group is checked. */
  runOnce(): Promise<{ closed: number }>
  stop(): void
}

export function startAccessRecheck(deps: RecheckDeps): Recheck {
  let running: Promise<{ closed: number }> | null = null

  const closeAll = (conns: ConnectionLike[], onError?: (err: unknown) => void): number => {
    const sockets = new Set<ConnectionLike['webSocket']>()
    for (const conn of conns) {
      conn.close(REVOKED)
      sockets.add(conn.webSocket)
    }
    // Close the socket itself too, so the provider reconnects and re-asks
    // POST /api/session for a token that matches the grant as it is now.
    for (const ws of sockets) {
      try {
        ws.close(REVOKED.code, REVOKED.reason)
      } catch (err) {
        onError?.(err)
      }
    }
    return conns.length
  }

  const pass = async (): Promise<{ closed: number }> => {
    const now = deps.clock.now()
    const groups = new Map<string, { uid: string; vaultId: string; conns: ConnectionLike[] }>()
    const expired: ConnectionLike[] = []
    for (const doc of deps.hocuspocus.documents.values()) {
      for (const conn of doc.getConnections()) {
        const ctx = contextOf(conn)
        if (!ctx || ctx.uid === null) continue
        // A token is checked at connect only; a socket outliving it (the
        // user logged out, the grant lapsed) is closed here (nextcloud-build R1 #13).
        if (ctx.expiresAt !== null && ctx.expiresAt <= now) {
          expired.push(conn)
          continue
        }
        const key = `${ctx.uid}\0${ctx.vaultId}`
        let g = groups.get(key)
        if (!g) groups.set(key, (g = { uid: ctx.uid, vaultId: ctx.vaultId, conns: [] }))
        g.conns.push(conn)
      }
    }
    let closed = expired.length > 0 ? closeAll(expired, deps.onError) : 0
    for (const g of groups.values()) {
      let access: Access | null
      try {
        access = await deps.accessFor(g.uid, g.vaultId)
      } catch (err) {
        // Nextcloud unreachable, or AppAPI refusing the app mid-update: keep
        // what is connected (the token still expires on its own).
        deps.onError?.(err)
        continue
      }
      const lostRead = !access?.read
      const lostWrite = !lostRead && !access!.write && g.conns.some((c) => !c.readOnly)
      if (!lostRead && !lostWrite) continue
      if (lostRead) deps.revokeTokens(g.uid, g.vaultId)
      closed += closeAll(g.conns, deps.onError)
    }
    return { closed }
  }

  const runOnce = (): Promise<{ closed: number }> => {
    if (!running) running = pass().finally(() => (running = null))
    return running
  }

  const stop = every(deps.clock, deps.intervalMs ?? 60_000, runOnce, deps.onError)
  return { runOnce, stop }
}
