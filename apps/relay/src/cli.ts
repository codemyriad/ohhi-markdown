/**
 * Minimal share management — the only mutation path for the shares table
 * (docs/architecture/relay.md: nothing in the CRDT plane can touch it).
 *
 *   node --experimental-strip-types src/cli.ts share-add <folderGuid> [--read-only] [--label <label>]
 *   node --experimental-strip-types src/cli.ts share-list
 *   node --experimental-strip-types src/cli.ts share-rm <token>
 *
 * Env: DATA_DIR (default ./data), same as main.ts.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { RelayDb } from './db.ts'

const USAGE = `usage:
  cli.ts share-add <folderGuid> [--read-only] [--label <label>]
  cli.ts share-list
  cli.ts share-rm <token>`

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
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]
      if (arg === '--read-only') readOnly = true
      else if (arg === '--label') label = rest[++i] ?? null
      else if (!folderGuid) folderGuid = arg
      else fail(USAGE)
    }
    if (!folderGuid) fail(USAGE)
    const token = randomBytes(32).toString('hex')
    const db = openDb()
    db.addShare({ token, folderGuid, readOnly, label })
    db.close()
    console.log(token)
    break
  }
  case 'share-list': {
    const db = openDb()
    for (const s of db.listShares()) {
      console.log(
        [s.token, s.folderGuid, s.readOnly ? 'read-only' : 'read-write', s.createdAt, s.label ?? '']
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
  default:
    fail(USAGE)
}
