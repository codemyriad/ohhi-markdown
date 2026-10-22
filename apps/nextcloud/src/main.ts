/**
 * The ExApp process entry (bundled to dist/server.mjs). One process, one port:
 * the relay (Hocuspocus) listens on APP_HOST:APP_PORT, takes the `/ws`
 * upgrades itself and hands every other request to the router — the AppAPI
 * lifecycle, the shell, the JSON API (the core routes, the vault routes) and
 * the `501` fallback for a declared route nothing registered.
 *
 * Custodians start after the listen: at once for the rows a restart finds
 * (AppAPI does not re-send `PUT /enabled` after a container restart), and
 * again on every `enabled=1` (a fresh register: until AppAPI enables the
 * app, Nextcloud refuses its calls, and those rows wait). `enabled=0` stops
 * them. SIGTERM/SIGINT flush the custodians and destroy the relay.
 */
import { RealClock } from './clock.js'
import { createService } from './compose.js'
import { registerCore } from './handlers-core.js'
import { registerVaults } from './handlers-vaults.js'
import { addFallbacks, createRouter, handleRequest } from './http.js'
import { readEnv } from './types.js'

const log = (line: string): void => console.log(`[ohhi] ${line}`)

const env = readEnv()
const clock = new RealClock()
const router = createRouter()
const service = createService({ env, clock, log, debug: env.logLevel === 'debug' })

registerCore(router, {
  env,
  clock,
  instance: service.instance,
  vaultCount: () => service.db.allVaults().length,
  onEnabled: (enabled) => {
    const run = enabled ? service.startCustodians() : service.stopCustodians()
    void run.catch((err: unknown) => log(`custodians ${enabled ? 'start' : 'stop'} failed (${(err as Error).name})`))
  },
})
registerVaults(router, service.vaultDeps)

addFallbacks(router)

await service.start((req, res) => handleRequest(router, req, res), { custodians: false })
log(`${env.appId} ${env.appVersion} listening on ${env.appHost}:${service.relay.port} (http + /ws)`)
void service.startCustodians().catch((err: unknown) => log(`custodians start failed (${(err as Error).name})`))

let stopping = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (stopping) return
    stopping = true
    log(`${signal}: stopping`)
    service
      .stop()
      .then(() => process.exit(0))
      .catch((err: unknown) => {
        log(`stop failed (${(err as Error).name})`)
        process.exit(1)
      })
  })
}
