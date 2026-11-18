/**
 * A note open while its folder is shared (carved): the doc a host resolves
 * for the open path after the carve is the NEW mount's, and an edit made
 * through it reaches the relay — while the instance the view held before the
 * carve is a dead end.
 *
 * The host (`apps/web` workspace.svelte.ts) resolves a path through a
 * `MountRegistry` to `session.docForPath`; a pane that kept the instance it
 * resolved before the carve kept typing into a doc no session syncs any
 * more. This pins the workspace half of the contract the pane relies on: the
 * instance changes across a carve (so "re-resolve after the surgery" is the
 * whole fix), and the re-resolved one is live on the relay.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { MemVaultAdapter } from '@ohhi/vault'
import { MountRegistry } from '../src/registry.js'
import {
  bootDevice,
  carveOn,
  memDir,
  mintShare,
  mountSynced,
  seedAdapter,
  startTestRelay,
  TokenStore,
  until,
  type Device,
  type TestRelay,
} from './device-link-harness.js'

const FILES: Record<string, string> = {
  'inbox.md': 'root note\n',
  'team/plan.md': 'the plan\n',
}

describe('a note open while its folder is shared', () => {
  let relay: TestRelay
  const devices: Device[] = []

  beforeAll(async () => {
    relay = await startTestRelay('carve-open-doc')
  }, 60_000)

  afterAll(async () => {
    await relay?.stop()
  }, 30_000)

  afterEach(async () => {
    for (const dev of devices.splice(0)) await dev.shutdown()
  })

  it(
    'resolves to the new mount’s doc after the carve, and an edit through it reaches the other device',
    async () => {
      const vault = crypto.randomUUID()
      const { token } = await mintShare(relay, { folderGuid: vault, kind: 'device' })
      const boot = async (id: string, files: Record<string, string> | null): Promise<Device> => {
        const tokens = new TokenStore(relay.url)
        tokens.set(vault, token, relay.url, 'device')
        const dev = await bootDevice({
          id,
          adapter: files ? await seedAdapter(files) : new MemVaultAdapter(),
          vaultDir: memDir(),
          rootRoom: vault,
          relayUrl: relay.url,
          tokens,
          ...(files ? {} : { firstJoin: true }),
        })
        devices.push(dev)
        return dev
      }
      const a = await boot('A', FILES)
      await until('A acked the vault', () => mountSynced(a, ''))
      const b = await boot('B', null)
      await until('B acked the vault', () => mountSynced(b, ''))

      // The host's resolution, as the shim does it.
      const registry = new MountRegistry()
      registry.add('', a.root)
      const resolve = (path: string) => {
        const r = registry.resolve(path)
        return r ? r.session.docForPath(r.rel) : null
      }
      a.root.setOpenPaths(new Set(['team/plan.md']))
      const before = resolve('team/plan.md')!
      expect(before.getText()).toBe('the plan\n')

      const teamRoom = crypto.randomUUID()
      const teamShare = await mintShare(relay, { folderGuid: teamRoom, parent: vault })
      const team = await carveOn(a, { path: 'team', room: teamRoom, token: teamShare.token })
      registry.add('team', team)
      team.setOpenPaths(new Set(['plan.md']))

      const after = resolve('team/plan.md')!
      // A different instance: whoever held the old one must re-resolve.
      expect(after).not.toBe(before)
      expect(after.getText()).toBe('the plan\n')

      await until('B adopted team/', () => b.mounts.has('team'))
      await until('A synced the team room', () => mountSynced(a, 'team'))
      // The stale instance is a dead end: nothing typed into it goes anywhere…
      before.transact((t) => t.insert(0, 'lost '), 'local')
      // …while the re-resolved one is the room's.
      after.transact((t) => t.insert(0, 'kept '), 'local')
      await until(
        'the edit reached B',
        () => b.mounts.get('team')?.docForPath('plan.md')?.getText() === 'kept the plan\n'
      )
      expect(after.getText()).toBe('kept the plan\n')
    },
    90_000
  )
})
