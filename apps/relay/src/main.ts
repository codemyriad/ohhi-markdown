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

// OPERATOR_SECRET enables the admin HTTP API (in-app share minting — M4).
// Unset, the /shares routes answer 404 and the CLI is the only mutation path.
const relay = createRelay({ dbPath, port, operatorSecret: process.env.OPERATOR_SECRET })

// Dev/e2e convenience: SEED_SHARE="<folderGuid>:<token>[,<folderGuid>:<token>…]"
// pre-creates shares idempotently. Never set this in production.
if (process.env.SEED_SHARE) {
  for (const pair of process.env.SEED_SHARE.split(',')) {
    const [folderGuid, token] = pair.trim().split(':')
    if (!folderGuid || !token) {
      throw new Error('SEED_SHARE must be "<folderGuid>:<token>" pairs, comma-separated')
    }
    if (!relay.db.getShare(token)) {
      relay.db.addShare({ token, folderGuid, label: 'seeded (SEED_SHARE)' })
      console.log(`seeded share for folder ${folderGuid}`)
    }
  }
}

await relay.listen()
console.log(`@editor/relay listening on ws://0.0.0.0:${relay.port} (db: ${dbPath})`)

// Flush pending doc stores before exiting (`docker stop` sends SIGTERM,
// Ctrl-C SIGINT). In the container node runs as PID 1, which gets no default
// signal actions, so these handlers are the only thing that makes a stop a
// clean exit rather than a SIGKILL once the grace period runs out.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void relay.destroy().then(() => process.exit(0))
  })
}
