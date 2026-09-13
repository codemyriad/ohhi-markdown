/**
 * L1 fixture 6 (spike S8 Q5): cross-boundary moves. In-app moves are
 * import-with-fresh-guid + tombstone-source (identity never crosses rooms);
 * external moves surface a 'vanished' review on the source side (never
 * silent loss — including a concurrent remote edit to the moved-away doc)
 * and the target side picks the file up via the delta scan.
 */
import { describe, expect, it } from 'vitest'
import { MemStoreDir } from '@ohhi/vault'
import { carveFolder } from '../src/carve.js'
import { bootVault, dec, enc, seedAdapter, type BootedVault } from './fixture.js'
import type { MemVaultAdapter } from '@ohhi/vault'

const ROOT_ROOM = 'root-room'
const ROOM = 'carved-room'

const FILES: Record<string, string> = {
  'keep.md': 'root-local note\n',
  'team/plan.md': 'shared plan\n',
}

async function carvedVault(): Promise<{ base: MemVaultAdapter; vault: BootedVault }> {
  const base = await seedAdapter(FILES)
  const dir = new MemStoreDir()
  const first = await bootVault(base, dir, ROOT_ROOM)
  await carveFolder({
    root: first.root,
    vaultDir: dir,
    mountsFile: first.mountsFile,
    mountPath: 'team',
    room: ROOM,
    relayUrl: 'ws://relay.test',
    addIgnore: (p) => first.ignore.add(p),
  })
  first.dispose()
  const vault = await bootVault(base, dir, ROOT_ROOM)
  return { base, vault }
}

/** Drive the clock through quiesce/reconcile debounces with microtask yields. */
async function settle(vault: BootedVault, rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    vault.clock.advance(300)
    await new Promise((r) => setTimeout(r, 0))
  }
}

describe('cross-boundary moves — in-app (import + tombstone)', () => {
  it('root → mount: fresh guid in the room, source tombstoned, bytes correct', async () => {
    const { base, vault } = await carvedVault()
    const mount = vault.mounts.get('team')!
    const oldGuid = vault.root.files().find((r) => r.path === 'keep.md')!.guid

    const bytes = await vault.root.readFileBytes('keep.md')
    await mount.importFile('keep.md', bytes!)
    await vault.root.deletePath('keep.md')

    expect(dec.decode((await base.read('team/keep.md'))!)).toBe(FILES['keep.md'])
    const row = mount.files().find((r) => r.path === 'keep.md')!
    expect(row.guid).not.toBe(oldGuid) // identity never crosses rooms
    expect(mount.docForPath('keep.md')?.getText()).toBe(FILES['keep.md'])
    expect(vault.root.files().some((r) => r.path === 'keep.md')).toBe(false)
    vault.dispose()
  })

  it('mount → root: peers of the room see a tombstone; root owns a fresh copy', async () => {
    const { base, vault } = await carvedVault()
    const mount = vault.mounts.get('team')!

    const bytes = await mount.readFileBytes('plan.md')
    await vault.root.importFile('plan-local.md', bytes!)
    await mount.deletePath('plan.md')

    expect(dec.decode((await base.read('plan-local.md'))!)).toBe(FILES['team/plan.md'])
    expect(vault.root.files().some((r) => r.path === 'plan-local.md')).toBe(true)
    expect(mount.files().some((r) => r.path === 'plan.md')).toBe(false)
    expect(await base.read('team/plan.md')).toBeNull()
    vault.dispose()
  })
})

describe('cross-boundary moves — external (watcher + review)', () => {
  it('a file dragged out of the mount surfaces a vanished review; a remote edit to it is never lost', async () => {
    const { base, vault } = await carvedVault()
    const mount = vault.mounts.get('team')!
    const guid = mount.files().find((r) => r.path === 'plan.md')!.guid

    // External writer moves the file out of the shared folder on disk.
    await base.rename('team/plan.md', 'plan-escaped.md')
    await settle(vault)
    expect(vault.events.reviews.some((r) => r.guid === guid && r.reason === 'vanished')).toBe(true)

    // A "remote peer" edits the moved-away doc: build a twin, edit, apply the
    // diff with a provider-shaped (foreign object) origin.
    const doc = mount.docForPath('plan.md')
    expect(doc).not.toBeNull() // tree row still exists while the review is open
    const heads = vault.engine.heads(doc!)
    const twin = vault.engine.createDoc('twin')
    vault.engine.applyUpdate(twin, vault.engine.encodeUpdateSince(doc!, null), 'seed')
    twin.transact((t) => t.insert(0, 'REMOTE EDIT\n'), 'local')
    vault.engine.applyUpdate(doc!, vault.engine.encodeUpdateSince(twin, heads), {} as never)
    twin.destroy()
    await settle(vault)

    // Restoring resolves with the remote edit intact — nothing was lost.
    await mount.resolveVanished(guid, 'restore')
    expect(dec.decode((await base.read('team/plan.md'))!)).toBe(`REMOTE EDIT\n${FILES['team/plan.md']}`)
    vault.dispose()
  })

  it('the escaped file re-enrolls on the target side via the delta scan', async () => {
    const { base, vault } = await carvedVault()
    await base.rename('team/plan.md', 'plan-escaped.md')
    await settle(vault)
    await vault.root.rescan()
    const row = vault.root.files().find((r) => r.path === 'plan-escaped.md')
    expect(row).toBeDefined()
    expect(vault.root.docForPath('plan-escaped.md')?.getText()).toBe(FILES['team/plan.md'])
    vault.dispose()
  })

  it('confirming a removal tombstones for peers and journals the shadow copy', async () => {
    const { base, vault } = await carvedVault()
    const mount = vault.mounts.get('team')!
    const guid = mount.files().find((r) => r.path === 'plan.md')!.guid
    await base.remove('team/plan.md')
    await settle(vault)
    expect(vault.events.reviews.some((r) => r.guid === guid && r.reason === 'vanished')).toBe(true)

    await mount.resolveVanished(guid, 'remove')
    expect(mount.files().some((r) => r.path === 'plan.md')).toBe(false)
    expect(await base.read('team/plan.md')).toBeNull()
    vault.dispose()
  })

  it('an EMPTY doc whose file vanishes auto-confirms removal (no nag)', async () => {
    const { base, vault } = await carvedVault()
    const mount = vault.mounts.get('team')!
    await base.writeAtomic('team/empty.md', enc.encode(''))
    await settle(vault)
    await mount.rescan() // enroll the new file
    expect(mount.files().some((r) => r.path === 'empty.md')).toBe(true)

    await base.remove('team/empty.md')
    await settle(vault)
    const guid = null // the review never surfaced; the row is gone
    expect(vault.events.reviews.filter((r) => r.path === 'empty.md')).toEqual([])
    expect(mount.files().some((r) => r.path === 'empty.md')).toBe(false)
    expect(guid).toBeNull()
    vault.dispose()
  })
})
