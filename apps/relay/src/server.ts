/**
 * createRelay — the thin Hocuspocus v4 sync server (docs/architecture/relay.md).
 *
 * Auth: static per-share bearer tokens checked in onAuthenticate against the
 * relay-authoritative shares table. Doc names are `<folderGuid>/<docGuid>`,
 * so authorization is a relay-side prefix check — never derived from doc
 * contents. Read-only shares flip `connectionConfig.readOnly`, which makes
 * Hocuspocus drop incoming updates from that connection.
 *
 * Two token kinds (device-link-shaping A4-A, R5):
 *   - `folder` — exact room match, as it has always been. A folder token
 *     never reaches the vault it was carved out of, nor a sibling room.
 *   - `device` — one person's own device. Exact match *or* any room whose
 *     recorded ancestry (the `rooms` table, written by POST /shares with a
 *     `parent`) reaches the token's room, so folders carved after the
 *     devices were linked need no new paste.
 * `read_only` is orthogonal: a read-only device token is read-only
 * everywhere it reaches. The relay stays the only auth authority — maps and
 * descs are advisory (parent D4) and tokens never travel in them.
 *
 * Persistence: full doc state as an opaque blob in SQLite. onLoadDocument
 * returns the stored Uint8Array (v4 applies it as a Yjs update for us);
 * onStoreDocument (debounced by Hocuspocus, flushed on disconnect/destroy)
 * writes the current state back.
 *
 * Plain HTTP on the same port goes through onRequest: `GET /healthz` (the
 * unauthenticated container/proxy probe) and the operator admin API (admin.ts).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { type Hocuspocus, Server } from '@hocuspocus/server'
import { encodeStateAsUpdate } from 'yjs'
import { handleAdminRequest } from './admin.ts'
import { RelayDb } from './db.ts'

/** What a host's `authenticate` hook sees: Hocuspocus's onAuthenticate payload, narrowed. */
export interface AuthenticateInput {
  token: string
  documentName: string
  /** The upgrade request's headers as Hocuspocus v4 hands them over (WHATWG `Headers`). */
  requestHeaders: Headers
  requestParameters: URLSearchParams
}

/** What a host's `authenticate` hook returns; `context` reaches every later hook. */
export interface AuthenticateResult {
  readOnly: boolean
  context: Record<string, unknown>
}

/**
 * Hooks a host embeds its own policy through (nextcloud-build decision 18).
 * Absent, the relay behaves exactly as before: static tokens from the shares
 * table, `/healthz`, and the operator admin API when a secret is set.
 */
export interface RelayHooks {
  /**
   * REPLACES the shares-table check: resolve the token (and the identity the
   * proxy put on the upgrade) to a grant, or throw to refuse. The host owns
   * expiry, user binding and permission re-checks.
   */
  authenticate?: (input: AuthenticateInput) => Promise<AuthenticateResult>
  /** Plain HTTP on the relay's port, consulted FIRST; return true when handled. */
  onRequest?: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>
}

export interface RelayOptions extends RelayHooks {
  dbPath: string
  /** Bind address; defaults to every interface. An ExApp binds its `APP_HOST`. */
  host?: string
  /** Defaults to 0 (ephemeral — read the actual port after listen()). */
  port?: number
  /**
   * Enables the operator admin HTTP API (mint/list/revoke shares) guarded by
   * `Authorization: Bearer <secret>`. Unset → the routes answer 404 and the
   * CLI remains the only mutation path (see admin.ts).
   */
  operatorSecret?: string
  /**
   * Per-room limits (nextcloud-build decision 17), for a relay that serves
   * many tenants from one database. A room is the first doc-name segment.
   * Past `docsPerRoom`, a connection to a doc the room does not hold yet is
   * refused; past `bytesPerRoom`, a new doc is refused and a store that would
   * grow the room is not written (the clients keep their copies; nothing is
   * lost, the relay just stops taking more). Absent: no limits, as before.
   */
  caps?: RoomCaps
  /**
   * Drop awareness updates that arrive on a read-only connection. Hocuspocus
   * already drops a read-only connection's doc updates, but passes its
   * awareness through — and a host whose peers trust an awareness state
   * (the Nextcloud custodian's Files status, decision 8) cannot let a reader
   * write one. Default false: the standalone relay passes a reader's presence.
   */
  dropReadOnlyAwareness?: boolean
  /** A cap refused something (no names or tokens: the room id and which cap). */
  onCapExceeded?: (room: string, cap: 'docs' | 'bytes') => void
}

export interface RoomCaps {
  docsPerRoom: number
  bytesPerRoom: number
}

export interface Relay {
  hocuspocus: Hocuspocus
  db: RelayDb
  /** The bound port; meaningful after listen() resolves. */
  readonly port: number
  listen(): Promise<void>
  destroy(): Promise<void>
  /**
   * Forget a room (an unenrolled vault): close every connection to its docs
   * (4404, the client stops), drop its loaded docs WITHOUT storing them, and
   * delete its docs, shares and ancestry from the database. A store that was
   * already in flight for the room is skipped from then on. Returns the
   * stored docs removed.
   */
  removeRoom(room: string): number
}

/**
 * GET /healthz: 200 `{ ok: true }` only while the database answers a read,
 * else 503 — a relay that accepts sockets but cannot persist is not healthy.
 * Unauthenticated, so it says nothing else (no counts, names or version).
 */
function handleHealthRequest(
  request: IncomingMessage,
  response: ServerResponse,
  db: RelayDb
): boolean {
  if (new URL(request.url ?? '/', 'http://relay.invalid').pathname !== '/healthz') return false
  let ok = true
  try {
    db.ping()
  } catch {
    ok = false
  }
  // Readable cross-origin: the app probes it before a join or a share
  // (apps/web relay-probe.ts) from the web origin and the desktop webview.
  // It carries no credential and says nothing but `ok`, so `*` gives away
  // nothing the socket handshake does not.
  response.writeHead(ok ? 200 : 503, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  })
  response.end(JSON.stringify({ ok }))
  return true
}

const roomOf = (documentName: string): string => documentName.split('/')[0] ?? ''

/** The close a removed room's clients get. Their reconnect is refused: the room's shares went with it. */
export const ROOM_REMOVED = { code: 4404, reason: 'room removed' } as const

/** Refused past a room cap; Hocuspocus reports it to the client as permission-denied. */
export class RoomCapError extends Error {
  override readonly name = 'RoomCapError'
  readonly cap: 'docs' | 'bytes'
  // No parameter property: main.ts runs under Node's type stripping.
  constructor(cap: 'docs' | 'bytes') {
    super(`room ${cap} cap reached`)
    this.cap = cap
  }
}

export function createRelay(opts: RelayOptions): Relay {
  const db = new RelayDb(opts.dbPath)
  const caps = opts.caps ?? null
  /** Rooms forgotten by `removeRoom`: nothing is loaded from or stored for them again. */
  const removedRooms = new Set<string>()

  /**
   * May a connection open `documentName`? A doc the room already holds
   * (stored, or loaded and not yet stored) always may; a NEW one only while
   * the room is under both caps. Loaded-but-unstored docs count too, so a
   * burst of new names cannot slip past before the first store lands.
   */
  const admitDoc = (documentName: string): void => {
    if (!caps) return
    if (server.hocuspocus.documents.has(documentName) || db.docBytes(documentName) !== null) return
    const room = roomOf(documentName)
    const usage = db.roomUsage(room)
    let pending = 0
    for (const name of server.hocuspocus.documents.keys()) {
      if (roomOf(name) === room && db.docBytes(name) === null) pending++
    }
    const cap = usage.docs + pending >= caps.docsPerRoom ? 'docs' : usage.bytes >= caps.bytesPerRoom ? 'bytes' : null
    if (cap) {
      opts.onCapExceeded?.(room, cap)
      throw new RoomCapError(cap)
    }
  }

  const server = new Server({
    port: opts.port ?? 0,
    ...(opts.host ? { address: opts.host } : {}),
    quiet: true,
    stopOnSignals: false, // main.ts owns shutdown; keeps embedded/test use clean

    async onRequest({ request, response }: { request: IncomingMessage; response: ServerResponse }) {
      const handled =
        (opts.onRequest ? await opts.onRequest(request, response) : false) ||
        handleHealthRequest(request, response, db) ||
        (await handleAdminRequest(request, response, db, opts.operatorSecret))
      if (handled) {
        // Hocuspocus contract: a rejected onRequest hook aborts the chain so
        // its default "Welcome to Hocuspocus!" handler never runs; throwing a
        // falsy value aborts without surfacing an error (`if (error) throw`).
        throw null
      }
    },

    async onAuthenticate({ token, documentName, connectionConfig, requestHeaders, requestParameters }) {
      if (opts.authenticate) {
        const grant = await opts.authenticate({ token, documentName, requestHeaders, requestParameters })
        admitDoc(documentName)
        if (grant.readOnly) connectionConfig.readOnly = true
        return grant.context
      }
      const share = db.getShare(token)
      if (!share) throw new Error('unknown share token')
      // One prefix, every doc of the room — the folder doc
      // (`<guid>/folder`) is just another name under it.
      const inScope = documentName.startsWith(`${share.folderGuid}/`)
      // A device token also reaches the rooms carved out of its own room.
      // The room is the first doc-name segment; the walk is bounded and
      // cycle-guarded in db.ancestorsOf.
      const viaAncestry =
        !inScope &&
        share.kind === 'device' &&
        db.ancestorsOf(documentName.split('/')[0] ?? '').includes(share.folderGuid)
      if (!inScope && !viaAncestry) throw new Error('document outside share scope')
      admitDoc(documentName)
      if (share.readOnly) connectionConfig.readOnly = true
      return { folderGuid: share.folderGuid, readOnly: share.readOnly, kind: share.kind }
    },

    async beforeHandleAwareness({ connection, states }) {
      // Emptying the scratch states makes the update a no-op for everyone.
      if (opts.dropReadOnlyAwareness && connection?.readOnly) states.clear()
    },

    async onLoadDocument({ documentName }) {
      if (removedRooms.has(roomOf(documentName))) throw new Error('room removed')
      // Returning a Uint8Array makes Hocuspocus apply it as an update to the
      // fresh server-side Y.Doc; null/undefined means "start empty".
      return db.getDocState(documentName)
    },

    async onStoreDocument({ documentName, document }) {
      if (removedRooms.has(roomOf(documentName))) return
      const state = encodeStateAsUpdate(document)
      if (caps) {
        const room = roomOf(documentName)
        const before = db.docBytes(documentName) ?? 0
        const total = db.roomUsage(room).bytes - before + state.byteLength
        // Over the byte cap, a store that GROWS the room is not written (a
        // shrinking one is: it moves the room back toward the line).
        if (total > caps.bytesPerRoom && state.byteLength > before) {
          opts.onCapExceeded?.(room, 'bytes')
          return
        }
      }
      db.putDocState(documentName, state)
    },
  })

  return {
    hocuspocus: server.hocuspocus,
    db,
    get port() {
      return server.address.port
    },
    async listen() {
      await server.listen()
    },
    removeRoom(room: string): number {
      removedRooms.add(room)
      for (const [name, doc] of [...server.hocuspocus.documents]) {
        if (roomOf(name) !== room) continue
        for (const conn of doc.getConnections()) conn.close({ code: ROOM_REMOVED.code, reason: ROOM_REMOVED.reason })
        // Unloaded without the store hook: the room's state is not written back.
        server.hocuspocus.documents.delete(name)
        doc.destroy()
      }
      return db.removeRoom(room)
    },
    async destroy() {
      // Server.destroy() flushes pending debounced stores and waits for all
      // documents to unload, so doc state is in SQLite before we close it.
      await server.destroy()
      db.close()
    },
  }
}
