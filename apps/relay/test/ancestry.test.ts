/**
 * Device-kind tokens and room ancestry (device-link-shaping A4-A, N3).
 *
 * The rule under test is R5: a *folder* token never grants the vault it was
 * carved out of (nor a sibling carve), while a *device* token — one person's
 * own devices — reaches every room whose recorded ancestry leads back to it,
 * including rooms carved after the devices were linked. Ancestry is
 * structure, never a credential: only the shares table grants access.
 */
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { RelayDb } from '../src/db.ts'
import { createRelay, type Relay } from '../src/server.ts'

const SECRET = 'operator-secret-for-tests'

/** Rooms: the vault, two folders carved out of it, and a stranger's folder. */
const VAULT = 'vaultA'
const TEAM = 'teamR'
const CREW = 'crewR'
const FOREIGN = 'otherR'

const DEVICE_TOKEN = 'device-token-for-vaultA'
const TEAM_TOKEN = 'folder-token-for-teamR'
const RO_DEVICE_TOKEN = 'read-only-device-token-for-vaultA'

async function until(cond: () => boolean, what: string, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

describe('device tokens + room ancestry', () => {
  let dir: string
  let relay: Relay
  const cleanups: (() => void)[] = []

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'relay-ancestry-test-'))
    relay = createRelay({ dbPath: join(dir, 'relay.db'), operatorSecret: SECRET })
    relay.db.addShare({ token: DEVICE_TOKEN, folderGuid: VAULT, kind: 'device' })
    relay.db.addShare({
      token: RO_DEVICE_TOKEN,
      folderGuid: VAULT,
      kind: 'device',
      readOnly: true,
    })
    relay.db.addShare({ token: TEAM_TOKEN, folderGuid: TEAM })
    // team/ and crew/ were carved out of the vault; the foreign folder was
    // carved out of somebody else's vault.
    relay.db.setRoomParent(TEAM, VAULT)
    relay.db.setRoomParent(CREW, VAULT)
    relay.db.setRoomParent(FOREIGN, 'someone-elses-vault')
    await relay.listen()
  })

  afterEach(async () => {
    for (const c of cleanups.splice(0)) c()
    await relay.destroy()
    rmSync(dir, { recursive: true, force: true })
  })

  /** Resolves to null when the connection authenticated, else to the reason. */
  async function authOutcome(
    documentName: string,
    token: string
  ): Promise<{ failure: string | null; scope: string | undefined }> {
    const doc = new Y.Doc()
    const socket = new HocuspocusProviderWebsocket({
      url: `ws://127.0.0.1:${relay.port}`,
      WebSocketPolyfill: WebSocket,
    })
    let failed: string | null = null
    const provider = new HocuspocusProvider({
      name: documentName,
      document: doc,
      token,
      websocketProvider: socket,
      onAuthenticationFailed: (data) => {
        failed = data.reason
      },
    })
    provider.attach()
    cleanups.push(() => {
      provider.destroy()
      socket.destroy()
    })
    await until(
      () => provider.isAuthenticated || failed !== null,
      `an auth outcome for ${documentName}`
    )
    return { failure: failed, scope: provider.authorizedScope }
  }

  const call = (
    method: string,
    path: string,
    opts: { secret?: string; body?: unknown } = {}
  ): Promise<Response> =>
    fetch(`http://127.0.0.1:${relay.port}${path}`, {
      method,
      headers: {
        ...(opts.secret ? { authorization: `Bearer ${opts.secret}` } : {}),
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    })

  // ---- onAuthenticate ----

  it('a device token reaches its own room and a room carved out of it', async () => {
    expect((await authOutcome(`${VAULT}/folder`, DEVICE_TOKEN)).failure).toBeNull()
    expect((await authOutcome(`${TEAM}/d1`, DEVICE_TOKEN)).failure).toBeNull()
    expect((await authOutcome(`${CREW}/folder`, DEVICE_TOKEN)).failure).toBeNull()
  })

  it('a folder token stays exact-match: refused on the parent vault and on a sibling', async () => {
    expect((await authOutcome(`${TEAM}/d1`, TEAM_TOKEN)).failure).toBeNull()
    // R5: the folder share never grants the vault it was carved out of…
    expect((await authOutcome(`${VAULT}/folder`, TEAM_TOKEN)).failure).toBe('out_of_scope')
    // …nor a sibling carve of that same vault.
    expect((await authOutcome(`${CREW}/d1`, TEAM_TOKEN)).failure).toBe('out_of_scope')
  })

  it('a device token is refused on a room whose ancestry does not reach it', async () => {
    // Carved out of someone else's vault…
    expect((await authOutcome(`${FOREIGN}/d1`, DEVICE_TOKEN)).failure).toBe('out_of_scope')
    // …and a room with no ancestry recorded at all.
    expect((await authOutcome('strayR/d1', DEVICE_TOKEN)).failure).toBe('out_of_scope')
  })

  it('a read-only device token is read-only everywhere it reaches', async () => {
    const own = await authOutcome(`${VAULT}/folder`, RO_DEVICE_TOKEN)
    expect(own.failure).toBeNull()
    expect(own.scope).toBe('readonly')
    const carved = await authOutcome(`${TEAM}/d1`, RO_DEVICE_TOKEN)
    expect(carved.failure).toBeNull()
    expect(carved.scope).toBe('readonly')
  })

  // ---- POST /shares: kind + parent ----

  it('mints a device token, records ancestry from parent, and the token then connects', async () => {
    const device = (await (
      await call('POST', '/shares', {
        secret: SECRET,
        body: { folderGuid: 'freshVault', kind: 'device', label: "Chris's laptop" },
      })
    ).json()) as { token: string; kind: string; parent?: string }
    expect(device.kind).toBe('device')
    expect(device.parent).toBeUndefined()

    const carved = (await (
      await call('POST', '/shares', {
        secret: SECRET,
        body: { folderGuid: 'freshTeam', parent: 'freshVault', label: 'vault/team' },
      })
    ).json()) as { token: string; kind: string; parent?: string }
    expect(carved.kind).toBe('folder') // default
    expect(carved.parent).toBe('freshVault')
    expect(relay.db.getRoomParent('freshTeam')).toBe('freshVault')

    // The end-to-end point of A4-A: a carve made after linking needs no paste.
    expect((await authOutcome('freshTeam/d1', device.token)).failure).toBeNull()
    // …while the carve's own token still cannot reach the vault.
    expect((await authOutcome('freshVault/folder', carved.token)).failure).toBe(
      'out_of_scope'
    )

    const listed = (await (await call('GET', '/shares?folder=freshTeam', { secret: SECRET })).json()) as {
      shares: { kind: string }[]
    }
    expect(listed.shares).toHaveLength(1)
    expect(listed.shares[0]!.kind).toBe('folder')
  })

  it('re-minting for the same room restates the ancestry edge (idempotent)', async () => {
    const first = await call('POST', '/shares', { secret: SECRET, body: { folderGuid: 'r1', parent: 'p1' } })
    const again = await call('POST', '/shares', { secret: SECRET, body: { folderGuid: 'r1', parent: 'p1' } })
    expect([first.status, again.status]).toEqual([200, 200])
    expect(relay.db.getRoomParent('r1')).toBe('p1')
  })

  /**
   * The operator secret is relay-WIDE. On a relay serving more than one
   * vault, anyone holding it could otherwise re-mint a victim's room with
   * their OWN vault as the parent — and every device token for that vault
   * would then reach the victim's room through `ancestorsOf`. The edge is
   * write-once, and the refusal happens before the mint.
   */
  it('refuses to re-parent a room that is already recorded under another parent', async () => {
    const res = await call('POST', '/shares', {
      secret: SECRET,
      body: { folderGuid: TEAM, parent: 'attackers-vault' },
    })
    expect(res.status).toBe(409)
    expect((await res.json()) as { error: string; parent: string }).toEqual({
      error: 'this room is already recorded under a different parent',
      parent: VAULT,
    })
    // Nothing moved, and nothing was minted for the attacker to use.
    expect(relay.db.getRoomParent(TEAM)).toBe(VAULT)
    expect(relay.db.listShares().filter((s) => s.folderGuid === TEAM)).toHaveLength(1)

    // …so a device token for the would-be new parent still cannot reach it.
    relay.db.addShare({ token: 'attacker-device', folderGuid: 'attackers-vault', kind: 'device' })
    expect((await authOutcome(`${TEAM}/d1`, 'attacker-device')).failure).toBe('out_of_scope')
  })

  it('setRoomParent itself never re-points an edge', () => {
    expect(relay.db.setRoomParent('fresh', 'p1')).toBe(true)
    expect(relay.db.setRoomParent('fresh', 'p1')).toBe(true) // same parent: fine
    expect(relay.db.setRoomParent('fresh', 'p2')).toBe(false)
    expect(relay.db.getRoomParent('fresh')).toBe('p1')
  })

  it('refuses parent+device, an unknown kind, a blank parent, and a self-parent', async () => {
    const bad = async (body: unknown): Promise<{ status: number; error: string }> => {
      const res = await call('POST', '/shares', { secret: SECRET, body })
      return { status: res.status, error: ((await res.json()) as { error: string }).error }
    }
    // A device token is minted for a root room, never for a child.
    expect(await bad({ folderGuid: 'x', kind: 'device', parent: VAULT })).toEqual({
      status: 400,
      error: 'a device token is minted for a root room, never for a child',
    })
    expect((await bad({ folderGuid: 'x', kind: 'admin' })).status).toBe(400)
    expect((await bad({ folderGuid: 'x', parent: '   ' })).status).toBe(400)
    expect((await bad({ folderGuid: 'x', parent: 'x' })).status).toBe(400)
    // Nothing was persisted by any of them.
    expect(relay.db.listShares().filter((s) => s.folderGuid === 'x')).toHaveLength(0)
    expect(relay.db.getRoomParent('x')).toBeNull()
  })
})

describe('relay.db schema', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'relay-migrate-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('adds kind (and rooms) to a database written before they existed', () => {
    const path = join(dir, 'legacy.db')
    // The pre-N3 schema, verbatim: no kind column, no rooms table.
    const legacy = new Database(path)
    legacy.exec(`
      CREATE TABLE shares (
        token TEXT PRIMARY KEY,
        folder_guid TEXT NOT NULL,
        read_only INTEGER NOT NULL DEFAULT 0,
        label TEXT,
        created_at TEXT
      );
      CREATE TABLE docs (name TEXT PRIMARY KEY, state BLOB NOT NULL, updated_at TEXT);
    `)
    legacy
      .prepare('INSERT INTO shares (token, folder_guid, read_only, label, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('old-token', 'old-folder', 1, 'from before', '2026-01-01T00:00:00.000Z')
    legacy.close()

    const db = new RelayDb(path)
    try {
      // The pre-existing row keeps every value it had and reads as a folder
      // share — an old dogfood token must not silently become a device token.
      expect(db.getShare('old-token')).toEqual({
        token: 'old-token',
        folderGuid: 'old-folder',
        readOnly: true,
        label: 'from before',
        createdAt: '2026-01-01T00:00:00.000Z',
        kind: 'folder',
      })
      // …and the migrated database takes new rows and ancestry edges.
      db.addShare({ token: 'new-token', folderGuid: 'new-folder', kind: 'device' })
      expect(db.getShare('new-token')?.kind).toBe('device')
      db.setRoomParent('child', 'new-folder')
      expect(db.ancestorsOf('child')).toEqual(['new-folder'])
    } finally {
      db.close()
    }

    // Idempotent: opening the migrated file again is a no-op.
    const again = new RelayDb(path)
    expect(again.getShare('old-token')?.kind).toBe('folder')
    again.close()
  })

  it('bounds the ancestry walk and survives a cycle', () => {
    const db = new RelayDb(join(dir, 'walk.db'))
    try {
      // A 12-deep chain: r0 → r1 → … → r12.
      for (let i = 0; i < 12; i++) db.setRoomParent(`r${i}`, `r${i + 1}`)
      expect(db.ancestorsOf('r0')).toHaveLength(8) // MAX_ANCESTRY_HOPS
      expect(db.ancestorsOf('r0', 2)).toEqual(['r1', 'r2'])

      // A cycle terminates instead of spinning.
      db.setRoomParent('a', 'b')
      db.setRoomParent('b', 'a')
      expect(db.ancestorsOf('a')).toEqual(['b'])
      expect(db.ancestorsOf('unknown-room')).toEqual([])
    } finally {
      db.close()
    }
  })
})
