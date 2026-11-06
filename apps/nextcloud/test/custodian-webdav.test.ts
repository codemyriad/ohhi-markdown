/**
 * The custodian over `@ohhi/vault`'s WebDavVaultAdapter and the testkit
 * WebDAV fake: the marker is a real `If-None-Match`/`If-Match` lease, an
 * external PUT is ingested, and a 423 on a write surfaces as `blocked`.
 */
import { join } from 'node:path'
import type { Relay } from '@ohhi/relay'
import { createWebDavFake, RealClock } from '@ohhi/testkit'
import {
  formatHostMarker,
  MemStoreDir,
  OHHI_HOST_MARKER,
  parseHostMarker,
  WebDavVaultAdapter,
  type VaultAdapter,
} from '@ohhi/vault'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Custodian } from '../src/custodian.js'
import { relayWithDeviceToken, tempDir, until, vaultRow } from './fixtures.js'

type Fake = Awaited<ReturnType<typeof createWebDavFake>>
const dec = new TextDecoder()

describe('custodian over WebDAV', () => {
  let dir: ReturnType<typeof tempDir>
  let relay: Relay
  let fake: Fake
  let custodian: Custodian | null = null
  const clock = new RealClock()
  const DEVICE = 'device-token'

  beforeEach(async () => {
    dir = tempDir('webdav')
    fake = await createWebDavFake({ owner: 'alice' })
    fake.mkdir('Notes')
    fake.put('Notes/a.md', 'alpha\n')
    relay = await relayWithDeviceToken({ dbPath: join(dir.path, 'relay.db'), clock, token: DEVICE, vaultIdForRoom: () => 'vault-1' })
  })
  afterEach(async () => {
    await custodian?.stop()
    custodian = null
    await relay.destroy()
    await fake.close()
    dir.remove()
  })

  function start(over: { heartbeatMs?: number } = {}): Custodian {
    const row = vaultRow({ id: 'vault-1' })
    const adapter = new WebDavVaultAdapter({
      baseUrl: `${fake.url}Notes/`,
      headers: () => ({}),
      clock,
      owner: 'alice',
      pollMs: { active: 50, idle: 50 },
    }) as VaultAdapter
    custodian = new Custodian({
      row,
      mode: 'enrol',
      clock,
      instance: 'inst-A',
      storeDir: new MemStoreDir(),
      adapter,
      relay: { url: `ws://127.0.0.1:${relay.port}`, token: DEVICE },
      webSocketPolyfill: globalThis.WebSocket,
      setStatus: () => {},
      log: () => {},
      retryBackoffMs: [100],
      ...over,
    })
    return custodian
  }

  it('enrols over WebDAV with the marker written by If-None-Match, and ingests an external PUT', async () => {
    const c = start()
    expect(await c.start()).toBe(true)
    await c.ready
    expect(c.state).toBe('running')
    const marker = fake.files.get(`Notes/${OHHI_HOST_MARKER}`)
    expect(parseHostMarker(marker!.bytes)).toMatchObject({ vault: 'vault-1', instance: 'inst-A', epoch: 1 })
    expect(c.session!.files().map((f) => f.path)).toEqual(['a.md'])
    expect(fake.requests.some((r) => r.method === 'PUT' && r.path === `Notes/${OHHI_HOST_MARKER}`)).toBe(true)

    fake.put('Notes/a.md', 'alpha from Files\n') // the desktop client / a curl PUT
    await until(() => c.session!.docForPath('a.md')?.getText() === 'alpha from Files\n', 'external PUT ingested')
  })

  it('a marker re-written by another instance loses the lease (If-Match 412)', async () => {
    const c = start({ heartbeatMs: 100 })
    await c.start()
    await c.ready
    fake.put(
      `Notes/${OHHI_HOST_MARKER}`,
      formatHostMarker({ room: 'x', vault: 'vault-1', epoch: 1, instance: 'inst-B', heartbeat: new Date().toISOString() })
    )
    await until(() => c.state === 'lease-lost', 'lease lost')
    expect(dec.decode(fake.files.get(`Notes/${OHHI_HOST_MARKER}`)!.bytes)).toContain('instance: inst-B')
  })

  it('a locked file (423) is blocked, then match once the lock clears', async () => {
    const c = start()
    await c.start()
    await c.ready
    const guid = c.session!.files()[0]!.guid
    fake.failNext('PUT', 423, { path: 'Notes/a.md', times: 1 })
    c.session!.docForPath('a.md')!.transact((t) => t.insert(0, 'edited '), 'local')
    await until(() => c.status(0).files[guid] === 'blocked', 'blocked', 10_000)
    await until(() => c.status(0).files[guid] === 'match', 'retried', 10_000)
    expect(dec.decode(fake.files.get('Notes/a.md')!.bytes)).toBe('edited alpha\n')
  })
})
