/**
 * The operational surface a container host relies on: GET /healthz (the
 * unauthenticated probe behind the Docker HEALTHCHECK and the reverse proxy)
 * and the online backup behind `cli.ts backup`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RelayDb } from '../src/db.ts'
import { createRelay, type Relay } from '../src/server.ts'

const SECRET = 'operator-secret-for-tests'

describe('relay operations', () => {
  let dir: string
  let relay: Relay

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-ops-test-'))
    relay = createRelay({ dbPath: join(dir, 'relay.db'), operatorSecret: SECRET })
    await relay.listen()
  })

  afterEach(async () => {
    await relay.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (port: number, path: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${port}${path}`)

  it('GET /healthz answers 200 { ok: true } without any credential', async () => {
    const res = await get(relay.port, '/healthz')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    // The app probes it cross-origin before a join or a share (relay-probe.ts).
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /healthz answers 503 once the database stops answering', async () => {
    // destroy() closes it again in afterEach; better-sqlite3's close is idempotent.
    relay.db.close()
    const res = await get(relay.port, '/healthz')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('leaves the admin routes as they were, with and without a secret', async () => {
    expect((await get(relay.port, '/shares')).status).toBe(401)
    const bare = createRelay({ dbPath: join(dir, 'bare.db') })
    await bare.listen()
    try {
      expect((await get(bare.port, '/healthz')).status).toBe(200)
      expect((await get(bare.port, '/shares')).status).toBe(404)
    } finally {
      await bare.destroy()
    }
  })

  it('backs up online from a second connection while the relay serves', async () => {
    relay.db.addShare({ token: 'kept-token', folderGuid: 'fB', label: 'laptop' })
    relay.db.putDocState('fB/d1', new Uint8Array([1, 2, 3]))

    // `cli.ts backup` opens its own connection next to the live relay's.
    const cli = new RelayDb(join(dir, 'relay.db'))
    await cli.backup(join(dir, 'backup.db'))
    cli.close()

    const restored = new RelayDb(join(dir, 'backup.db'))
    try {
      expect(restored.getShare('kept-token')?.folderGuid).toBe('fB')
      expect(restored.getDocState('fB/d1')).toEqual(new Uint8Array([1, 2, 3]))
    } finally {
      restored.close()
    }
    expect((await get(relay.port, '/healthz')).status).toBe(200)
  })
})
