/**
 * The three token routes, end to end against the REAL relay (slice N3;
 * device-link-shaping.md A4-A/B/C, decision 3; spike S10 Q2/Q3/Q7).
 *
 * Chris took all three routes deliberately, and each covers a case the others
 * cannot:
 *
 *  - **A4-A, relay ancestry** — a folder carved on one device AFTER the
 *    devices were linked. The peer holds no token for that room at all and
 *    must connect on the vault's own `device` token, which the relay accepts
 *    because it recorded the carve's `parent`.
 *  - **A4-B, the link bundle** — a FOREIGN share the linking device already
 *    held. Ancestry cannot help (it was carved out of somebody else's vault,
 *    on their relay), so the credential travels in the link.
 *  - **A4-C, paste once** — a foreign share joined AFTER the link was made.
 *    Nothing can have carried its token, so the mount is honest about it:
 *    `needs-token`, files kept and marked, activated by one paste.
 *
 * These are relay-backed on purpose. `nested.test.ts` proves the adopt machine
 * over a simulated room; what is unproven until a real server answers is
 * whether the credential the host resolved is one the relay actually accepts
 * for that room's documents — which is the whole of N3.
 */
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest'
import { MemVaultAdapter } from '@ohhi/vault'
import {
  addMountLink,
  bootDevice,
  carveOn,
  checkInvariants,
  decodeShareLink,
  diskSnapshot,
  encodeDeviceLink,
  encodeShareLink,
  joinOn,
  memDir,
  mintShare,
  mountSynced,
  reboot,
  rowsOf,
  seedAdapter,
  startTestRelay,
  TokenStore,
  until,
  type Device,
  type TestRelay,
} from './device-link-harness.js'

/** Chris's vault: a couple of root notes and the folder he shares with his team. */
const VAULT_FILES: Record<string, string> = {
  'inbox.md': 'root note\n',
  'team/plan.md': 'the shared plan\n',
  'team/notes/deep.md': 'a nested shared note\n',
}

/** Cynthia's folder, on Cynthia's relay — a share Chris joined, never carved. */
const DESIGN_FILES: Record<string, string> = {
  'palette.md': 'ink, paper, signal\n',
  'type.md': 'one serif, one mono\n',
}

const design = (files: Record<string, string>, at = 'design'): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([p, text]) => [`${at}/${p}`, text]))

describe('device links: own-device grants, bundles and paste-once', () => {
  /** The vault's relay. */
  let relay: TestRelay
  /** Somebody else's relay — where a foreign share lives (spike S10 Q7). */
  let foreignRelay: TestRelay
  const devices: Device[] = []

  beforeAll(async () => {
    ;[relay, foreignRelay] = await Promise.all([
      startTestRelay('device-link-grants'),
      startTestRelay('device-link-foreign'),
    ])
  }, 60_000)

  afterAll(async () => {
    await Promise.all([relay?.stop(), foreignRelay?.stop()])
  }, 30_000)

  afterEach(async () => {
    for (const dev of devices.splice(0)) await dev.shutdown()
  })

  /** Chris's own two devices: A holds the vault, B is linked to it. */
  const linkVault = async (
    room: string,
    deviceToken: string,
    files: Record<string, string>
  ): Promise<{ a: Device; b: Device }> => {
    const tokensA = new TokenStore(relay.url)
    tokensA.set(room, deviceToken, relay.url, 'device')
    const a = await bootDevice({
      id: 'A',
      adapter: await seedAdapter(files),
      vaultDir: memDir(),
      rootRoom: room,
      relayUrl: relay.url,
      tokens: tokensA,
    })
    devices.push(a)
    // The vault is durably on the relay before the second device asks for it:
    // B pulls from the room, not from a live peer that might still be pushing.
    await until('A acked the vault', () => mountSynced(a, ''))

    const tokensB = new TokenStore(relay.url)
    tokensB.set(room, deviceToken, relay.url, 'device')
    const b = await bootDevice({
      id: 'B',
      adapter: new MemVaultAdapter(), // R4: a fresh device starts from an EMPTY folder
      vaultDir: memDir(),
      rootRoom: room,
      relayUrl: relay.url,
      tokens: tokensB,
      firstJoin: true,
    })
    devices.push(b)
    return { a, b }
  }

  it(
    'A4-A: a folder carved AFTER linking connects on the device token, with no paste',
    async () => {
      const vault = crypto.randomUUID()
      const link = await mintShare(relay, {
        folderGuid: vault,
        kind: 'device',
        label: "Chris's vault",
      })
      expect(link.kind).toBe('device')

      const { a, b } = await linkVault(vault, link.token, VAULT_FILES)
      // The whole vault arrived on the linked device (R4).
      expect(await diskSnapshot(b)).toEqual(VAULT_FILES)
      await until('B acked the vault', () => mountSynced(b, ''))

      // A carves team/. The mint records the ancestry edge ALWAYS (S10 Q3) —
      // that edge is what makes this carve reachable by a device token minted
      // before it existed.
      const teamRoom = crypto.randomUUID()
      const teamShare = await mintShare(relay, {
        folderGuid: teamRoom,
        parent: vault,
        label: 'vault/team',
      })
      expect(teamShare.kind).toBe('folder')
      expect(teamShare.parent).toBe(vault)
      await carveOn(a, { path: 'team', room: teamRoom, token: teamShare.token })

      // B's adopt runs off the mount entry that rode the carve transaction.
      await until(
        'B adopted team/',
        () =>
          b.mounts.has('team') &&
          b.descs().some((d) => d.room === teamRoom && d.status === 'active')
      )

      // The point of A4-A: B holds NO token for the carved room…
      expect(b.tokens.has(teamRoom)).toBe(false)
      expect(b.tokens.token(vault)).toBe(link.token)
      // …so the credential it connected with is the vault's device token, and
      // the mount was seeded from B's own namespace (no pull, `firstJoin`
      // false — the guids are already B's).
      expect(b.builds.find((x) => x.room === teamRoom)).toMatchObject({
        path: 'team',
        firstJoin: false,
        token: link.token,
        relay: relay.url,
      })
      // …and the relay ACCEPTED it: the mount's folder doc and every doc of
      // the room reached a durable ack on that token (golden rule 4's input).
      await until('B synced the carved room', () => mountSynced(b, 'team'))
      expect(b.errors).toEqual([])
      expect(b.notices.map((n) => n.kind)).toContain('adopted')

      // Both directions really flow through room `teamRoom`, on two different
      // credentials: A on its folder token, B on the vault's device token.
      await a.mounts.get('team')!.createFile('', 'from-a.md', 'written on A\n')
      await until('the new note reached B', () => rowsOf(b, 'team').includes('from-a.md'))
      await until(
        'and was written to B’s vault',
        async () => (await diskSnapshot(b))['team/from-a.md'] === 'written on A\n'
      )

      b.mounts.get('team')!.docForPath('plan.md')!.transact((t) => t.insert(0, 'B: '), 'local')
      await until(
        'B’s edit reached A',
        () => a.mounts.get('team')!.docForPath('plan.md')?.getText().startsWith('B: ') === true
      )

      checkInvariants(a)
      checkInvariants(b)
      // The root keeps exactly the files that are not the mount's.
      expect(rowsOf(a, '')).toEqual(['inbox.md'])
      expect(rowsOf(b, '')).toEqual(['inbox.md'])
    },
    90_000
  )

  it(
    'A4-B: a foreign share the linking device held arrives already connected',
    async () => {
      const vault = crypto.randomUUID()
      const designRoom = crypto.randomUUID()
      const link = await mintShare(relay, { folderGuid: vault, kind: 'device' })
      // Cynthia's share: her room, her relay, her folder token. No ancestry
      // edge exists or could exist — it was not carved out of Chris's vault.
      const designShare = await mintShare(foreignRelay, {
        folderGuid: designRoom,
        label: "Cynthia's design",
      })
      const designLink = encodeShareLink({
        relay: foreignRelay.url,
        room: designRoom,
        token: designShare.token,
      })

      // Cynthia seeds her folder and leaves; the relay holds it.
      const cynthiaTokens = new TokenStore(foreignRelay.url)
      cynthiaTokens.set(designRoom, designShare.token, foreignRelay.url, 'folder')
      const cynthia = await bootDevice({
        id: 'C',
        adapter: await seedAdapter(DESIGN_FILES),
        vaultDir: memDir(),
        rootRoom: designRoom,
        relayUrl: foreignRelay.url,
        tokens: cynthiaTokens,
      })
      await until('Cynthia acked her folder', () => mountSynced(cynthia, ''))
      await cynthia.shutdown()

      // Chris's device A: the vault, plus Cynthia's folder joined at design/.
      const tokensA = new TokenStore(relay.url)
      tokensA.set(vault, link.token, relay.url, 'device')
      const a = await bootDevice({
        id: 'A',
        adapter: await seedAdapter(VAULT_FILES),
        vaultDir: memDir(),
        rootRoom: vault,
        relayUrl: relay.url,
        tokens: tokensA,
      })
      devices.push(a)
      await until('A acked the vault', () => mountSynced(a, ''))
      await joinOn(a, { dest: 'design', link: designLink })
      await until('A pulled Cynthia’s folder', () => rowsOf(a, 'design').length === 2)

      // A builds the device link: the vault's device token plus every grant
      // this device holds. The link's own room is never a grant.
      const bundle = encodeDeviceLink({
        relay: relay.url,
        room: vault,
        token: link.token,
        grants: a.tokens.grantsForBundle(),
      })
      const target = decodeShareLink(bundle)
      expect(target.kind).toBe('device')
      expect(target.grants).toEqual([
        { room: designRoom, relay: foreignRelay.url, token: designShare.token },
      ])

      // B merges the grants BEFORE booting (S10 Q7): the adopt that follows
      // the root pull must find the token already in place, or the mount
      // flashes `needs-token` and then repairs itself.
      const tokensB = new TokenStore(relay.url)
      tokensB.set(target.room, target.token, target.relay, target.kind)
      expect(tokensB.mergeGrants(target.grants)).toEqual([designRoom])
      const b = await bootDevice({
        id: 'B',
        adapter: new MemVaultAdapter(),
        vaultDir: memDir(),
        rootRoom: vault,
        relayUrl: relay.url,
        tokens: tokensB,
        firstJoin: true,
      })
      devices.push(b)

      await until(
        'B adopted design/',
        () => b.mounts.has('design') && b.descs().some((d) => d.room === designRoom)
      )
      // The EXACT token from the bundle, on CYNTHIA's relay — never the
      // vault's device token, which that relay has never heard of.
      expect(b.builds.find((x) => x.room === designRoom)).toMatchObject({
        path: 'design',
        token: designShare.token,
        relay: foreignRelay.url,
        // M(P) is empty on B, so the adopt asks for a PULL rather than a merge
        // with a namespace it built from its own state (adopt.ts's firstJoin
        // rule) — this device never held these files.
        firstJoin: true,
      })
      // No `needs-token` flash: the mount went straight to active.
      expect(b.notices.filter((n) => n.kind === 'needs-token')).toEqual([])
      expect(b.descs().find((d) => d.room === designRoom)?.status).toBe('active')

      // M(P) was empty on B — it never held these files — so the content came
      // from Cynthia's room, not from B's own namespace.
      await until('B pulled the foreign share', () => rowsOf(b, 'design').length === 2)
      await until('…onto B’s vault', async () => {
        const disk = await diskSnapshot(b)
        return Object.entries(design(DESIGN_FILES)).every(([p, text]) => disk[p] === text)
      })
      expect(b.errors).toEqual([])
      checkInvariants(b)
    },
    90_000
  )

  it(
    'A4-C: a foreign share joined AFTER linking says "link needed", and one paste activates it',
    async () => {
      const vault = crypto.randomUUID()
      const designRoom = crypto.randomUUID()
      const link = await mintShare(relay, { folderGuid: vault, kind: 'device' })
      const designShare = await mintShare(foreignRelay, {
        folderGuid: designRoom,
        label: "Cynthia's design",
      })
      const designLink = encodeShareLink({
        relay: foreignRelay.url,
        room: designRoom,
        token: designShare.token,
      })

      const cynthiaTokens = new TokenStore(foreignRelay.url)
      cynthiaTokens.set(designRoom, designShare.token, foreignRelay.url, 'folder')
      const cynthia = await bootDevice({
        id: 'C',
        adapter: await seedAdapter(DESIGN_FILES),
        vaultDir: memDir(),
        rootRoom: designRoom,
        relayUrl: foreignRelay.url,
        tokens: cynthiaTokens,
      })
      await until('Cynthia acked her folder', () => mountSynced(cynthia, ''))
      await cynthia.shutdown()

      // The devices are linked FIRST — so no bundle can carry what A is about
      // to join. This is the only route left, and it is why Chris took three.
      const { a, b } = await linkVault(vault, link.token, VAULT_FILES)
      await until('B acked the vault', () => mountSynced(b, ''))
      expect(b.tokens.has(designRoom)).toBe(false)

      await joinOn(a, { dest: 'design', link: designLink })
      await until('A pulled Cynthia’s folder', () => rowsOf(a, 'design').length === 2)

      // B adopts the announcement and tells the truth about it.
      await until(
        'B marked design/ as needing a link',
        () =>
          b.mounts.has('design') &&
          b.descs().some((d) => d.room === designRoom && d.status === 'needs-token')
      )
      expect(b.notices.filter((n) => n.kind === 'needs-token')).toEqual([
        { kind: 'needs-token', path: 'design', room: designRoom },
      ])
      // A fully functional LOCAL mount that knows where its room lives: no
      // relay was resolved, so no provider exists and no record was ever
      // created for the room — the pill is never told "offline", which would
      // promise a reconnection (S10 Q2).
      expect(b.builds.find((x) => x.room === designRoom)).toMatchObject({
        path: 'design',
        token: null,
        relay: null,
      })
      expect(b.mounts.get('design')!.isShared()).toBe(false)
      expect(b.records.has(`//folder:${designRoom}`)).toBe(false)
      // Files are absent because this device never had them, not because
      // anything was deleted: the desc remembers the room's location.
      expect(rowsOf(b, 'design')).toEqual([])
      expect(Object.keys(await diskSnapshot(b)).filter((p) => p.startsWith('design/'))).toEqual([])
      expect(b.descs().find((d) => d.room === designRoom)).toMatchObject({
        path: 'design',
        provenance: 'adopted',
        relay: { url: foreignRelay.url },
        status: 'needs-token',
      })
      expect(b.errors).toEqual([])
      checkInvariants(b)

      // The status survives a reboot and is NOT rolled back or lowered: a
      // needs-token mount reopens with no relay, and the desc it writes must
      // keep both the room's location and the waiting state (S10 Q2's defect).
      const rebooted = await reboot(b)
      devices.splice(devices.indexOf(b), 1, rebooted)
      expect(rebooted.descs().find((d) => d.room === designRoom)).toMatchObject({
        relay: { url: foreignRelay.url },
        status: 'needs-token',
      })
      expect(rebooted.mounts.get('design')!.isShared()).toBe(false)
      expect(rowsOf(rebooted, 'design')).toEqual([])
      checkInvariants(rebooted)

      // One paste. The mount namespace is EMPTY (this device never held the
      // subtree), so activation rebuilds it as a first join and pulls the
      // room rather than merging with a namespace it built itself.
      await addMountLink(rebooted, 'design', designLink)
      expect(rebooted.tokens.token(designRoom)).toBe(designShare.token)
      // The EMPTY branch: the mount was rebuilt to pull its room, not
      // `enableSharing`d in place (which would have nothing to merge).
      expect(rebooted.builds.at(-1)).toMatchObject({
        room: designRoom,
        path: 'design',
        firstJoin: true,
        token: designShare.token,
        relay: foreignRelay.url,
      })
      await until('the pasted link brought the files', () => rowsOf(rebooted, 'design').length === 2)
      await until('…onto this device’s vault', async () => {
        const disk = await diskSnapshot(rebooted)
        return Object.entries(design(DESIGN_FILES)).every(([p, text]) => disk[p] === text)
      })
      await until(
        'and the mount is active',
        () => rebooted.descs().find((d) => d.room === designRoom)?.status === 'active'
      )
      expect(rebooted.mounts.get('design')!.isShared()).toBe(true)
      checkInvariants(rebooted)
      checkInvariants(a)
    },
    90_000
  )
})
