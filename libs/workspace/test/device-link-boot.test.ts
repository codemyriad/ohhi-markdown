/**
 * What a mount does at BOOT with a `neverHeld` desc, against the real relay
 * (device-link N3 review, C1/C2).
 *
 * `nested.test.ts` proves the decisions over a simulated room; these two need
 * a server, because both are about a credential actually being used. The
 * first is the worst bug the review found — an adopted mount that enrols the
 * room's own files under fresh guids and pushes them back — and the only way
 * to show it is not happening is to look at what the room holds afterwards.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MountsFile } from '@editor/vault'
import {
  addMountLink,
  bootDevice,
  carveOn,
  checkInvariants,
  diskSnapshot,
  encodeDeviceLink,
  memDir,
  mintShare,
  mountSynced,
  probeAuth,
  rowsOf,
  seedAdapter,
  startTestRelay,
  TokenStore,
  until,
  type Device,
  type TestRelay,
} from './device-link-harness.js'

const VAULT_FILES: Record<string, string> = {
  'inbox.md': 'root note\n',
  'team/plan.md': 'the shared plan\n',
  'team/notes/deep.md': 'a nested shared note\n',
}

describe('a mount that has never held its room', () => {
  let relay: TestRelay
  const devices: Device[] = []

  beforeAll(async () => {
    relay = await startTestRelay('device-link-boot')
  }, 60_000)
  afterAll(async () => {
    await relay?.stop()
  }, 30_000)
  afterEach(async () => {
    for (const dev of devices.splice(0)) await dev.shutdown()
  })

  it(
    'boots into an awaited pull with a token, and never enrols the room’s files (C1)',
    async () => {
      const vault = crypto.randomUUID()
      const teamRoom = crypto.randomUUID()
      const share = await mintShare(relay, { folderGuid: teamRoom, label: 'team', parent: vault })

      // A owns the folder and puts it in the room.
      const tokensA = new TokenStore(relay.url)
      const a = await bootDevice({
        id: 'A',
        adapter: await seedAdapter(VAULT_FILES),
        vaultDir: memDir(),
        rootRoom: vault,
        relayUrl: relay.url,
        tokens: tokensA,
      })
      devices.push(a)
      await carveOn(a, { path: 'team', room: teamRoom, token: share.token })
      await until('A acked the folder', () => mountSynced(a, 'team'))
      const roomRows = rowsOf(a, 'team')
      const roomGuids = a.mounts
        .get('team')!
        .files()
        .filter((r) => r.kind === 'text')
        .map((r) => r.guid)
        .sort()

      // B holds a `neverHeld` desc for that room, a token for it, and STALE
      // bytes of its own under the mount root. This is the state an adopt
      // leaves when its pull failed, or that a paste's rollback leaves behind:
      // `neverHeld` on the desc, a credential that now resolves.
      const bDir = memDir()
      await new MountsFile(bDir.io('mounts.json')).save([
        { room: vault, path: '', provenance: 'local', status: 'active' },
        {
          room: teamRoom,
          path: 'team',
          provenance: 'adopted',
          relay: { url: relay.url },
          status: 'needs-token',
          neverHeld: true,
        },
      ])
      const tokensB = new TokenStore(relay.url)
      tokensB.set(teamRoom, share.token, relay.url, 'folder')
      const b = await bootDevice({
        id: 'B',
        adapter: await seedAdapter({
          'inbox.md': 'B root note\n',
          'team/plan.md': "B's stale copy\n",
        }),
        vaultDir: bDir,
        rootRoom: vault,
        relayUrl: relay.url,
        tokens: tokensB,
      })
      devices.push(b)

      // It PULLED: the decision was firstJoin, not "enrol what is on disk".
      expect(b.builds.filter((r) => r.room === teamRoom)).toEqual([
        { room: teamRoom, path: 'team', firstJoin: true, token: share.token, relay: relay.url },
      ])
      // ...so B holds the room's own guids, not guids it minted, and the
      // room's content overwrote its stale copy.
      expect(rowsOf(b, 'team')).toEqual(roomRows)
      expect(
        b.mounts
          .get('team')!
          .files()
          .filter((r) => r.kind === 'text')
          .map((r) => r.guid)
          .sort()
      ).toEqual(roomGuids)
      const onDisk = await diskSnapshot(b)
      // The room's note B did NOT have was written...
      expect(onDisk['team/notes/deep.md']).toBe(VAULT_FILES['team/notes/deep.md'])
      // ...and the one it did keeps its bytes, reported rather than clobbered.
      // A pull is not permission to overwrite somebody's file (golden rule 1):
      // a destination that already differs is a divergence, and `joinFolder`
      // says so by name.
      expect(onDisk['team/plan.md']).toBe("B's stale copy\n")
      expect(b.errors.join(' ')).toContain('plan.md (disk-differs-from-remote)')

      // And the owner's room is exactly as it was: no second copy of any note,
      // no entry A does not recognise, and — the whole point — not one byte of
      // B's stale copy pushed into it under a guid B minted for itself.
      await until('the room settled', () => mountSynced(a, 'team'))
      expect(rowsOf(a, 'team')).toEqual(roomRows)
      expect(await diskSnapshot(a)).toEqual(VAULT_FILES)
      expect(a.mounts.get('team')!.docForPath('plan.md')?.getText()).toBe(
        VAULT_FILES['team/plan.md']
      )
      checkInvariants(a)
      checkInvariants(b)
    },
    60_000
  )

  it('the harness refuses a DEVICE link at "Add link…", as the shim does', async () => {
    // The harness exists to catch the shim drifting, so where the shim
    // refuses, it must refuse. A device token is a credential for a whole
    // vault that the relay also honours in rooms carved out of it; filing one
    // against a single folder's room would hand vault-wide access to the
    // exact-match rule, and to the next device link's grants bundle (R5).
    const vault = crypto.randomUUID()
    const teamRoom = crypto.randomUUID()
    const share = await mintShare(relay, { folderGuid: teamRoom, label: 'team', parent: vault })
    const device = await mintShare(relay, { folderGuid: vault, kind: 'device', label: 'vault' })

    const dir = memDir()
    await new MountsFile(dir.io('mounts.json')).save([
      { room: vault, path: '', provenance: 'local', status: 'active' },
      {
        room: teamRoom,
        path: 'team',
        provenance: 'adopted',
        relay: { url: relay.url },
        status: 'needs-token',
        neverHeld: true,
      },
    ])
    const dev = await bootDevice({
      id: 'B',
      adapter: await seedAdapter({ 'inbox.md': 'root note\n' }),
      vaultDir: dir,
      rootRoom: vault,
      relayUrl: relay.url,
      tokens: new TokenStore(relay.url),
    })
    devices.push(dev)

    await expect(
      addMountLink(
        dev,
        'team',
        encodeDeviceLink({ relay: relay.url, room: vault, token: device.token })
      )
    ).rejects.toThrow(/device link/)
    // Nothing was stored and nothing changed: the refusal is the whole of it.
    // (A FOLDER link for the same mount is accepted — that is the C1 case
    // above, and A4-C in `device-link-grants.test.ts`.)
    expect(dev.tokens.token(vault)).toBe('')
    expect(dev.tokens.token(teamRoom)).toBe('')
    expect(dev.descs().find((d) => d.room === teamRoom)?.status).toBe('needs-token')
    expect(share.token).toBeTypeOf('string')
  }, 60_000)

  it(
    'a session whose token was refused re-keys on enableSharing (C2)',
    async () => {
      const room = crypto.randomUUID()
      const good = await mintShare(relay, { folderGuid: room, label: 'folder' })
      const other = crypto.randomUUID()
      const wrong = await mintShare(relay, { folderGuid: other, label: 'somebody else' })

      // The mount comes up with a token the relay refuses for this room —
      // which is exactly what `degradeOnAuthRefusal` leaves behind: a live
      // session, its relay still set, its (dead) connections still attached.
      const probe = await probeAuth({ relayUrl: relay.url, room, token: wrong.token })
      try {
        await until('the refusal was reported', () => probe.errors.length > 0)
        expect(probe.record.synced).toBe(false)

        // The paste. `connectFolder` returns early on an existing folderConn
        // and `attachProvider` skips a guid that already has one, so without a
        // re-key the new credential is accepted by config, written into the
        // desc as `active`, and never used by a single socket.
        probe.session.enableSharing({ url: relay.url, token: good.token })
        await until('the new token connected', () => probe.record.synced === true, 20_000)
        expect(probe.record.connected).toBe(true)
      } finally {
        await probe.shutdown()
      }
    },
    60_000
  )
})
