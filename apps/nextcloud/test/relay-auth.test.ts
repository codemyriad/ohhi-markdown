/**
 * Session tokens on the in-process relay (decisions 4, 5, 14): minting,
 * expiry, uid binding, the Origin rule, the room prefix, the custodian's
 * device token, and the live re-check closing a downgraded connection.
 */
import { join } from 'node:path'
import { createRelay, type Relay } from '@ohhi/relay'
import { SimClock } from '@ohhi/testkit'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuthenticate, peersInRoom, startAccessRecheck, type HocuspocusLike } from '../src/relay-auth.js'
import { GRANT_TTL_MS, mintGrant, revokeTokens, startShareSweep } from '../src/grants.js'
import { NcHttpError } from '../src/permissions.js'
import type { Access, VaultRow } from '../src/types.js'
import { authHeader, connectPeer, SECRET, tempDir, until, type Peer } from './fixtures.js'

const NC = 'http://cloud.test'
const ROOM = '11111111-1111-4111-8111-111111111111'
const VAULT: VaultRow = {
  id: '22222222-2222-4222-8222-222222222222',
  fileId: 10,
  ownerUid: 'alice',
  ownerPath: 'Notes',
  room: ROOM,
  epoch: 1,
  createdAt: '2026-10-11T00:00:00.000Z',
  status: 'active',
}

describe('relay authentication', () => {
  let dir: ReturnType<typeof tempDir>
  let relay: Relay
  let clock: SimClock
  const access = new Map<string, Access>()
  const peers: Peer[] = []
  const recorded: string[] = []

  beforeEach(async () => {
    dir = tempDir('auth')
    clock = new SimClock()
    clock.advance(1_000_000)
    access.set('alice', { read: true, write: true, path: 'Notes' })
    access.set('bob', { read: true, write: true, path: 'Notes' })
    relay = createRelay({
      dbPath: join(dir.path, 'relay.db'),
      authenticate: createAuthenticate({
        relayDb: { getShare: (t) => relay.db.getShare(t) },
        appSecret: SECRET,
        origins: { ncOrigin: NC, publicOrigins: [] },
        clock,
        vaultIdForRoom: (room) => (room === ROOM ? VAULT.id : null),
        accessFor: async (uid) => access.get(uid) ?? null,
      }),
    })
    await relay.listen()
  })
  afterEach(async () => {
    for (const p of peers.splice(0)) p.destroy()
    await relay.destroy()
    dir.remove()
  })

  const grantDeps = () => ({
    vaults: {
      resolve: async () => VAULT,
      accessToVault: async (uid: string) => access.get(uid) ?? { read: false, write: false, path: null },
    },
    db: { recordAccess: (v: string, u: string) => void recorded.push(`${u}@${v}`) },
    relayDb: relay.db,
    clock,
  })

  const peer = (token: string, uid: string | null, extra: Record<string, string> = {}, doc = `${ROOM}/folder`): Peer => {
    // `origin: ''` drops the header (a client that sends none).
    const headers: Record<string, string> = Object.fromEntries(
      Object.entries({ origin: NC, ...extra }).filter(([, v]) => v !== '')
    )
    if (uid !== null) headers['authorization-app-api'] = authHeader(uid)
    const p = connectPeer(relay.port, doc, token, headers)
    peers.push(p)
    return p
  }

  it('mints a ≤10-minute, user-bound token and records the access', async () => {
    const grant = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    expect(grant).toMatchObject({ readOnly: false, room: ROOM, vaultId: VAULT.id })
    expect(grant).not.toHaveProperty('relay')
    expect(grant.token).toMatch(/^[0-9a-f]{64}$/)
    expect(grant.expiresAt).toBe(clock.now() + GRANT_TTL_MS)
    expect(relay.db.getShare(grant.token)).toMatchObject({ ncUid: 'alice', vaultId: VAULT.id, kind: 'folder', folderGuid: ROOM })
    expect(recorded).toEqual([`alice@${VAULT.id}`])

    access.set('bob', { read: true, write: false, path: 'Notes' })
    expect((await mintGrant(grantDeps(), 'bob', { vaultId: VAULT.id })).readOnly).toBe(true)
    access.set('bob', { read: false, write: false, path: null })
    await expect(mintGrant(grantDeps(), 'bob', { vaultId: VAULT.id })).rejects.toMatchObject({ status: 403 })
  })

  it('admits the token for its uid, in its room, from the Nextcloud origin', async () => {
    const { token } = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const ok = peer(token, 'alice')
    await until(() => ok.provider.synced, 'alice synced')
    // Hocuspocus v4 `documents` → `getConnections()` carries our context.
    expect(peersInRoom(relay.hocuspocus as unknown as HocuspocusLike, ROOM)).toBe(1)
  })

  it("admits a browser upgrade whose Origin is the request's own Host (Chromium sends no Sec-Fetch-Site on a WebSocket)", async () => {
    const { token } = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const sameHost = peer(token, 'alice', { origin: `http://127.0.0.1:${relay.port}` })
    await until(() => sameHost.provider.synced, 'same-host origin synced')
  })

  it('refuses a browser token with no Origin and no Sec-Fetch-Site', async () => {
    const { token } = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const bare = peer(token, 'alice', { origin: '' })
    await until(() => bare.reason() !== null, 'refusal')
    expect(bare.reason()).toBe('permission-denied')
    const fetchMeta = peer(token, 'alice', { origin: '', 'sec-fetch-site': 'same-origin' })
    await until(() => fetchMeta.provider.synced, 'sec-fetch-site same-origin synced')
  })

  it('refuses another uid, a forged header, a foreign origin, another room and an expired token', async () => {
    const { token } = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const asBob = peer(token, 'bob')
    const forged = peer(token, null, { 'authorization-app-api': Buffer.from('alice:wrong').toString('base64') })
    const noHeader = peer(token, null)
    const evil = peer(token, 'alice', { origin: 'https://evil.test' })
    const crossSite = peer(token, 'alice', { origin: NC, 'sec-fetch-site': 'cross-site' })
    const otherRoom = peer(token, 'alice', {}, '33333333-3333-4333-8333-333333333333/folder')
    for (const p of [asBob, forged, noHeader, evil, crossSite, otherRoom]) {
      await until(() => p.reason() !== null, 'refusal')
      expect(p.reason()).toBe('permission-denied')
    }
    clock.advance(GRANT_TTL_MS)
    const late = peer(token, 'alice')
    await until(() => late.reason() !== null, 'expired refusal')
  })

  it('the sweep deletes expired tokens on the clock', async () => {
    const { token } = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const stop = startShareSweep(relay.db, clock)
    clock.advance(GRANT_TTL_MS - 60_000)
    expect(relay.db.getShare(token)).not.toBeNull()
    clock.advance(60_000)
    expect(relay.db.getShare(token)).toBeNull()
    stop()
  })

  it('a live downgrade at connect wins over a writable token', async () => {
    const { token } = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    access.set('alice', { read: true, write: false, path: 'Notes' })
    const p = peer(token, 'alice')
    await until(() => p.provider.synced, 'synced')
    const conns = [...relay.hocuspocus.documents.values()].flatMap((d) => d.getConnections())
    expect(conns.map((c) => c.readOnly)).toEqual([true])
  })

  it('the device token is the custodian: never through the proxy, only vault rooms', async () => {
    relay.db.addShare({ token: 'device-token', folderGuid: 'instance', kind: 'device', ncUid: null, vaultId: null })
    const custodian = connectPeer(relay.port, `${ROOM}/folder`, 'device-token')
    peers.push(custodian)
    await until(() => custodian.provider.synced, 'custodian synced')
    // It is not a peer for the adapter's poll interval.
    expect(peersInRoom(relay.hocuspocus as unknown as HocuspocusLike, ROOM)).toBe(0)
    const viaProxy = peer('device-token', 'alice')
    const notAVault = connectPeer(relay.port, 'not-a-vault/folder', 'device-token')
    peers.push(notAVault)
    await until(() => viaProxy.reason() !== null && notAVault.reason() !== null, 'device refusals')
  })

  it('the re-check closes a downgraded connection (the reconnect is read-only) and revokes on lost read', async () => {
    const a = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const b = await mintGrant(grantDeps(), 'bob', { vaultId: VAULT.id })
    const alice = peer(a.token, 'alice')
    const bob = peer(b.token, 'bob')
    await until(() => alice.provider.synced && bob.provider.synced, 'both synced')

    const revoked: string[] = []
    const recheck = startAccessRecheck({
      hocuspocus: relay.hocuspocus as unknown as HocuspocusLike,
      clock,
      accessFor: async (uid) => access.get(uid) ?? null,
      revokeTokens: (uid, vaultId) => {
        revoked.push(uid)
        revokeTokens(relay.db, uid, vaultId)
      },
    })
    expect((await recheck.runOnce()).closed).toBe(0)

    access.set('bob', { read: true, write: false, path: 'Notes' }) // write → read
    expect((await recheck.runOnce()).closed).toBe(1)
    await until(() => bob.closed(), 'bob closed')
    expect(alice.closed()).toBe(false)
    // Nothing revoked: the shell's cached (writable) token reconnects, and
    // the connect-time check makes that connection read-only.
    expect(revoked).toEqual([])
    const bob2 = peer(b.token, 'bob')
    await until(() => bob2.provider.synced, 'bob2 synced')
    const bobConns = () =>
      [...relay.hocuspocus.documents.values()]
        .flatMap((d) => d.getConnections())
        .filter((c) => (c.context as { uid?: string }).uid === 'bob')
    expect(bobConns().map((c) => c.readOnly)).toEqual([true])
    expect((await recheck.runOnce()).closed).toBe(0) // read-only already: nothing to close

    // Then bob loses read entirely on the clock's tick: closed, tokens gone.
    access.set('bob', { read: false, write: false, path: null })
    clock.advance(60_000) // the loop's own tick
    await until(() => bob2.closed(), 'bob2 closed by the loop')
    expect(revoked).toEqual(['bob'])
    expect(relay.db.getShare(b.token)).toBeNull()
    recheck.stop()
  })

  it('a re-check whose access read fails (a 401 mid-update) closes and revokes nothing (nextcloud-build R1 #7)', async () => {
    const a = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const alice = peer(a.token, 'alice')
    await until(() => alice.provider.synced, 'alice synced')
    const revoked: string[] = []
    const errors: unknown[] = []
    const recheck = startAccessRecheck({
      hocuspocus: relay.hocuspocus as unknown as HocuspocusLike,
      clock,
      accessFor: async () => {
        throw new NcHttpError(401, 'SEARCH')
      },
      revokeTokens: (uid) => revoked.push(uid),
      onError: (err) => errors.push(err),
    })
    expect((await recheck.runOnce()).closed).toBe(0)
    expect(revoked).toEqual([])
    expect(errors).toHaveLength(1)
    expect(alice.closed()).toBe(false)
    expect(relay.db.getShare(a.token)).not.toBeNull()
    recheck.stop()
  })

  it('the re-check closes a connection whose token has expired (nextcloud-build R1 #13)', async () => {
    const a = await mintGrant(grantDeps(), 'alice', { vaultId: VAULT.id })
    const alice = peer(a.token, 'alice')
    await until(() => alice.provider.synced, 'alice synced')
    const recheck = startAccessRecheck({
      hocuspocus: relay.hocuspocus as unknown as HocuspocusLike,
      clock,
      accessFor: async (uid) => access.get(uid) ?? null,
      revokeTokens: () => {},
    })
    clock.advance(GRANT_TTL_MS - 1)
    expect((await recheck.runOnce()).closed).toBe(0)
    expect(alice.closed()).toBe(false)
    clock.advance(1) // expired: closed, read access or not
    expect((await recheck.runOnce()).closed).toBe(1)
    await until(() => alice.closed(), 'alice closed on expiry')
    recheck.stop()
  })
})
