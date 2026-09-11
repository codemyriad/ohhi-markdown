/**
 * The shim's nested-mount wiring (device-link N1): `ui.mounts` as a projection
 * of mounts.json — statuses included — the derived ignore set, the mount-root
 * refusals, and `addMountLink`.
 *
 * Boots the real `setupWorkspace` over a memory adapter and a memory store
 * dir, so this is the actual wiring App.svelte gets, not a stand-in. No relay
 * is attached to the root: the peer-side machines themselves are covered by
 * libs/workspace's `nested.test.ts` against two devices.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemStoreDir, MemVaultAdapter, MountsFile } from '@editor/vault'
import { setupWorkspace, type Workspace } from './workspace.svelte.js'
import { encodeShareLink } from './share-link.js'
import { useMemStorage } from './storage.fixture.js'

beforeEach(() => useMemStorage())

const enc = new TextEncoder()
const ROOM = 'team-room'
const RELAY = 'ws://relay.test'

let open: Workspace | null = null
afterEach(() => {
  open?.dispose()
  open = null
})

/**
 * A vault holding one mount at `team/` whose desc says `needs-token`: the
 * peer-side adopt's resting state when this device holds no key for the room.
 */
async function bootWithNeedsToken(): Promise<Workspace> {
  const adapter = new MemVaultAdapter()
  await adapter.writeAtomic('keep.md', enc.encode('root note\n'))
  await adapter.writeAtomic('team/plan.md', enc.encode('shared plan\n'))
  const storeDir = new MemStoreDir()
  await new MountsFile(storeDir.io('mounts.json')).save([
    { room: ROOM, path: 'team', provenance: 'adopted', relay: { url: RELAY }, status: 'needs-token' },
  ])
  const ws = await setupWorkspace({ adapter, storeDir, user: 'T', room: 'root-room' })
  open = ws
  return ws
}

describe('the shim: mounts.json drives ui.mounts (N1)', () => {
  it('boots a needs-token mount as a provider-less session that still shows its files', async () => {
    const ws = await bootWithNeedsToken()

    expect(ws.ui.mounts).toEqual([
      {
        path: 'team',
        room: ROOM,
        provenance: 'adopted',
        link: null,
        status: 'needs-token',
        // Its room lives on a relay this vault has nothing to do with, so it
        // reads as somebody else's share (device-link N2, `isForeignMount`).
        foreign: true,
      },
    ])
    // "Keep + mark": the folder is in the tree and its note is openable — a
    // folder that vanished because a token is missing would be the dishonesty
    // golden rule 4 forbids (spike S10 Q2).
    expect(ws.ui.files.map((r) => r.path)).toContain('team/plan.md')
    expect(ws.docForPath('team/plan.md')?.getText()).toBe('shared plan\n')
    // Nothing about it reads as linked: no link, and no relay was attached.
    expect(ws.ui.linked).toBe(false)
  })

  it('refuses to carve, rename, move or delete a mount ROOT', async () => {
    const ws = await bootWithNeedsToken()
    const row = ws.ui.files.find((r) => r.path === 'team')
    // The row a mount root renders as, whether or not the vault is shared.
    expect(row?.kind).toBe('mount')

    await expect(ws.carveFolder('team')).rejects.toThrow()
    await expect(ws.renamePath('team', 'crew')).rejects.toThrow(/root of a shared folder/)
    await expect(ws.movePath('team', 'archive/team')).rejects.toThrow(/root of a shared folder/)
    await expect(ws.deletePath('team')).rejects.toThrow(/root of a shared folder/)
    // Refusing changed nothing.
    expect(ws.ui.files.map((r) => r.path)).toContain('team/plan.md')
  })

  it('addMountLink refuses a link for a different room, and activates on a matching one', async () => {
    const ws = await bootWithNeedsToken()

    await expect(
      ws.addMountLink('team', encodeShareLink({ relay: RELAY, room: 'someone-elses', token: 'x' }))
    ).rejects.toThrow(/different shared folder/)
    expect(ws.ui.mounts[0]?.status).toBe('needs-token')

    await expect(ws.addMountLink('nope', 'editor1:whatever')).rejects.toThrow()

    // The right link activates the mount IN PLACE: same session, same guids,
    // nothing re-seeded — enableSharing attaches providers to the docs it
    // already holds (spike S10 Q2).
    const guidBefore = ws.ui.files.find((r) => r.path === 'team/plan.md')!.guid
    await ws.addMountLink('team', encodeShareLink({ relay: RELAY, room: ROOM, token: 'team-token' }))
    expect(ws.ui.mounts[0]?.status).toBe('active')
    expect(ws.ui.files.find((r) => r.path === 'team/plan.md')!.guid).toBe(guidBefore)
    expect(ws.docForPath('team/plan.md')?.getText()).toBe('shared plan\n')
  })
})
