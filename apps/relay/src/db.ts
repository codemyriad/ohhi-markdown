/**
 * SQLite storage for the relay: the relay-authoritative `shares` table
 * (static per-share bearer tokens — docs/architecture/relay.md, "Auth and
 * the share lifecycle") and the `docs` table (stock doc-state persistence:
 * one opaque Yjs state blob per doc; the append-only update log is V2).
 * WAL mode so the single connection survives reader/writer interleaving.
 */
import Database from 'better-sqlite3'

export interface Share {
  token: string
  folderGuid: string
  readOnly: boolean
  label: string | null
  createdAt: string
}

interface ShareRow {
  token: string
  folder_guid: string
  read_only: number
  label: string | null
  created_at: string
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    folder_guid TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS docs (
    name TEXT PRIMARY KEY,
    state BLOB NOT NULL,
    updated_at TEXT
  );
`

export class RelayDb {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  addShare(share: {
    token: string
    folderGuid: string
    readOnly?: boolean
    label?: string | null
  }): void {
    this.db
      .prepare(
        'INSERT INTO shares (token, folder_guid, read_only, label, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        share.token,
        share.folderGuid,
        share.readOnly ? 1 : 0,
        share.label ?? null,
        new Date().toISOString(),
      )
  }

  getShare(token: string): Share | null {
    const row = this.db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as
      | ShareRow
      | undefined
    return row ? toShare(row) : null
  }

  listShares(): Share[] {
    const rows = this.db
      .prepare('SELECT * FROM shares ORDER BY created_at')
      .all() as ShareRow[]
    return rows.map(toShare)
  }

  /** Returns true when a share was actually deleted. */
  removeShare(token: string): boolean {
    return this.db.prepare('DELETE FROM shares WHERE token = ?').run(token).changes > 0
  }

  getDocState(name: string): Uint8Array | null {
    const row = this.db.prepare('SELECT state FROM docs WHERE name = ?').get(name) as
      | { state: Buffer }
      | undefined
    return row ? new Uint8Array(row.state) : null
  }

  putDocState(name: string, state: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO docs (name, state, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
      )
      .run(
        name,
        Buffer.from(state.buffer, state.byteOffset, state.byteLength),
        new Date().toISOString(),
      )
  }

  close(): void {
    this.db.close()
  }
}

function toShare(row: ShareRow): Share {
  return {
    token: row.token,
    folderGuid: row.folder_guid,
    readOnly: row.read_only !== 0,
    label: row.label,
    createdAt: row.created_at,
  }
}
