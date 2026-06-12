/**
 * Relay entry point. Env: PORT (default 8787), DATA_DIR (default ./data).
 * Run: node --experimental-strip-types src/main.ts  (rushx dev)
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRelay } from './server.ts'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.DATA_DIR ?? './data'
const dbPath = join(dataDir, 'relay.db')

mkdirSync(dataDir, { recursive: true })

const relay = createRelay({ dbPath, port })

// Dev/e2e convenience: SEED_SHARE="<folderGuid>:<token>" pre-creates a share
// idempotently. Never set this in production.
if (process.env.SEED_SHARE) {
  const [folderGuid, token] = process.env.SEED_SHARE.split(':')
  if (!folderGuid || !token) throw new Error('SEED_SHARE must be "<folderGuid>:<token>"')
  if (!relay.db.getShare(token)) {
    relay.db.addShare({ token, folderGuid, label: 'seeded (SEED_SHARE)' })
    console.log(`seeded share for folder ${folderGuid}`)
  }
}

await relay.listen()
console.log(`@editor/relay listening on ws://0.0.0.0:${relay.port} (db: ${dbPath})`)

// Flush pending doc stores before exiting (Fly sends SIGINT on deploy/stop).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void relay.destroy().then(() => process.exit(0))
  })
}
