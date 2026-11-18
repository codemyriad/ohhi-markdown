/**
 * L1 fixture 7 (spike S8 Q6): the unshare fold-back and unmount machines.
 * Crash matrix: killed after every possible store write, every reboot must
 * converge — files under exactly one map, statuses all 'active' (or the
 * entry cleanly gone), not a single disk byte changed by unshare.
 */
import { describe, expect, it } from 'vitest'
import { MemStoreDir, MountsFile, type StoreDir } from '@ohhi/vault'
import { carveFolder } from '../src/carve.js'
import { unmountMount, unshareMount } from '../src/unshare.js'
import { bootVault, crashingDir, diskSnapshot, seedAdapter, type BootedVault } from './fixture.js'
import type { MemVaultAdapter } from '@ohhi/vault'

const ROOT_ROOM = 'root-room'
const ROOM = 'carved-room'

const FILES: Record<string, string> = {
  'keep.md': 'stays local\n',
  'team/plan.md': 'shared plan\n',
  'team/notes/deep.md': 'nested shared note\n',
}

/** A vault with `team/` already carved into its own mount, freshly rebooted. */
async function carvedVault(): Promise<{ base: MemVaultAdapter; dir: MemStoreDir; vault: BootedVault }> {
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
  return { base, dir, vault }
}

async function runUnshare(vault: BootedVault, dir: StoreDir): Promise<void> {
  const mount = vault.mounts.get('team')!
  await unshareMount({
    vaultDir: dir,
    mountsFile: new MountsFile(dir.io('mounts.json')),
    engine: vault.engine,
    rootRoom: ROOT_ROOM,
    desc: { room: ROOM, path: 'team' },
    mount,
    root: vault.root,
    removeIgnore: (p) => vault.ignore.delete(p),
  })
}

describe('unshare — fold a mount back into the vault', () => {
  it('happy path: root owns the subtree again, same guids, namespace gone, disk untouched', async () => {
    const { base, dir, vault } = await carvedVault()
    const before = await diskSnapshot(base)
    const mountGuid = vault.mounts.get('team')!.files().find((r) => r.path === 'plan.md')!.guid

    await runUnshare(vault, dir)

    const reboot = await bootVault(base, dir, ROOT_ROOM)
    expect(reboot.mounts.size).toBe(0)
    expect((await reboot.mountsFile.load()).some((m) => m.room === ROOM)).toBe(false)
    expect(await dir.list(`${ROOM}/`)).toEqual([])
    const rows = reboot.root.files().filter((r) => r.kind === 'text')
    expect(new Set(rows.map((r) => r.path))).toEqual(
      new Set(['keep.md', 'team/plan.md', 'team/notes/deep.md'])
    )
    // Content identity survives the fold-back (same guid, same text).
    expect(rows.find((r) => r.path === 'team/plan.md')!.guid).toBe(mountGuid)
    expect(reboot.root.docForPath('team/plan.md')?.getText()).toBe(FILES['team/plan.md'])
    expect(await diskSnapshot(base)).toEqual(before)
    reboot.dispose()
  })

  it('crash matrix: killed after every possible store write, every reboot converges', async () => {
    for (let budget = 0; budget < 60; budget++) {
      const { base, dir, vault } = await carvedVault()
      const before = await diskSnapshot(base)

      const crashing = crashingDir(dir, budget)
      let crashed = false
      try {
        const mount = vault.mounts.get('team')!
        await unshareMount({
          vaultDir: crashing,
          mountsFile: new MountsFile(crashing.io('mounts.json')),
          engine: vault.engine,
          rootRoom: ROOT_ROOM,
          desc: { room: ROOM, path: 'team' },
          mount,
          root: vault.root,
          removeIgnore: (p) => vault.ignore.delete(p),
        })
      } catch (err) {
        crashed = true
        expect(String(err)).toContain('injected-crash')
      }
      vault.dispose()

      const reboot = await bootVault(base, dir, ROOT_ROOM)
      expect(await diskSnapshot(base)).toEqual(before)
      for (const d of await reboot.mountsFile.load()) expect(d.status).toBe('active')
      const mount = reboot.mounts.get('team')
      const rootPaths = new Set(reboot.root.files().filter((r) => r.kind === 'text').map((r) => r.path))
      if (mount) {
        // Crash before the machine got anywhere: the mount still owns the subtree.
        expect(new Set(mount.files().filter((r) => r.kind === 'text').map((r) => r.path))).toEqual(
          new Set(['plan.md', 'notes/deep.md'])
        )
        expect(rootPaths).toEqual(new Set(['keep.md']))
      } else {
        // Rolled forward: root owns everything, stores gone.
        expect(rootPaths).toEqual(new Set(Object.keys(FILES)))
        expect(await dir.list(`${ROOM}/`)).toEqual([])
        expect(reboot.root.docForPath('team/plan.md')?.getText()).toBe(FILES['team/plan.md'])
      }
      reboot.dispose()
      if (!crashed) return
    }
    throw new Error('crash budget never reached the happy path — raise the sweep bound')
  }, 30_000)
})

describe('unmount — drop a mount, files become local', () => {
  it('teardown + rescan re-enrolls the files as local notes with fresh guids', async () => {
    const { base, dir, vault } = await carvedVault()
    const before = await diskSnapshot(base)
    const mount = vault.mounts.get('team')!
    const oldGuid = mount.files().find((r) => r.path === 'plan.md')!.guid

    await unmountMount({
      vaultDir: dir,
      mountsFile: new MountsFile(dir.io('mounts.json')),
      engine: vault.engine,
      rootRoom: ROOT_ROOM,
      desc: { room: ROOM, path: 'team' },
      mount,
      removeIgnore: (p) => vault.ignore.delete(p),
    })
    // The shim re-reads mounts.json before the rescan (`reloadMounts`): with a
    // stale mirror the next ignore refresh hides the folder again mid-scan.
    await vault.refreshDescs()
    await vault.root.rescan()

    expect(await diskSnapshot(base)).toEqual(before) // files stayed
    expect((await new MountsFile(dir.io('mounts.json')).load()).some((m) => m.room === ROOM)).toBe(false)
    expect(await dir.list(`${ROOM}/`)).toEqual([])
    const rows = vault.root.files().filter((r) => r.kind === 'text')
    expect(new Set(rows.map((r) => r.path))).toEqual(
      new Set(['keep.md', 'team/plan.md', 'team/notes/deep.md'])
    )
    // Newly-local files get FRESH identities — they left the room for good.
    expect(rows.find((r) => r.path === 'team/plan.md')!.guid).not.toBe(oldGuid)
    vault.dispose()
  })
})
