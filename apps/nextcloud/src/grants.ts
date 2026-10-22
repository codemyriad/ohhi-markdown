/**
 * Short-lived, user-bound relay tokens (nextcloud-build decision 4) — the
 * grant behind `POST /api/session`, not the shell's `Session` or a
 * `MountSession`.
 *
 * `POST /api/session {vaultId|fileId}` → `SessionGrant`: a random token, at
 * most 10 minutes, bound in the relay's shares table to the caller's uid and
 * the vault, read-only unless the caller holds every write letter. Tokens
 * live in memory on the client (the provider re-asks on each reconnect);
 * the sweep deletes expired rows on the injected clock. The grant names no
 * relay URL: the shell already knows where it is served from
 * (`detectHost().relayUrl`), and the server would only be guessing it from
 * forwarded headers.
 */
import { randomBytes } from 'node:crypto'
import type { RelayDb } from '@ohhi/relay'
import type { Clock } from '@ohhi/vault'
import type { OhhiDb } from './db.js'
import { every } from './every.js'
import type { SessionGrant } from './types.js'
import { VaultError, type VaultService } from './vaults.js'

export const GRANT_TTL_MS = 10 * 60_000

export interface GrantDeps {
  vaults: Pick<VaultService, 'resolve' | 'accessToVault'>
  db: Pick<OhhiDb, 'recordAccess'>
  relayDb: Pick<RelayDb, 'addShare'>
  clock: Clock
  ttlMs?: number
}

export async function mintGrant(deps: GrantDeps, uid: string, ref: { vaultId?: string; fileId?: number }): Promise<SessionGrant> {
  const row = await deps.vaults.resolve(uid, ref)
  // Fresh, never the 60 s cache: a user who was just given the folder in
  // Files and clicks "Open in Oh Hi" must not see the earlier refusal.
  const access = await deps.vaults.accessToVault(uid, row, { fresh: true })
  if (!access.read) throw new VaultError(403, 'no-read')
  const now = deps.clock.now()
  const token = randomBytes(32).toString('hex')
  const expiresAt = now + Math.min(deps.ttlMs ?? GRANT_TTL_MS, GRANT_TTL_MS)
  const readOnly = !access.write
  deps.relayDb.addShare({ token, folderGuid: row.room, readOnly, kind: 'folder', ncUid: uid, vaultId: row.id, expiresAt })
  deps.db.recordAccess(row.id, uid, now)
  return { token, expiresAt, readOnly, room: row.room, vaultId: row.id }
}

/** Every `intervalMs` on the clock: drop expired tokens. Returns a stop function. */
export function startShareSweep(relayDb: Pick<RelayDb, 'removeExpiredShares'>, clock: Clock, intervalMs = 60_000): () => void {
  return every(clock, intervalMs, () => relayDb.removeExpiredShares(clock.now()))
}

/** Forget every token a uid holds on a vault (it lost read). */
export function revokeTokens(relayDb: Pick<RelayDb, 'listShares' | 'removeShare'>, uid: string, vaultId: string): number {
  let n = 0
  for (const s of relayDb.listShares()) {
    if (s.ncUid !== uid || s.vaultId !== vaultId) continue
    if (relayDb.removeShare(s.token)) n++
  }
  return n
}
