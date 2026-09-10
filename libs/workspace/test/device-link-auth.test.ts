/**
 * R5 through a `MountSession`, and the honesty of revocation (slice N3;
 * device-link-shaping.md R5 + dogfood R4.3; spike S10 Q3).
 *
 * `apps/relay/test/ancestry.test.ts` pins the auth RULE at the relay's own
 * seam: which token kind reaches which room. This file pins what a client does
 * with the answer — because a refusal that surfaces as a silent reconnect loop
 * is, from the product's side, indistinguishable from a slow relay, and
 * golden rule 4 forbids exactly that kind of quiet.
 *
 * The shape of every probe: one empty vault attached to one room with one
 * token, so exactly one document is offered to `onAuthenticate` and exactly
 * one auth outcome is reported.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MemVaultAdapter } from '@editor/vault'
import {
  bootDevice,
  memDir,
  mintShare,
  mountSynced,
  probeAuth,
  revokeShare,
  rowsOf,
  seedAdapter,
  startTestRelay,
  TokenStore,
  until,
  type AuthProbe,
  type Device,
  type TestRelay,
} from './device-link-harness.js'

const FILES: Record<string, string> = {
  'inbox.md': 'root note\n',
  'notes/one.md': 'the first note\n',
}

/** The rejection `reportAuthFailure` turns a permission-denied into. */
const REFUSED = /relay rejected this token \(permission-denied\)/

describe('R5: a folder token never grants the vault, and a refusal is permanent', () => {
  let relay: TestRelay
  const probes: AuthProbe[] = []

  beforeAll(async () => {
    relay = await startTestRelay('device-link-auth')
  }, 60_000)

  afterAll(async () => {
    await relay?.stop()
  }, 30_000)

  afterEach(async () => {
    for (const probe of probes.splice(0)) await probe.shutdown()
  })

  const probe = async (room: string, token: string): Promise<AuthProbe> => {
    const p = await probeAuth({ relayUrl: relay.url, room, token })
    probes.push(p)
    return p
  }

  it(
    'refuses a folder token on the vault and on a sibling carve, and a foreign device token on a carve',
    async () => {
      // One vault, two folders carved out of it, and a SECOND vault whose own
      // device token has no business in the first vault's rooms.
      const vault = crypto.randomUUID()
      const team = crypto.randomUUID()
      const crew = crypto.randomUUID()
      const otherVault = crypto.randomUUID()

      const vaultLink = await mintShare(relay, { folderGuid: vault, kind: 'device' })
      const teamShare = await mintShare(relay, { folderGuid: team, parent: vault })
      await mintShare(relay, { folderGuid: crew, parent: vault })
      const otherLink = await mintShare(relay, { folderGuid: otherVault, kind: 'device' })

      // (1) the folder token, used on the vault it was carved out of.
      const onVault = await probe(vault, teamShare.token)
      await until('the vault refused the folder token', () => onVault.errors.length > 0)
      expect(onVault.errors[0]).toMatch(REFUSED)

      // (2) the same folder token, used on a sibling carve of that vault.
      const onSibling = await probe(crew, teamShare.token)
      await until('the sibling refused the folder token', () => onSibling.errors.length > 0)
      expect(onSibling.errors[0]).toMatch(REFUSED)

      // (3) another vault's DEVICE token, used on this vault's carve. The
      // ancestry edge exists (team was carved out of vault) — it just does not
      // lead to `otherVault`. Ancestry is structure, never a credential.
      const onForeignDevice = await probe(team, otherLink.token)
      await until('the carve refused the other vault’s device token', () => onForeignDevice.errors.length > 0)
      expect(onForeignDevice.errors[0]).toMatch(REFUSED)

      // Every refusal is honest in the record too: not connected, not synced.
      for (const p of [onVault, onSibling, onForeignDevice]) {
        expect(p.record.connected).toBe(false)
        expect(p.record.synced).toBe(false)
      }

      // The control: the vault's own device token DOES reach the carve, so
      // the three refusals above are about the rule and not about the setup.
      const allowed = await probe(team, vaultLink.token)
      await until('the device token reached the carve', () => allowed.record.synced)
      expect(allowed.errors).toEqual([])
    },
    60_000
  )

  it(
    'reports a refusal once — a permanent error, not a reconnect loop',
    async () => {
      const vault = crypto.randomUUID()
      const team = crypto.randomUUID()
      await mintShare(relay, { folderGuid: vault, kind: 'device' })
      const teamShare = await mintShare(relay, { folderGuid: team, parent: vault })

      const refused = await probe(vault, teamShare.token)
      await until('the refusal surfaced', () => refused.errors.length > 0)
      // Fast, not waited out: `whenSynced`'s dead-relay backstop is 60s, and a
      // refusal that arrived on that budget would read to a user as a hang.
      expect(refused.reportedAfterMs).toBeLessThan(10_000)
      const first = refused.errors.length

      // A negative claim needs an observation window, and this one is about a
      // real socket: nothing further may arrive. Hocuspocus answers a rejected
      // document with permission-denied and leaves the CONNECTION up (auth is
      // per document), so a retry would show up here as a second report.
      await new Promise((r) => setTimeout(r, 1_000))
      expect(refused.errors.length).toBe(first)
      expect(refused.record.connected).toBe(false)
    },
    60_000
  )
})

describe('revocation honesty (dogfood R4.3)', () => {
  let relay: TestRelay
  const devices: Device[] = []
  const probes: AuthProbe[] = []

  beforeAll(async () => {
    relay = await startTestRelay('device-link-revoke')
  }, 60_000)

  afterAll(async () => {
    await relay?.stop()
  }, 30_000)

  afterEach(async () => {
    for (const p of probes.splice(0)) await p.shutdown()
    for (const dev of devices.splice(0)) await dev.shutdown()
  })

  it(
    'blocks a NEW connection while an already-open one keeps syncing',
    async () => {
      const vault = crypto.randomUUID()
      const link = await mintShare(relay, { folderGuid: vault, kind: 'device' })

      const tokensA = new TokenStore(relay.url)
      tokensA.set(vault, link.token, relay.url, 'device')
      const a = await bootDevice({
        id: 'A',
        adapter: await seedAdapter(FILES),
        vaultDir: memDir(),
        rootRoom: vault,
        relayUrl: relay.url,
        tokens: tokensA,
      })
      devices.push(a)
      await until('A acked the vault', () => mountSynced(a, ''))

      const tokensB = new TokenStore(relay.url)
      tokensB.set(vault, link.token, relay.url, 'device')
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
      await until('B pulled the vault', () => rowsOf(b, '').length === 2)

      // Revoke the device credential both devices are connected on.
      await revokeShare(relay, link.token)

      // The recorded limit, pinned rather than assumed: auth happens when a
      // document is opened, so the sockets that are already up keep syncing.
      // Live-drop revocation is dogfood R4.3, still deferred.
      a.root.docForPath('notes/one.md')!.transact((t) => t.insert(0, 'after the revoke: '), 'local')
      await until(
        'the open connection still delivers',
        () => b.root.docForPath('notes/one.md')?.getText().startsWith('after the revoke: ') === true
      )
      expect(b.errors).toEqual([])

      // …and the half that IS enforced today: the next connection made with
      // that credential — B's next reboot, or any new mount — is refused, and
      // says so as a permanent error rather than a silent retry.
      const next = await probeAuth({ relayUrl: relay.url, room: vault, token: link.token })
      probes.push(next)
      await until('the new connection was refused', () => next.errors.length > 0)
      expect(next.errors[0]).toMatch(REFUSED)
      expect(next.record.connected).toBe(false)
      expect(next.record.synced).toBe(false)
    },
    90_000
  )
})
