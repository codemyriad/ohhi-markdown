/**
 * Enrolment refusals (decision 3) and the composed service end to end: the
 * routes over the one relay port, a session token opening the room, the
 * holds route, and the disk watermark (decisions 4, 7, 14, 17).
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { formatHostMarker, MemStoreDir, MemVaultAdapter, WebDavVaultAdapter } from '@ohhi/vault'
import { createWebDavFake, RealClock, SimClock } from '@ohhi/testkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createService, type Service } from '../src/compose.js'
import { OhhiDb } from '../src/db.js'
import { registerVaults } from '../src/handlers-vaults.js'
import { addFallbacks, createRouter, handleRequest } from '../src/http.js'
import { createPermissions, NcDav } from '../src/permissions.js'
import type { Env, VaultRow } from '../src/types.js'
import { VaultService, type CustodianHost } from '../src/vaults.js'
import { authHeader, connectPeer, SECRET, startFakeNextcloud, tempDir, until, vaultRow, type FakeNextcloud, type FakeNode } from './fixtures.js'

const RW = 'RGDNVCK'

function aliceTree(): FakeNode[] {
  const d = (path: string, fileId: number, extra: Partial<FakeNode> = {}): FakeNode => ({
    path,
    fileId,
    dir: true,
    owner: 'alice',
    permissions: RW,
    ...extra,
  })
  const f = (path: string, fileId: number, bytes = 'x', extra: Partial<FakeNode> = {}): FakeNode => ({
    path,
    fileId,
    dir: false,
    owner: 'alice',
    permissions: 'RGDNVW',
    bytes,
    ...extra,
  })
  return [
    d('', 1),
    d('Notes', 10),
    f('Notes/a.md', 11, 'alpha\n'),
    d('Notes/sub', 12),
    d('Outer', 20),
    d('Outer/Inner', 21),
    f('Outer/Inner/x.md', 22),
    d('Mixed', 30),
    d('Mixed/shared', 31, { owner: 'bob', mountType: 'shared', permissions: 'SGD' }),
    d('Marked', 40),
    f('Marked/ohhi-host.md', 41, new TextDecoder().decode(formatHostMarker({ room: 'r', vault: 'v', epoch: 1, instance: 'i', heartbeat: '' }))),
    f('file.md', 50),
    d('More1', 60),
    d('More2', 61),
    d('Unsaid', 70),
    d('Unsaid/mount', 71, { owner: '' }),
  ]
}

function env(nc: FakeNextcloud, persist: string): Env {
  return {
    appId: 'ohhi',
    appSecret: SECRET,
    appPort: 0,
    appHost: '127.0.0.1',
    appVersion: '0.1.0',
    aaVersion: '5',
    nextcloudUrl: nc.url,
    publicOrigins: [],
    persistentStorage: persist,
    logLevel: 'info',
  }
}

describe('enrolment refusals', () => {
  let nc: FakeNextcloud
  let dir: ReturnType<typeof tempDir>
  let db: OhhiDb
  const started: string[] = []
  const removed: string[] = []
  let refuse = false

  beforeEach(async () => {
    nc = await startFakeNextcloud()
    nc.trees.set('alice', aliceTree())
    nc.trees.set('bob', [
      { path: '', fileId: 2, dir: true, owner: 'bob', permissions: RW },
      { path: 'Notes', fileId: 10, dir: true, owner: 'alice', permissions: 'SGD', mountType: 'shared' },
    ])
    dir = tempDir('vaults')
    db = new OhhiDb(`${dir.path}/ohhi.db`)
    started.length = 0
    removed.length = 0
    refuse = false
  })
  afterEach(async () => {
    db.close()
    await nc.close()
    dir.remove()
  })

  function service(max?: number): VaultService {
    const clock = new SimClock()
    const dav = new NcDav({ env: env(nc, dir.path), clock })
    const host: CustodianHost = {
      enrol: async (row) => {
        started.push(row.ownerPath)
        return !refuse
      },
      status: () => null,
      applyHold: async () => {},
      remove: async (row) => {
        removed.push(row.id)
        db.deleteVault(row.id)
      },
    }
    return new VaultService({ db, dav, permissions: createPermissions({ dav, clock }), clock, custodians: host, ...(max ? { maxVaultsPerUser: max } : {}) })
  }

  it('enrols an owned folder once (uuid id and room, epoch 1) and starts its custodian', async () => {
    const v = service()
    const row = await v.enrol('alice', 10)
    expect(row).toMatchObject({ fileId: 10, ownerUid: 'alice', ownerPath: 'Notes', epoch: 1, status: 'active' })
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.room).toMatch(/^[0-9a-f-]{36}$/)
    expect(row.room).not.toBe(row.id)
    expect(await v.enrol('alice', 10)).toEqual(row) // idempotent
    expect(started).toEqual(['Notes'])
    expect(v.list('alice').own).toEqual([row])
  })

  it('refuses what decision 3 refuses', async () => {
    const v = service()
    await v.enrol('alice', 10)
    await v.enrol('alice', 21)
    const reason = (p: Promise<unknown>) => p.then(() => 'ok', (e: { status: number; reason: string }) => `${e.status} ${e.reason}`)
    expect(await reason(v.enrol('bob', 10))).toBe('403 not-owner')
    expect(await reason(v.enrol('alice', 12))).toBe('409 nested-vault') // inside Notes
    expect(await reason(v.enrol('alice', 20))).toBe('409 nested-vault') // contains Outer/Inner
    expect(await reason(v.enrol('alice', 30))).toBe('409 foreign-content')
    expect(await reason(v.enrol('alice', 70))).toBe('409 foreign-content') // an absent owner-id is foreign (R1 #14)
    expect(await reason(v.enrol('alice', 40))).toBe('409 marked-for-another-room')
    expect(await reason(v.enrol('alice', 50))).toBe('409 not-a-folder')
    expect(await reason(v.enrol('alice', 1))).toBe('409 home-folder')
    expect(await reason(v.enrol('alice', 999))).toBe('404 not-found')
    expect(db.vaultsOwnedBy('alice')).toHaveLength(2)
  })

  it('refuses past the per-user cap, and rolls back a row whose custodian refused', async () => {
    const v = service(2)
    await v.enrol('alice', 10)
    await v.enrol('alice', 60)
    await expect(v.enrol('alice', 61)).rejects.toMatchObject({ status: 409, reason: 'too-many-vaults' })
    const w = service()
    refuse = true
    db.deleteVault(db.vaultByFileId(60)!.id)
    await expect(w.enrol('alice', 60)).rejects.toMatchObject({ status: 409, reason: 'custodian-refused' })
    expect(db.vaultByFileId(60)).toBeNull()
  })

  it('only active rows count toward the per-user cap (a folder-gone row frees its slot)', async () => {
    const v = service(2)
    await v.enrol('alice', 10)
    const second = await v.enrol('alice', 60)
    await expect(v.enrol('alice', 61)).rejects.toMatchObject({ reason: 'too-many-vaults' })
    db.setStatus(second.id, 'needs-operator', 'folder-gone')
    expect(db.getVault(second.id)).toMatchObject({ status: 'needs-operator', reason: 'folder-gone' })
    expect((await v.enrol('alice', 61)).fileId).toBe(61)
    db.setStatus(second.id, 'active')
    expect(db.getVault(second.id)).not.toHaveProperty('reason')
  })

  it("unenrol is the owner's: a reader gets 403, a stranger and an unknown id 404", async () => {
    const v = service()
    const row = await v.enrol('alice', 10)
    nc.trees.set('carol', [{ path: '', fileId: 3, dir: true, owner: 'carol', permissions: RW }])
    await expect(v.remove('bob', row.id)).rejects.toMatchObject({ status: 403, reason: 'not-owner' })
    await expect(v.remove('carol', row.id)).rejects.toMatchObject({ status: 404 })
    await expect(v.remove('alice', '00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({ status: 404 })
    expect(removed).toEqual([])
    await v.remove('alice', row.id)
    expect(removed).toEqual([row.id])
    expect(db.getVault(row.id)).toBeNull()
    // The folder can be enrolled again (a new vault: new id, new room).
    const again = await v.enrol('alice', 10)
    expect(again.id).not.toBe(row.id)
    expect(again.room).not.toBe(row.room)
  })

  it('the owner reads the status of a vault whose folder is gone; nobody else does', async () => {
    const v = service()
    const row = await v.enrol('alice', 10)
    db.setStatus(row.id, 'needs-operator', 'folder-gone')
    nc.trees.set('alice', aliceTree().filter((n) => !n.path.startsWith('Notes')))
    nc.trees.set('bob', [{ path: '', fileId: 2, dir: true, owner: 'bob', permissions: RW }])
    expect(await v.status('alice', row.id)).toMatchObject({ custodian: 'needs-operator', reason: 'folder-gone' })
    await expect(v.status('bob', row.id)).rejects.toMatchObject({ status: 404 })
  })

  it('a recipient opens an enrolled vault by its file id; an unenrolled one is not enrolled for them', async () => {
    const v = service()
    await expect(v.resolve('bob', { fileId: 10 })).rejects.toMatchObject({ status: 404, reason: 'not-enrolled' })
    const row = await v.enrol('alice', 10)
    expect(await v.resolve('bob', { fileId: 10 })).toEqual(row)
    // Bob reads but cannot write; the owner rule never upgrades him.
    expect(await v.accessToVault('bob', row)).toEqual({ read: true, write: false, path: 'Notes' })
    // Owner fallen to read-only → nobody writes (decision 5).
    nc.trees.get('bob')![1]!.permissions = 'SGDNVCK'
    nc.trees.get('alice')!.find((n) => n.fileId === 10)!.permissions = 'RGD'
    expect(await v.accessToVault('bob', row, { fresh: true })).toEqual({ read: true, write: false, path: 'Notes' })
  })
})

describe('the composed service', () => {
  let nc: FakeNextcloud
  let dir: ReturnType<typeof tempDir>
  let service: Service
  let free = 10 * 1024 ** 3
  const adapters = new Map<string, MemVaultAdapter>()
  const adapterCalls: string[] = []
  const peers: { destroy(): void }[] = []

  beforeEach(async () => {
    nc = await startFakeNextcloud()
    nc.trees.set('alice', aliceTree())
    nc.trees.set('bob', [
      { path: '', fileId: 2, dir: true, owner: 'bob', permissions: RW },
      { path: 'Shared/Notes', fileId: 10, dir: true, owner: 'alice', permissions: 'SGD', mountType: 'shared' },
    ])
    dir = tempDir('service')
    free = 10 * 1024 ** 3
    service = createService({
      env: env(nc, dir.path),
      clock: new RealClock(),
      port: 0,
      log: () => {},
      freeBytes: async () => free,
      ncReady: async () => true,
      makeAdapter: (row: VaultRow) => {
        adapterCalls.push(row.id)
        let a = adapters.get(row.id)
        if (!a) {
          a = new MemVaultAdapter()
          void a.writeAtomic('a.md', new TextEncoder().encode('alpha\n'))
          adapters.set(row.id, a)
        }
        return a
      },
    })
    const router = createRouter()
    registerVaults(router, service.vaultDeps)
    addFallbacks(router)
    await service.start((req, res) => handleRequest(router, req, res))
  })
  afterEach(async () => {
    for (const p of peers.splice(0)) p.destroy()
    await service.stop()
    await nc.close()
    dir.remove()
  })

  const base = () => `http://127.0.0.1:${service.relay.port}`
  const call = (method: string, path: string, uid: string | null, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base()}${path}`, {
      method,
      headers: {
        ...(uid !== null ? { 'authorization-app-api': authHeader(uid) } : {}),
        ...(method === 'POST' ? { 'x-ohhi-request': '1', origin: nc.url, 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })

  it('serves the routes and the relay on one port; a session token opens the room', async () => {
    expect((await call('GET', '/api/vaults', null)).status).toBe(401)
    expect((await call('POST', '/api/vaults', 'alice', { fileId: 10 }, { 'x-ohhi-request': '0' })).status).toBe(403)
    expect((await call('POST', '/api/vaults', 'alice', { fileId: 10 }, { origin: 'https://evil.test' })).status).toBe(403)

    const created = await call('POST', '/api/vaults', 'alice', { fileId: 10 })
    expect(created.status).toBe(200)
    const row = (await created.json()) as VaultRow
    const custodian = service.custodians.get(row.id)!
    await custodian.ready
    expect(custodian.state).toBe('running')
    expect((await call('POST', '/api/vaults', 'alice', { fileId: 20 })).status).toBe(200)
    const nested = await call('POST', '/api/vaults', 'alice', { fileId: 21 })
    expect(nested.status).toBe(409)
    expect(await nested.json()).toEqual({ error: 'refused', reason: 'nested-vault' })

    // Bob, a read-only recipient, opens it from the Files menu (by file id).
    const s = await call('POST', '/api/session', 'bob', { fileId: 10 })
    expect(s.status).toBe(200)
    const grant = (await s.json()) as { token: string; readOnly: boolean; room: string }
    expect(grant).toMatchObject({ readOnly: true, room: row.room })
    const peer = connectPeer(service.relay.port, `${row.room}/folder`, grant.token, {
      origin: nc.url,
      'authorization-app-api': authHeader('bob'),
    })
    peers.push(peer)
    await until(() => peer.provider.synced && peer.doc.getMap('files').size + peer.doc.share.size > 0, 'bob synced')
    const recent = (await (await call('GET', '/api/vaults', 'bob')).json()) as { own: VaultRow[]; recent: VaultRow[] }
    expect(recent.own).toEqual([])
    expect(recent.recent.map((v) => v.id)).toEqual([row.id])

    const status = (await (await call('GET', `/api/vaults/${row.id}/status`, 'bob')).json()) as { custodian: string; peers: number }
    expect(status.custodian).toBe('running')
    // A stranger cannot even see it; a reader cannot act on holds.
    expect((await call('GET', `/api/vaults/${row.id}/status`, 'carol')).status).toBe(404)
    expect((await call('POST', `/api/vaults/${row.id}/holds/breaker-1`, 'bob', { action: 'confirm' })).status).toBe(403)
    expect((await call('POST', `/api/vaults/${row.id}/holds/breaker-1`, 'alice', { action: 'confirm' })).status).toBe(404)
    expect((await call('POST', `/api/vaults/${row.id}/holds/breaker-1`, 'alice', { action: 'nope' })).status).toBe(400)
  })

  it('DELETE /api/vaults/:id unenrols: custodian stopped, marker, row, recents, store and room gone, sockets closed', async () => {
    const row = (await (await call('POST', '/api/vaults', 'alice', { fileId: 10 })).json()) as VaultRow
    const custodian = service.custodians.get(row.id)!
    await custodian.ready
    // What the custodian put in Files, as the owner's WebDAV sees it.
    nc.trees.get('alice')!.push({
      path: 'Notes/ohhi-host.md',
      fileId: 99,
      dir: false,
      owner: 'alice',
      permissions: RW,
      bytes: new TextDecoder().decode(
        formatHostMarker({ room: row.room, vault: row.id, epoch: 1, instance: 'x', heartbeat: new Date().toISOString() })
      ),
    })
    const s = (await (await call('POST', '/api/session', 'bob', { fileId: 10 })).json()) as { token: string }
    const peer = connectPeer(service.relay.port, `${row.room}/folder`, s.token, {
      origin: nc.url,
      'authorization-app-api': authHeader('bob'),
    })
    peers.push(peer)
    await until(() => peer.provider.synced, 'bob synced')
    await until(() => service.relay.db.roomUsage(row.room).docs > 0, 'room stored', 10_000)

    const del = (uid: string, headers: Record<string, string> = {}) =>
      call('DELETE', `/api/vaults/${row.id}`, uid, undefined, { 'x-ohhi-request': '1', origin: nc.url, ...headers })
    expect((await del('alice', { 'x-ohhi-request': '0' })).status).toBe(403)
    expect((await del('alice', { origin: 'https://evil.test' })).status).toBe(403)
    expect((await del('bob')).status).toBe(403)
    expect(service.db.getVault(row.id)).not.toBeNull()

    const res = await del('alice')
    expect(res.status).toBe(200)
    expect(custodian.state).toBe('stopped')
    expect(service.custodians.has(row.id)).toBe(false)
    expect(service.db.getVault(row.id)).toBeNull()
    expect((await (await call('GET', '/api/vaults', 'bob')).json()).recent).toEqual([])
    expect(nc.trees.get('alice')!.some((n) => n.path === 'Notes/ohhi-host.md')).toBe(false)
    expect(service.relay.db.roomUsage(row.room).docs).toBe(0)
    expect(service.relay.db.getShare(s.token)).toBeNull()
    expect(existsSync(join(dir.path, 'vaults', row.id))).toBe(false)
    await until(() => peer.closed() || peer.reason() !== null || !peer.provider.synced, 'bob closed')
    expect((await call('GET', `/api/vaults/${row.id}/status`, 'alice')).status).toBe(404)
    expect((await del('alice')).status).toBe(404)
    // The folder enrols again as a new vault.
    expect((await call('POST', '/api/vaults', 'alice', { fileId: 10 })).status).toBe(200)
  })

  it('a session minted right after a share is granted sees the share (no cached refusal)', async () => {
    const row = (await (await call('POST', '/api/vaults', 'alice', { fileId: 10 })).json()) as VaultRow
    await service.custodians.get(row.id)!.ready
    nc.trees.set('carol', [{ path: '', fileId: 3, dir: true, owner: 'carol', permissions: RW }])
    expect((await call('POST', '/api/session', 'carol', { vaultId: row.id })).status).toBe(403)
    nc.trees.get('carol')!.push({ path: 'Notes', fileId: 10, dir: true, owner: 'alice', permissions: 'SGD', mountType: 'shared' })
    const s = await call('POST', '/api/session', 'carol', { vaultId: row.id })
    expect(s.status).toBe(200)
    expect(await s.json()).toMatchObject({ readOnly: true, room: row.room })
  })

  it('pauses every custodian below the free-disk watermark and resumes above it', async () => {
    const row = (await (await call('POST', '/api/vaults', 'alice', { fileId: 10 })).json()) as VaultRow
    await service.custodians.get(row.id)!.ready
    free = 100 * 1024 ** 2
    await service.checkDisk()
    expect(service.custodians.get(row.id)!.state).toBe('paused')
    expect(service.db.getVault(row.id)!.status).toBe('paused')
    free = 10 * 1024 ** 3
    await service.checkDisk()
    const resumed = service.custodians.get(row.id)!
    await resumed.ready
    expect(resumed.state).toBe('running')
    expect(service.db.getVault(row.id)!.status).toBe('active')
  })

  it('two processes on one volume see each other: the second is lease-lost, not a co-holder (nextcloud-build R1 #12)', async () => {
    const row = (await (await call('POST', '/api/vaults', 'alice', { fileId: 10 })).json()) as VaultRow
    await service.custodians.get(row.id)!.ready
    // A second container over the SAME persist volume: same instance id.
    const second = createService({
      env: env(nc, dir.path),
      clock: new RealClock(),
      port: 0,
      log: () => {},
      freeBytes: async () => free,
      ncReady: async () => true,
      makeAdapter: (r: VaultRow) => adapters.get(r.id)!,
    })
    expect(second.instance).toBe(service.instance)
    try {
      await second.start(undefined)
      const other = second.custodians.get(row.id)!
      await other.ready
      expect(other.state).toBe('lease-lost')
      expect(service.custodians.get(row.id)!.state).toBe('running')
    } finally {
      await second.stopCustodians()
      await second.stop()
    }
  })

  it('a resume racing enabled=1 launches one custodian, not two (nextcloud-build R1 #11)', async () => {
    const row = (await (await call('POST', '/api/vaults', 'alice', { fileId: 10 })).json()) as VaultRow
    await service.custodians.get(row.id)!.ready
    free = 100 * 1024 ** 2
    await service.checkDisk()
    expect(service.custodians.get(row.id)!.state).toBe('paused')
    const launched = adapterCalls.length
    free = 10 * 1024 ** 3
    await Promise.all([service.checkDisk(), service.startCustodians(), service.checkDisk()])
    expect(adapterCalls.length - launched).toBe(1)
    const c = service.custodians.get(row.id)!
    await c.ready
    expect(c.state).toBe('running')
  })
})

describe('custodians that did not start are retried on the clock (nextcloud-build R1 #2)', () => {
  let nc: FakeNextcloud
  let dir: ReturnType<typeof tempDir>
  let service: Service | null = null

  beforeEach(async () => {
    nc = await startFakeNextcloud()
    nc.trees.set('alice', aliceTree())
    dir = tempDir('retry')
  })
  afterEach(async () => {
    await service?.stop()
    service = null
    await nc.close()
    dir.remove()
  })

  it('retries at 30 s with backoff until the custodian launches; a disable cancels it', async () => {
    const clock = new SimClock()
    let ready = false
    const asked: number[] = []
    service = createService({
      env: env(nc, dir.path),
      clock,
      port: 0,
      log: () => {},
      freeBytes: async () => 10 * 1024 ** 3,
      ncReady: async () => {
        asked.push(clock.now())
        return ready
      },
      makeAdapter: () => {
        const a = new MemVaultAdapter()
        void a.writeAtomic('a.md', new TextEncoder().encode('alpha\n'))
        return a
      },
    })
    const row = vaultRow({ fileId: 10, ownerPath: 'Notes' })
    service.db.insertVault(row)
    await service.start()
    // Nextcloud did not answer: nothing runs, and the row is not given up on.
    expect(asked).toEqual([0])
    expect(service.custodians.get(row.id)).toBeUndefined()
    const step = async (ms: number) => {
      clock.advance(ms)
      await until(() => true, 'tick')
      for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 1))
    }
    await step(29_999)
    expect(asked).toEqual([0])
    await step(1)
    expect(asked).toEqual([0, 30_000])
    await step(60_000) // doubled
    expect(asked).toEqual([0, 30_000, 90_000])
    ready = true
    await step(120_000)
    expect(asked.length).toBe(4)
    // Launched: a first join is under way (it waits for the room on the
    // clock), and a starting custodian is not retried over.
    expect(service.custodians.get(row.id)?.state).toBe('starting')
    await step(50_000)
    expect(asked.length).toBe(4)

    // A disabled app is not restarted by the retry. (The stop waits for the
    // start in flight, which only the clock can end here.)
    const stopping = service.stopCustodians()
    await step(70_000)
    await stopping
    await step(10 * 60_000)
    expect(asked.length).toBe(4)
    expect(service.custodians.size).toBe(0)
  })
})

describe('a vault whose folder is deleted in Files (folder-gone)', () => {
  let nc: FakeNextcloud
  let files: Awaited<ReturnType<typeof createWebDavFake>>
  let dir: ReturnType<typeof tempDir>
  let service: Service | null = null

  beforeEach(async () => {
    nc = await startFakeNextcloud()
    nc.trees.set('alice', aliceTree())
    files = await createWebDavFake({ owner: 'alice' })
    files.put('Notes/a.md', 'alpha\n')
    dir = tempDir('gone')
  })
  afterEach(async () => {
    await service?.stop()
    service = null
    await files.close()
    await nc.close()
    dir.remove()
  })

  it('3 walks without the folder → needs-operator folder-gone, quiet (no walks, no heartbeats, one line); the retry resumes it when it is back', async () => {
    const clock = new SimClock()
    const lines: string[] = []
    service = createService({
      env: env(nc, dir.path),
      clock,
      port: 0,
      log: (l) => lines.push(l),
      freeBytes: async () => 10 * 1024 ** 3,
      ncReady: async () => true,
      makeAdapter: (_row, isActive, walk) =>
        new WebDavVaultAdapter({ baseUrl: `${files.url}Notes/`, headers: () => ({}), clock, owner: 'alice', isActive, ...walk }),
    })
    await service.start()
    const step = async (ms: number) => {
      clock.advance(ms)
      for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 2))
    }
    const row = await service.vaults.enrol('alice', 10)
    const c = service.custodians.get(row.id)!
    await c.ready
    expect(c.state).toBe('running')
    await step(0)

    // Deleted in Files: the folder (and the marker in it) are gone.
    expect((await fetch(`${files.url}Notes/`, { method: 'DELETE' })).status).toBeLessThan(300)
    nc.trees.set('alice', aliceTree().filter((n) => !n.path.startsWith('Notes')))
    await step(30_000)
    await step(30_000)
    expect(c.state).toBe('running') // two walks: not yet
    await step(30_000)
    expect(c.state).toBe('needs-operator')
    expect(service.db.getVault(row.id)).toMatchObject({ status: 'needs-operator', reason: 'folder-gone' })
    expect(await service.vaults.status('alice', row.id)).toMatchObject({ custodian: 'needs-operator', reason: 'folder-gone' })
    const gone = lines.filter((l) => l.includes(row.id))
    expect(gone.filter((l) => l.includes('folder')).length).toBe(1)
    expect(gone.some((l) => /walk failed|heartbeat failed/.test(l))).toBe(false)

    // Stopped: no walk and no heartbeat reach Files any more; the retry re-probes Nextcloud quietly.
    const before = files.requests.length
    await step(30_000)
    await step(60_000)
    expect(files.requests.length).toBe(before)
    expect(lines.filter((l) => l.includes(row.id) && l.includes('folder')).length).toBe(1)

    // Restored from the trash: the next retry finds it and the custodian runs again.
    files.put('Notes/a.md', 'alpha\n')
    nc.trees.set('alice', aliceTree())
    for (let i = 0; i < 12 && service.custodians.get(row.id)?.state !== 'running'; i++) await step(60_000)
    const back = service.custodians.get(row.id)!
    expect(back).not.toBe(c)
    expect(back.state).toBe('running')
    expect(service.db.getVault(row.id)).toMatchObject({ status: 'active' })
    expect(service.db.getVault(row.id)).not.toHaveProperty('reason')
    expect(lines.some((l) => l.includes(row.id) && l.includes('back'))).toBe(true)
  })
})
