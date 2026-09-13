/**
 * L1 fixtures 4+5 (spike S8 Q4): the join-as-mount machine. The pull itself
 * is MountSession's firstJoin boot (relay-backed, covered by the L2 smoke +
 * demo-drive); here `buildSession` SIMULATES a completed pull — doc blobs
 * copied from a sharer's carved namespace plus NEVER_ON_DISK baseline LCAs,
 * exactly the store state a real pull leaves — so the machine's choreography
 * (guards, statuses, detach, live rollback, crash recovery, materialize) is
 * fuzzed deterministically with no network.
 */
import { describe, expect, it } from 'vitest'
import {
  JsonFileLcaStore,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  NEVER_ON_DISK,
  scopedAdapter,
  type StoreDir,
} from '@ohhi/vault'
import { createYjsEngine, type SyncEngine } from '@ohhi/sync'
import { carveFolder } from '../src/carve.js'
import { joinMount } from '../src/join.js'
import type { MountSession } from '../src/mount-session.js'
import { bootVault, crashingDir, dec, diskSnapshot, seedAdapter, type BootedVault } from './fixture.js'

const ROOM = 'shared-room'
const DEST = 'shared/team'

const SHARER_FILES: Record<string, string> = {
  'own.md': 'sharer local\n',
  'team/plan.md': 'shared plan\n',
  'team/notes/deep.md': 'nested shared note\n',
}
const JOINER_FILES: Record<string, string> = {
  'mine.md': 'joiner local note\n',
}

/** The carved room's store namespace = what a relay pull would deliver. */
async function buildRoomStores(): Promise<Map<string, Uint8Array>> {
  const base = await seedAdapter(SHARER_FILES)
  const dir = new MemStoreDir()
  const vault = await bootVault(base, dir, 'sharer-root')
  await carveFolder({
    root: vault.root,
    vaultDir: dir,
    mountsFile: vault.mountsFile,
    mountPath: 'team',
    room: ROOM,
    relayUrl: 'ws://relay.test',
    addIgnore: (p) => vault.ignore.add(p),
  })
  vault.dispose()
  const out = new Map<string, Uint8Array>()
  for (const name of await dir.list(`${ROOM}/`)) {
    out.set(name.slice(`${ROOM}/`.length), (await dir.io(name).read())!)
  }
  return out
}

/** Simulate the pull's store effects, then boot the mount session (reopen). */
async function simulatePullAndBoot(
  engine: SyncEngine,
  vault: BootedVault,
  base: MemVaultAdapter,
  targetDir: StoreDir,
  roomStores: Map<string, Uint8Array>
): Promise<MountSession> {
  for (const [name, bytes] of roomStores) {
    if (name.startsWith('docs/')) await targetDir.io(`${ROOM}/${name}`).writeAtomic(bytes)
  }
  const folder = engine.createDoc(`sim-pull:${Math.random()}`)
  engine.applyUpdate(folder, roomStores.get('docs/folder.bin')!, 'seed')
  const empty = engine.createDoc(`sim-empty:${Math.random()}`)
  const emptyHeads = engine.encodeHeads(engine.heads(empty))
  empty.destroy()
  const lcas = new JsonFileLcaStore(targetDir.io(`${ROOM}/lca.json`))
  for (const [path, e] of folder.getMap().entries()) {
    if (e.kind !== 'text' || e.deleted) continue
    await lcas.put({
      guid: e.guid,
      path,
      baseText: '',
      contentHash: NEVER_ON_DISK,
      heads: emptyHeads,
      eol: 'lf',
      bom: false,
    })
  }
  folder.destroy()
  return vault.makeSession(ROOM, scopedAdapter(base, DEST), DEST, { provenance: 'joined' })
}

describe('join-as-mount — guards (L1 fixture 5)', () => {
  it('rejects non-empty destinations, overlaps, and shared roots', async () => {
    const base = await seedAdapter({ ...JOINER_FILES, 'busy/file.md': 'x\n' })
    const dir = new MemStoreDir()
    const vault = await bootVault(base, dir, 'joiner-root')
    const opts = {
      vaultDir: dir,
      mountsFile: vault.mountsFile,
      root: vault.root,
      baseAdapter: base,
      existingMountPaths: ['other-mount'],
      room: ROOM,
      addIgnore: (p: string) => vault.ignore.add(p),
      removeIgnore: (p: string) => vault.ignore.delete(p),
      buildSession: () => Promise.reject(new Error('should not build')),
    }
    await expect(joinMount({ ...opts, mountPath: 'busy' })).rejects.toThrow(/not empty/)
    await expect(joinMount({ ...opts, mountPath: 'other-mount/sub' })).rejects.toThrow(/overlaps/)
    await expect(joinMount({ ...opts, mountPath: '' })).rejects.toThrow(/destination/)
    // The ROOT MAP's mount entries overlap too (M10). `existingMountPaths` is
    // mounts.json — what THIS device runs; a folder another of this person's
    // devices carved seconds ago is a `kind:'mount'` ENTRY here before it is a
    // desc, and joining at or under it would make a mount inside a mount on
    // every peer of the root (spike S10 Q5 row 11 — the guard `carveFolder`'s
    // caller has had since N1).
    const mapEntries = [{ path: 'announced' }]
    await expect(joinMount({ ...opts, mapEntries, mountPath: 'announced' })).rejects.toThrow(
      /overlaps/
    )
    await expect(joinMount({ ...opts, mapEntries, mountPath: 'announced/sub' })).rejects.toThrow(
      /overlaps/
    )
    await expect(joinMount({ ...opts, mapEntries: [{ path: 'a/b/c' }], mountPath: 'a' })).rejects.toThrow(
      /overlaps/
    )
    // Nothing was persisted by any of them.
    expect((await vault.mountsFile.load()).some((m) => m.room === ROOM)).toBe(false)
    // A SHARED root is no longer a guard (N1, device-link-shaping A5) — the
    // join proceeds and rolls back on the pull failure like any other, and the
    // announcement it made is retracted with it.
    vault.root.enableSharing({ url: 'ws://relay.test', token: 't' })
    await expect(joinMount({ ...opts, mountPath: DEST })).rejects.toThrow(/should not build/)
    expect(vault.root.mountEntries()).toEqual([])
    // No guard failure left anything behind.
    expect((await vault.mountsFile.load()).some((m) => m.room === ROOM)).toBe(false)
    expect(await dir.list(`${ROOM}/`)).toEqual([])
    vault.dispose()
  })

  it('a live pull failure rolls back immediately and a retry succeeds', async () => {
    const roomStores = await buildRoomStores()
    const base = await seedAdapter(JOINER_FILES)
    const dir = new MemStoreDir()
    const vault = await bootVault(base, dir, 'joiner-root')
    const opts = {
      vaultDir: dir,
      mountsFile: vault.mountsFile,
      root: vault.root,
      baseAdapter: base,
      existingMountPaths: [],
      mountPath: DEST,
      room: ROOM,
      addIgnore: (p: string) => vault.ignore.add(p),
      removeIgnore: (p: string) => vault.ignore.delete(p),
    }
    await expect(
      joinMount({ ...opts, buildSession: () => Promise.reject(new Error('auth rejected')) })
    ).rejects.toThrow(/auth rejected/)
    // Immediate rollback: no desc, no namespace, ignore set restored.
    expect((await vault.mountsFile.load()).some((m) => m.room === ROOM)).toBe(false)
    expect(await dir.list(`${ROOM}/`)).toEqual([])
    expect(vault.ignore.has(DEST)).toBe(false)

    // Retry with a working "pull" succeeds and materializes the files.
    const session = await joinMount({
      ...opts,
      buildSession: () => simulatePullAndBoot(vault.engine, vault, base, dir, roomStores),
    })
    expect((await vault.mountsFile.load()).find((m) => m.room === ROOM)?.status).toBe('active')
    expect(dec.decode((await base.read(`${DEST}/plan.md`))!)).toBe(SHARER_FILES['team/plan.md'])
    expect(dec.decode((await base.read(`${DEST}/notes/deep.md`))!)).toBe(
      SHARER_FILES['team/notes/deep.md']
    )
    // The joiner's own note is untouched and still root-owned.
    expect(vault.root.files().some((r) => r.path === 'mine.md')).toBe(true)
    session.dispose()
    vault.dispose()
  })
})

describe('join-as-mount — crash matrix (L1 fixture 4)', () => {
  it('killed after every possible store write, every reboot converges', async () => {
    const roomStores = await buildRoomStores()
    for (let budget = 0; budget < 80; budget++) {
      const base = await seedAdapter(JOINER_FILES)
      const dir = new MemStoreDir()
      const warm = await bootVault(base, dir, 'joiner-root')
      warm.dispose()
      const before = await diskSnapshot(base)

      const crashing = crashingDir(dir, budget)
      const vault = await bootVault(base, dir, 'joiner-root')
      const mountsFile = new MountsFile(crashing.io('mounts.json'))
      let crashed = false
      try {
        const session = await joinMount({
          vaultDir: crashing,
          mountsFile,
          root: vault.root,
          baseAdapter: base,
          existingMountPaths: [],
          mountPath: DEST,
          room: ROOM,
          addIgnore: (p) => vault.ignore.add(p),
          removeIgnore: (p) => vault.ignore.delete(p),
          buildSession: () => simulatePullAndBoot(vault.engine, vault, base, crashing, roomStores),
        })
        session.dispose()
      } catch (err) {
        crashed = true
        expect(String(err)).toContain('injected-crash')
      }
      vault.dispose()

      // Reboot from durable state only: recovery must land in a converged
      // state — either the mount is fully live or it is fully gone.
      const reboot = await bootVault(base, dir, 'joiner-root')
      const descs = await reboot.mountsFile.load()
      for (const d of descs) expect(d.status).toBe('active')
      const mount = reboot.mounts.get(DEST)
      if (mount) {
        expect(mount.files().map((r) => r.path)).toContain('plan.md')
        // Materialization may have crashed mid-way; the reboot finished it.
        expect(dec.decode((await base.read(`${DEST}/plan.md`))!)).toBe(SHARER_FILES['team/plan.md'])
        // No guid owned by two maps.
        const rootGuids = new Set(reboot.root.files().map((r) => r.guid))
        for (const row of mount.files()) expect(rootGuids.has(row.guid)).toBe(false)
      } else {
        expect(descs.some((d) => d.room === ROOM)).toBe(false)
        expect(await dir.list(`${ROOM}/`)).toEqual([])
        // The joiner's own files never changed.
        expect(await diskSnapshot(base)).toEqual(before)
      }
      expect(reboot.root.files().some((r) => r.path === 'mine.md')).toBe(true)
      reboot.dispose()
      if (!crashed) return // the whole matrix is covered
    }
    throw new Error('crash budget never reached the happy path — raise the sweep bound')
  }, 30_000)
})
