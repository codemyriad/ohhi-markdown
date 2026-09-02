/**
 * Operator admin HTTP API (dogfood-shaping R4, slice M4) — in-app token
 * minting, listing, and revocation, served from the relay's own HTTP server
 * via the Hocuspocus `onRequest` hook:
 *
 *   POST   /shares            { folderGuid, label?, readOnly? } → { token, … }
 *   GET    /shares[?folder=g] → { shares: [{ token, folderGuid, … }] }
 *   DELETE /shares/<token>    → { removed: true }
 *
 * Every route requires `Authorization: Bearer <OPERATOR_SECRET>`. With no
 * secret configured the routes answer 404 — admin HTTP simply does not exist
 * unless explicitly enabled; the CLI stays the only mutation path.
 *
 * Revocation honesty (R4.3 deferred): deleting a share blocks NEW
 * connections; live connections persist until they reconnect.
 *
 * CORS is wide open (`*`): the credential is the bearer secret itself, and
 * the web shell calls this from the browser (vite origin ≠ relay origin).
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RelayDb } from './db.ts'

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
      const share = {
        token: randomBytes(32).toString('hex'),
        folderGuid,
        readOnly: body.readOnly === true,
        label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : null,
      }
      db.addShare(share)
      return json(200, share)
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
