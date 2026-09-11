// Spawns the relay with a fresh temp database and a deterministic e2e share.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const relayDir = join(fileURLToPath(new URL('.', import.meta.url)), '../../relay')
const dataDir = mkdtempSync(join(tmpdir(), 'editor-relay-e2e-'))

const child = spawn('node', ['--experimental-strip-types', 'src/main.ts'], {
  cwd: relayDir,
  env: {
    ...process.env,
    PORT: '8799',
    DATA_DIR: dataDir,
    // e2eroom: the collab smoke. chrome-tree: chrome.spec's tree test, which
    // needs an AUTHORISED room to show a green note (the other memory rooms
    // are rejected by design and stay offline). panes-sync: the two-panes
    // golden-rule-4 leg, which has to see a real green before it severs the
    // relay and watches both pills go honest.
    SEED_SHARE: 'e2eroom:e2e-token,chrome-tree:chrome-token,panes-sync:panes-token',
  },
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
