/**
 * Operator admin HTTP API (dogfood-shaping R4, slice M4) — in-app token
 * minting, listing, and revocation, served from the relay's own HTTP server
 * via the Hocuspocus `onRequest` hook:
 *
 *   POST   /shares            { folderGuid, label?, readOnly?, kind?, parent? }
 *                             → { token, folderGuid, readOnly, label, kind, parent? }
 *   GET    /shares[?folder=g] → { shares: [{ token, folderGuid, …, kind }] }
 *   DELETE /shares/<token>    → { removed: true }
 *
 * `kind` is 'folder' (default — exact-room match) or 'device' (also reaches
 * rooms carved out of this one; device-link-shaping.md A4-A). `parent` names
 * the room this one was carved out of and records the ancestry edge the
 * device grant walks — a carve sends both `folderGuid` (the new room) and
 * `parent` (the vault room). `parent` with `kind:'device'` is refused: a
 * device token is minted for a root room, never for a child. An ancestry edge
 * is write-once: re-minting with the SAME parent is idempotent, a DIFFERENT
 * parent answers 409 and mints nothing.
 *
 * Every route requires `Authorization: Bearer <OPERATOR_SECRET>`. With no
 * secret configured the routes answer 404 — admin HTTP simply does not exist
 * unless explicitly enabled; the CLI stays the only mutation path. The secret
 * is relay-WIDE, not per-vault: it authenticates the operator, and authorises
 * nothing narrower than "this relay" (see docs/architecture/relay.md).
 *
 * Revocation honesty (R4.3 deferred): deleting a share blocks NEW
 * connections; live connections persist until they reconnect.
 *
 * CORS is wide open (`*`): the credential is the bearer secret itself, and
 * the web shell calls this from the browser (vite origin ≠ relay origin).
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RelayDb, ShareKind } from './db.ts'

/** Body `kind` → the share kind, or null when it is neither of the two. */
function parseKind(value: unknown): ShareKind | null {
  if (value === undefined || value === 'folder') return 'folder'
  return value === 'device' ? 'device' : null
}

/** Handles admin routes; false → not an admin path (fall through to default). */
export async function handleAdminRequest(
  request: IncomingMessage,
  response: ServerResponse,
  db: RelayDb,
  operatorSecret: string | undefined
): Promise<boolean> {
  const url = new URL(request.url ?? '/', 'http://relay.invalid')
  const isShares = url.pathname === '/shares' || url.pathname.startsWith('/shares/')
  if (!isShares) return false

  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
  }
  const json = (status: number, body: unknown): true => {
    response.writeHead(status, { 'Content-Type': 'application/json', ...cors })
    response.end(JSON.stringify(body))
    return true
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors)
    response.end()
    return true
  }

  // Admin HTTP does not exist unless a secret is configured.
  if (!operatorSecret) return json(404, { error: 'not found' })

  if (request.headers.authorization !== `Bearer ${operatorSecret}`) {
    return json(401, { error: 'unauthorized' })
  }

  try {
    if (request.method === 'POST' && url.pathname === '/shares') {
      const body = await readJsonBody(request)
      const folderGuid = typeof body.folderGuid === 'string' ? body.folderGuid.trim() : ''
      if (!folderGuid) return json(400, { error: 'folderGuid is required' })
      const kind = parseKind(body.kind)
      if (!kind) return json(400, { error: 'kind must be "folder" or "device"' })
      const parent = typeof body.parent === 'string' ? body.parent.trim() : ''
      if (body.parent !== undefined && !parent) return json(400, { error: 'parent must be a room' })
      if (parent && kind === 'device') {
        return json(400, { error: 'a device token is minted for a root room, never for a child' })
      }
      if (parent === folderGuid && parent) {
        return json(400, { error: 'parent must differ from folderGuid' })
      }
      // An ancestry edge is write-once. Re-minting a room under a DIFFERENT
      // parent is refused here, before anything is minted: the operator
      // secret is relay-wide, so silently re-pointing the edge would move a
      // victim vault's room under the caller's own — and every device token
      // for that new parent would then reach it (device-link-shaping R5).
      // Same parent = idempotent, and answers 200 as it always has.
      if (parent) {
        const recorded = db.getRoomParent(folderGuid)
        if (recorded !== null && recorded !== parent) {
          return json(409, {
            error: 'this room is already recorded under a different parent',
            parent: recorded,
          })
        }
      }
      const share = {
        token: randomBytes(32).toString('hex'),
        folderGuid,
        readOnly: body.readOnly === true,
        label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null,
        kind,
      }
      db.addShare(share)
      // Ancestry after the mint: a failed mint leaves no edge behind, and the
      // edge itself is write-once (the re-parent case was refused above).
      if (parent) db.setRoomParent(folderGuid, parent)
      return json(200, parent ? { ...share, parent } : share)
    }

    if (request.method === 'GET' && url.pathname === '/shares') {
      const folder = url.searchParams.get('folder')
      const shares = db.listShares().filter((s) => !folder || s.folderGuid === folder)
      return json(200, { shares })
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/shares/')) {
      const token = decodeURIComponent(url.pathname.slice('/shares/'.length))
      if (!token) return json(400, { error: 'token is required' })
      const removed = db.removeShare(token)
      return json(removed ? 200 : 404, removed ? { removed: true } : { error: 'unknown token' })
    }

    return json(405, { error: 'method not allowed' })
  } catch (err) {
    // Bad JSON body and friends — never leak a stack.
    return json(400, { error: err instanceof Error ? err.message : 'bad request' })
  }
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += (chunk as Buffer).length
    if (size > 64 * 1024) throw new Error('body too large')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (typeof parsed !== 'object' || parsed === null) throw new Error('body must be a JSON object')
  return parsed as Record<string, unknown>
}
