/**
 * Server-owned vaults (nextcloud-build decisions 3, 5, 7, 17): enrolment from
 * a Files folder id, the per-user list, status and held decisions. Routes
 * hand this a vault id or a Nextcloud file id — never a path or a room — and
 * every answer is checked against the caller's own `oc:permissions`.
 */
import { randomUUID } from 'node:crypto'
import { foreignReason, OHHI_HOST_MARKER, type Clock } from '@ohhi/vault'
import { HttpError } from './appapi.js'
import type { OhhiDb } from './db.js'
import type { HoldAction } from './holds.js'
import type { NcDav, NcEntry, Permissions } from './permissions.js'
import { reportedCustodian, type Access, type VaultRow, type VaultStatus } from './types.js'

export const MAX_VAULTS_PER_USER = 10

/** A refusal with its HTTP status and a stable machine `reason` (a 409 answers `{error: 'refused', reason}`). */
export class VaultError extends HttpError {
  constructor(status: number, reason: string) {
    super(status, reason, reason)
    this.name = 'VaultError'
  }
}

/** What the vault service needs from whoever runs custodians (compose.ts). */
export interface CustodianHost {
  /** Start the custodian for a freshly enrolled row; false = it refused (the row is rolled back). */
  enrol(row: VaultRow): Promise<boolean>
  /** The vault's status, or null when no custodian has ever been built for it. */
  status(row: VaultRow): VaultStatus | null
  applyHold(row: VaultRow, holdId: string, action: HoldAction): Promise<void>
  /**
   * Unenrol: stop the custodian (its lease released), delete the marker in
   * Files (best effort), forget the row and its recents, wipe the store and
   * the room on the relay (its live connections closed).
   */
  remove(row: VaultRow): Promise<void>
}

export interface VaultServiceDeps {
  db: OhhiDb
  dav: Pick<NcDav, 'findById' | 'walk' | 'readFile'>
  permissions: Permissions
  clock: Clock
  custodians: CustodianHost
  maxVaultsPerUser?: number
}

function within(child: string, parent: string): boolean {
  return parent === '' || child === parent || child.startsWith(`${parent}/`)
}

/** Not `uid`'s own content, by the rule the custodian's WebDAV adapter hides entries by (an absent owner is foreign). */
function foreign(e: NcEntry, uid: string): boolean {
  return foreignReason({ ownerId: e.ownerId ?? '', mountType: e.mountType ?? '' }, uid) !== null
}

export class VaultService {
  private enrolChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: VaultServiceDeps) {}

  /** POST /api/vaults — serialized, so two enrolments never race the nesting checks. */
  enrol(uid: string, fileId: number): Promise<VaultRow> {
    const run = this.enrolChain.then(() => this.enrolNow(uid, fileId))
    this.enrolChain = run.catch(() => {})
    return run
  }

  private async enrolNow(uid: string, fileId: number): Promise<VaultRow> {
    const { db, dav } = this.deps
    const target = await dav.findById(uid, fileId)
    if (!target) throw new VaultError(404, 'not-found')
    if (!target.isDir) throw new VaultError(409, 'not-a-folder')
    if (target.ownerId !== uid) throw new VaultError(403, 'not-owner')
    const existing = db.vaultByFileId(fileId)
    if (existing) return existing
    if (target.path === '') throw new VaultError(409, 'home-folder')
    if (foreign(target, uid)) throw new VaultError(409, 'foreign-content')

    const owned = db.vaultsOwnedBy(uid)
    // Only `active` rows hold a slot: a folder deleted in Files (`folder-gone`)
    // or a stuck row must not lock its owner out of enrolling another.
    if (db.activeVaultsOwnedBy(uid) >= (this.deps.maxVaultsPerUser ?? MAX_VAULTS_PER_USER)) throw new VaultError(409, 'too-many-vaults')
    // Nesting, by where each enrolled folder is NOW (a folder moved since its
    // enrolment is found by its file id, not by the path on its row).
    const ownedIds = new Set<number>()
    for (const v of owned) {
      ownedIds.add(v.fileId)
      const now = await dav.findById(uid, v.fileId)
      const path = now?.path ?? v.ownerPath
      if (now && now.path !== v.ownerPath) db.setOwnerPath(v.id, now.path)
      if (within(target.path, path) || within(path, target.path)) throw new VaultError(409, 'nested-vault')
    }
    // The whole subtree: nothing shared in, nothing mounted, no enrolled vault below.
    const subtree = await dav.walk(uid, target.path)
    for (const e of subtree) {
      if (foreign(e, uid)) throw new VaultError(409, 'foreign-content')
      if (e.fileId !== null && e.fileId !== fileId && ownedIds.has(e.fileId)) throw new VaultError(409, 'nested-vault')
      if (e.fileId !== null && e.fileId !== fileId && db.vaultByFileId(e.fileId)) throw new VaultError(409, 'nested-vault')
    }
    // A marker at the root belongs to another room (this one has no room yet).
    const marker = await dav.readFile(uid, `${target.path}/${OHHI_HOST_MARKER}`)
    if (marker !== null) throw new VaultError(409, 'marked-for-another-room')

    const row: VaultRow = {
      id: randomUUID(),
      fileId,
      ownerUid: uid,
      ownerPath: target.path,
      room: randomUUID(),
      epoch: 1,
      createdAt: new Date(this.deps.clock.now()).toISOString(),
      status: 'active',
    }
    try {
      db.insertVault(row)
    } catch {
      // A concurrent enrolment of the same file id won the UNIQUE race.
      const won = db.vaultByFileId(fileId)
      if (won) return won
      throw new VaultError(409, 'enrol-conflict')
    }
    const started = await this.deps.custodians.enrol(row).catch(() => false)
    if (!started) {
      db.deleteVault(row.id)
      throw new VaultError(409, 'custodian-refused')
    }
    return db.getVault(row.id) ?? row
  }

  /**
   * The caller's access to a vault: their own `oc:permissions` on the folder,
   * and never write when the OWNER cannot write it (the custodian writes as
   * the owner, decision 5).
   */
  async accessToVault(uid: string, row: VaultRow, opts?: { fresh?: boolean }): Promise<Access> {
    const mine = await this.deps.permissions.accessFor(uid, row.fileId, opts)
    if (!mine.read || !mine.write || uid === row.ownerUid) return mine
    const owner = await this.deps.permissions.accessFor(row.ownerUid, row.fileId, opts)
    return owner.write ? mine : { ...mine, write: false }
  }

  /** Access by vault id (the relay hooks); null when the vault is gone. */
  async accessById(uid: string, vaultId: string, opts?: { fresh?: boolean }): Promise<Access | null> {
    const row = this.deps.db.getVault(vaultId)
    return row ? this.accessToVault(uid, row, opts) : null
  }

  /**
   * The vault a session asks for: by id, or by a Files folder id — enrolling
   * it first when the caller owns it and it is not enrolled yet.
   */
  async resolve(uid: string, ref: { vaultId?: string; fileId?: number }): Promise<VaultRow> {
    const { db } = this.deps
    if (typeof ref.vaultId === 'string') {
      const row = db.getVault(ref.vaultId)
      if (!row) throw new VaultError(404, 'not-found')
      return row
    }
    if (typeof ref.fileId === 'number') {
      const row = db.vaultByFileId(ref.fileId)
      if (row) return row
      const hit = await this.deps.dav.findById(uid, ref.fileId)
      if (!hit) throw new VaultError(404, 'not-found')
      if (hit.ownerId !== uid) throw new VaultError(404, 'not-enrolled')
      return this.enrol(uid, ref.fileId)
    }
    throw new VaultError(400, 'vaultId or fileId required')
  }

  list(uid: string): { own: VaultRow[]; recent: VaultRow[] } {
    const own = this.deps.db.vaultsOwnedBy(uid)
    const ownIds = new Set(own.map((v) => v.id))
    return { own, recent: this.deps.db.recentFor(uid).filter((v) => !ownIds.has(v.id)) }
  }

  private async readable(uid: string, id: string, opts?: { fresh?: boolean }): Promise<{ row: VaultRow; access: Access }> {
    const row = this.deps.db.getVault(id)
    if (!row) throw new VaultError(404, 'not-found')
    const access = await this.accessToVault(uid, row, opts)
    // The owner always sees their own vault's status — a folder deleted in
    // Files is exactly when they need to read `folder-gone` — but writes
    // nothing through it (`access` stays what Files says).
    if (uid === row.ownerUid) return { row, access }
    // Not readable reads as not found: a vault id says nothing to a stranger.
    if (!access.read) throw new VaultError(404, 'not-found')
    return { row, access }
  }

  private statusOf(row: VaultRow): VaultStatus {
    const s = this.deps.custodians.status(row)
    if (s) return s
    return {
      vault: row,
      custodian: reportedCustodian(row.status),
      ...(row.reason !== undefined ? { reason: row.reason } : {}),
      holds: [],
      files: {},
      peers: 0,
    }
  }

  async status(uid: string, id: string): Promise<VaultStatus> {
    const { row } = await this.readable(uid, id)
    return this.statusOf(row)
  }

  /**
   * DELETE /api/vaults/:id — unenrol. Owner only (by the row, so a folder
   * already deleted in Files can still be let go of); anyone else who can
   * read it gets 403, a stranger 404. Serialized with enrolment.
   */
  remove(uid: string, id: string): Promise<void> {
    const run = this.enrolChain.then(async () => {
      const row = this.deps.db.getVault(id)
      if (!row) throw new VaultError(404, 'not-found')
      if (row.ownerUid !== uid) {
        const access = await this.accessToVault(uid, row).catch(() => null)
        throw access?.read ? new VaultError(403, 'not-owner') : new VaultError(404, 'not-found')
      }
      await this.deps.custodians.remove(row)
    })
    this.enrolChain = run.catch(() => {})
    return run
  }

  async hold(uid: string, id: string, holdId: string, action: HoldAction): Promise<VaultStatus> {
    // Fresh, never the 60 s cache: a hold is acted on by someone whose write
    // may have been taken away a moment ago.
    const { row, access } = await this.readable(uid, id, { fresh: true })
    if (!access.write) throw new VaultError(403, 'read-only')
    await this.deps.custodians.applyHold(row, holdId, action)
    return this.statusOf(this.deps.db.getVault(id) ?? row)
  }
}
