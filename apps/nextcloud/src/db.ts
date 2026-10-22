/**
 * The ExApp's own SQLite (nextcloud-build decision 3): server-owned vault
 * rows, the per-user "recent" list and the instance id. Lives at
 * `<APP_PERSISTENT_STORAGE>/ohhi.db` in WAL mode, next to — never inside —
 * the relay's database. Rows are made here, never from a client's path or
 * room: routes take a vault id or a Nextcloud file id and resolve from this.
 */
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { VAULT_STATUSES, type VaultRow } from './types.js'

export type VaultStatusValue = VaultRow['status']

interface VaultDbRow {
  id: string
  file_id: number
  owner_uid: string
  owner_path: string
  room: string
  epoch: number
  created_at: string
  status: string
  reason: string | null
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vaults (
    id TEXT PRIMARY KEY,
    file_id INTEGER NOT NULL UNIQUE,
    owner_uid TEXT NOT NULL,
    owner_path TEXT NOT NULL,
    room TEXT NOT NULL UNIQUE,
    epoch INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    reason TEXT
  );
  CREATE INDEX IF NOT EXISTS vaults_owner ON vaults(owner_uid);
  CREATE TABLE IF NOT EXISTS vault_access (
    vault_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    last_opened_at INTEGER NOT NULL,
    PRIMARY KEY (vault_id, uid)
  );
  CREATE TABLE IF NOT EXISTS instance (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`

const STATUSES: ReadonlySet<string> = new Set(VAULT_STATUSES)

function toRow(r: VaultDbRow): VaultRow {
  return {
    id: r.id,
    fileId: r.file_id,
    ownerUid: r.owner_uid,
    ownerPath: r.owner_path,
    room: r.room,
    epoch: r.epoch,
    createdAt: r.created_at,
    status: (STATUSES.has(r.status) ? r.status : 'needs-operator') as VaultStatusValue,
    ...(r.reason ? { reason: r.reason } : {}),
  }
}

export class OhhiDb {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
    // Volumes made before the column existed (`CREATE TABLE IF NOT EXISTS` adds none).
    const columns = this.db.prepare('PRAGMA table_info(vaults)').all() as { name: string }[]
    if (!columns.some((c) => c.name === 'reason')) this.db.exec('ALTER TABLE vaults ADD COLUMN reason TEXT')
  }

  /** This installation's id, generated once and kept: the marker's `instance`. */
  instanceId(): string {
    const row = this.db.prepare("SELECT value FROM instance WHERE key = 'id'").get() as { value: string } | undefined
    if (row) return row.value
    const id = randomUUID()
    this.db.prepare("INSERT OR IGNORE INTO instance (key, value) VALUES ('id', ?)").run(id)
    return (this.db.prepare("SELECT value FROM instance WHERE key = 'id'").get() as { value: string }).value
  }

  /** Throws on a duplicate file id or room (the UNIQUE constraints are the race guard). */
  insertVault(row: VaultRow): void {
    this.db
      .prepare(
        'INSERT INTO vaults (id, file_id, owner_uid, owner_path, room, epoch, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(row.id, row.fileId, row.ownerUid, row.ownerPath, row.room, row.epoch, row.createdAt, row.status)
  }

  getVault(id: string): VaultRow | null {
    const r = this.db.prepare('SELECT * FROM vaults WHERE id = ?').get(id) as VaultDbRow | undefined
    return r ? toRow(r) : null
  }

  vaultByFileId(fileId: number): VaultRow | null {
    const r = this.db.prepare('SELECT * FROM vaults WHERE file_id = ?').get(fileId) as VaultDbRow | undefined
    return r ? toRow(r) : null
  }

  vaultByRoom(room: string): VaultRow | null {
    const r = this.db.prepare('SELECT * FROM vaults WHERE room = ?').get(room) as VaultDbRow | undefined
    return r ? toRow(r) : null
  }

  vaultsOwnedBy(uid: string): VaultRow[] {
    return (this.db.prepare('SELECT * FROM vaults WHERE owner_uid = ? ORDER BY created_at').all(uid) as VaultDbRow[]).map(
      toRow
    )
  }

  allVaults(): VaultRow[] {
    return (this.db.prepare('SELECT * FROM vaults ORDER BY created_at').all() as VaultDbRow[]).map(toRow)
  }

  /** The row's status and its machine reason (`folder-gone`); a status set without one clears it. */
  setStatus(id: string, status: VaultStatusValue, reason: string | null = null): void {
    this.db.prepare('UPDATE vaults SET status = ?, reason = ? WHERE id = ?').run(status, reason, id)
  }

  /** The owner's rows that count toward the per-user cap: only `active` ones (a gone or stuck row does not hold a slot). */
  activeVaultsOwnedBy(uid: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM vaults WHERE owner_uid = ? AND status = 'active'").get(uid) as { n: number }).n
  }

  /** The owner moved or renamed the folder: the row follows (the file id is the identity). */
  setOwnerPath(id: string, ownerPath: string): void {
    this.db.prepare('UPDATE vaults SET owner_path = ? WHERE id = ?').run(ownerPath, id)
  }

  /** A row gone — an enrolment that never started, or an unenrolled vault — with its access rows. */
  deleteVault(id: string): void {
    this.db.prepare('DELETE FROM vault_access WHERE vault_id = ?').run(id)
    this.db.prepare('DELETE FROM vaults WHERE id = ?').run(id)
  }

  recordAccess(vaultId: string, uid: string, at: number): void {
    this.db
      .prepare(
        `INSERT INTO vault_access (vault_id, uid, last_opened_at) VALUES (?, ?, ?)
         ON CONFLICT(vault_id, uid) DO UPDATE SET last_opened_at = excluded.last_opened_at`
      )
      .run(vaultId, uid, at)
  }

  /** Vaults this uid opened before, most recent first. */
  recentFor(uid: string, limit = 50): VaultRow[] {
    return (
      this.db
        .prepare(
          `SELECT v.* FROM vault_access a JOIN vaults v ON v.id = a.vault_id
           WHERE a.uid = ? ORDER BY a.last_opened_at DESC LIMIT ?`
        )
        .all(uid, limit) as VaultDbRow[]
    ).map(toRow)
  }

  close(): void {
    this.db.close()
  }
}
