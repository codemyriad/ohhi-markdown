/**
 * Minimal share management — the only mutation path for the shares table
 * (docs/architecture/relay.md: nothing in the CRDT plane can touch it) — plus
 * an online backup of the relay database.
 *
 *   node --experimental-strip-types src/cli.ts share-add <folderGuid> [--read-only] [--label <label>] [--kind folder|device] [--parent <roomGuid>]
 *   node --experimental-strip-types src/cli.ts share-list
 *   node --experimental-strip-types src/cli.ts share-rm <token>
 *   node --experimental-strip-types src/cli.ts backup <destPath>
 *
 * --kind device mints a device token (also reaches rooms carved out of this
 * one); --parent records that <folderGuid> was carved out of <roomGuid>,
 * which is the edge a device token walks (device-link-shaping.md A4-A).
 *
 * `backup` is safe next to the live relay (RelayDb.backup), e.g. from a
 * nightly `docker exec` (apps/relay/README.md).
 *
 * Env: DATA_DIR (default ./data), same as main.ts.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { RelayDb, type ShareKind } from './db.ts'

const USAGE = `usage:
  cli.ts share-add <folderGuid> [--read-only] [--label <label>] [--kind folder|device] [--parent <roomGuid>]
  cli.ts share-list
  cli.ts share-rm <token>
  cli.ts backup <destPath>`

function openDb(): RelayDb {
  const dataDir = process.env.DATA_DIR ?? './data'
  mkdirSync(dataDir, { recursive: true })
  return new RelayDb(join(dataDir, 'relay.db'))
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)

switch (cmd) {
  case 'share-add': {
    let folderGuid: string | undefined
    let readOnly = false
    let label: string | null = null
    let kind: ShareKind = 'folder'
    let parent: string | null = null
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]
      if (arg === '--read-only') readOnly = true
      else if (arg === '--label') label = rest[++i] ?? null
      else if (arg === '--kind') {
        const value = rest[++i]
        if (value !== 'folder' && value !== 'device') fail('--kind must be folder or device')
        kind = value
      } else if (arg === '--parent') {
        const value = rest[++i]?.trim()
        if (!value) fail('--parent needs a room guid')
        parent = value
      } else if (!folderGuid) folderGuid = arg
      else fail(USAGE)
    }
    if (!folderGuid) fail(USAGE)
    if (parent && kind === 'device') {
      fail('a device token is minted for a root room, never for a child (--parent)')
    }
    if (parent === folderGuid) fail('--parent must differ from <folderGuid>')
    const token = randomBytes(32).toString('hex')
    const db = openDb()
    db.addShare({ token, folderGuid, readOnly, label, kind })
    if (parent) db.setRoomParent(folderGuid, parent)
    db.close()
    console.log(token)
    break
  }
  case 'share-list': {
    const db = openDb()
    for (const s of db.listShares()) {
      console.log(
        [
          s.token,
          s.folderGuid,
          s.kind,
          s.readOnly ? 'read-only' : 'read-write',
          s.createdAt,
          s.label ?? '',
        ]
          .join('\t')
          .trimEnd(),
      )
    }
    db.close()
    break
  }
  case 'share-rm': {
    const token = rest[0]
    if (!token) fail(USAGE)
    const db = openDb()
    const removed = db.removeShare(token)
    db.close()
    if (!removed) fail(`no share with token: ${token}`)
    console.log('removed')
    break
  }
  case 'backup': {
    const dest = rest[0]
    if (!dest || rest.length > 1) fail(USAGE)
    mkdirSync(dirname(dest), { recursive: true })
    // Written beside the destination, then renamed: an interrupted backup
    // never leaves a truncated file under a name that looks complete.
    const partial = `${dest}.partial`
    const db = openDb()
    try {
      await db.backup(partial)
    } catch (err) {
      db.close()
      rmSync(partial, { force: true }) // the cron's prune never matches *.partial
      fail(`backup failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    db.close()
    renameSync(partial, dest)
    console.log(dest)
    break
  }
  default:
    fail(USAGE)
}
