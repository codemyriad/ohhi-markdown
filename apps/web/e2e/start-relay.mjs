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
    // relay and watches both pills go honest. quiet-sync: the same leg in the
    // default layout, where an UNFOCUSED pane carries its own sync dot.
    // shared-a / shared-cs: shared.spec — A's own vault, and the room B seeds
    // that A adds as a shared folder (the Shared view's cards, sharing E2).
    // fonts-build / fonts-dev: fonts.spec, which asserts ZERO console errors
    // on load — an unauthorised room logs the relay's refusal as one.
    // join-page: join.spec — a room seeded by one context and joined from
    // the /join page by another (first-run C2).
    SEED_SHARE:
      'e2eroom:e2e-token,chrome-tree:chrome-token,panes-sync:panes-token,quiet-sync:quiet-token,shared-a:shared-a-token,shared-cs:shared-cs-token,fonts-build:fonts-build-token,fonts-dev:fonts-dev-token,join-page:join-token',
  },
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill())
}
