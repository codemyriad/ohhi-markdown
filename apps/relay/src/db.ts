/**
 * SQLite storage for the relay: the relay-authoritative `shares` table
 * (static per-share bearer tokens — docs/architecture/relay.md, "Auth and
 * the share lifecycle"), the `rooms` ancestry table (which room was carved
 * out of which — device-link-shaping.md A4-A), and the `docs` table (stock
 * doc-state persistence: one opaque Yjs state blob per doc; the append-only
 * update log is V2).
 * WAL mode so the single connection survives reader/writer interleaving.
 */
import Database from 'better-sqlite3'

/**
 * `folder` — the M4 share token: exact-room match, never grants the vault.
 * `device` — one person's own device (device-link-shaping.md R5): grants the
 * token's room and every room carved out of it (see `ancestorsOf`).
 */
export type ShareKind = 'folder' | 'device'

export interface Share {
  token: string
  folderGuid: string
  readOnly: boolean
  label: string | null
  createdAt: string
  kind: ShareKind
}

interface ShareRow {
  token: string
  folder_guid: string
  read_only: number
  label: string | null
  created_at: string
  kind: string | null
}

/** Bounds the ancestry walk in onAuthenticate — depth 1 is all N1 creates. */
export const MAX_ANCESTRY_HOPS = 8

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS shares (
    token TEXT PRIMARY KEY,
    folder_guid TEXT NOT NULL,
    read_only INTEGER NOT NULL DEFAULT 0,
    label TEXT,
    created_at TEXT,
    kind TEXT NOT NULL DEFAULT 'folder'
  );
  CREATE TABLE IF NOT EXISTS rooms (
    child_guid TEXT PRIMARY KEY,
    parent_guid TEXT NOT NULL
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
    this.migrate()
  }

  /**
   * Additive migrations for databases created by an earlier build (the
   * dogfood relay's volume is one of them): `CREATE TABLE IF NOT EXISTS`
   * leaves an existing `shares` alone, so a missing column is added here.
   * Every migration must be idempotent and must not rewrite existing rows.
   */
  private migrate(): void {
    const columns = this.db.prepare('PRAGMA table_info(shares)').all() as { name: string }[]
    if (!columns.some((c) => c.name === 'kind')) {
      this.db.exec("ALTER TABLE shares ADD COLUMN kind TEXT NOT NULL DEFAULT 'folder'")
    }
  }

  addShare(share: {
    token: string
    folderGuid: string
    readOnly?: boolean
    label?: string | null
    kind?: ShareKind
  }): void {
    this.db
      .prepare(
        'INSERT INTO shares (token, folder_guid, read_only, label, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        share.token,
        share.folderGuid,
        share.readOnly ? 1 : 0,
        share.label ?? null,
        new Date().toISOString(),
        share.kind ?? 'folder',
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

  // ---- room ancestry (device-link-shaping.md A4-A) ----

  /**
   * Record that `child` was carved out of `parent`. **Write-once.** Idempotent
   * for the same parent (a re-share after a revoke restates nothing and
   * fails nothing), and a *different* parent is IGNORED here rather than
   * overwritten: re-pointing an existing edge would re-parent a room under
   * whoever minted last, and on a multi-vault relay behind one operator
   * secret that hands the new parent's device tokens a victim vault's rooms.
   * The mint refuses that case with a 409 before it ever gets here
   * (`admin.ts`); this clause is the second half of the same rule, so no
   * other caller can re-point an edge either.
   *
   * Ancestry is advisory *structure*, never a credential — only `shares`
   * grants access. Returns true when the edge was written (or already read
   * exactly this way), false when a different parent is on record.
   */
  setRoomParent(child: string, parent: string): boolean {
    this.db
      .prepare(
        `INSERT INTO rooms (child_guid, parent_guid) VALUES (?, ?)
         ON CONFLICT(child_guid) DO NOTHING`,
      )
      .run(child, parent)
    return this.getRoomParent(child) === parent
  }

  getRoomParent(child: string): string | null {
    const row = this.db.prepare('SELECT parent_guid FROM rooms WHERE child_guid = ?').get(child) as
      | { parent_guid: string }
      | undefined
    return row?.parent_guid ?? null
  }

  /**
   * The ancestry chain of `room`, nearest parent first. Bounded at
   * MAX_ANCESTRY_HOPS and cycle-guarded: a corrupt/malicious edge set can
   * cost at most a fixed number of indexed lookups per authentication.
   */
  ancestorsOf(room: string, maxHops: number = MAX_ANCESTRY_HOPS): string[] {
    const chain: string[] = []
    const seen = new Set<string>([room])
    let current = room
    for (let hop = 0; hop < maxHops; hop++) {
      const parent = this.getRoomParent(current)
      if (parent === null || seen.has(parent)) break
      chain.push(parent)
      seen.add(parent)
      current = parent
    }
    return chain
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

  /**
   * Readiness probe for GET /healthz: a real read transaction on the schema
   * (a bare `SELECT 1` never touches the file). Throws when the connection is
   * closed or the database cannot be read.
   */
  ping(): void {
    this.db.prepare('SELECT 1 FROM shares LIMIT 1').get()
  }

  /**
   * Online backup via SQLite's backup API — safe while the relay serves from
   * the same file (a write from another connection restarts the copy, so the
   * result is always one consistent snapshot). After the first step sizes the
   * source, every remaining page is copied in one step, so a busy relay
   * cannot keep restarting a paged copy.
   */
  async backup(destPath: string): Promise<void> {
    await this.db.backup(destPath, { progress: ({ remainingPages }) => remainingPages })
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
    // Rows written before the kind column existed read as NULL → 'folder'.
    kind: row.kind === 'device' ? 'device' : 'folder',
  }
}
