/**
 * L1 fixtures for nested mounts (slice N1, spike S10 Q1/Q5): the PEER side of
 * a carve. A carves `team/` out of a room B is also a peer of; B must end up
 * with those files in their own mount — same doc guids, its parent namespace
 * scrubbed, its ignore set covering the boundary — without a byte moving on
 * disk and without anyone re-importing content that already exists.
 *
 * Every test asserts A6's invariant (`checkInvariants`) as well as its own
 * subject: every guid in exactly one mount namespace, every path in exactly
 * one map, nothing under a mount boundary, and mounts.json ⟷ registry ⟷
 * ignore set naming the same roots.
 */
import { describe, expect, it } from 'vitest'
import {
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedAdapter,
  type StoreDir,
} from '@editor/vault'
import {
  applyForeignCarve,
  applyForeignMap,
  bootDuo,
  bootVault,
  carveOn,
  checkInvariants,
  crashingDir,
  dec,
  diskSnapshot,
  enc,
  seedAdapter,
  type BootedVault,
} from './fixture.js'
import { carveFolder } from '../src/carve.js'
import {
  reconcileMountEntries,
  type AdoptContext,
  type AdoptedMountOptions,
} from '../src/adopt.js'
import type { RelayConfig } from '../src/types.js'
import { unshareMount } from '../src/unshare.js'
import { joinMount } from '../src/join.js'

const FILES: Record<string, string> = {
  'keep.md': 'stays in the root vault\n',
  'team/plan.md': 'shared plan\n',
  'team/notes/deep.md': 'nested shared note\n',
}
const DEEP_FILES: Record<string, string> = { ...FILES, 'team/sub/nested.md': 'inner note\n' }
const TEAM_ROOM = 'team-room'
const SUB_ROOM = 'sub-room'
const RELAY = 'ws://relay.test'
const TEAM_TOKEN = { url: RELAY, token: 'team-token' }

/** Mount-relative text rows of a device's mount at `path`. */
function mountRows(dev: BootedVault, path: string): { path: string; guid: string }[] {
  const session = dev.mounts.get(path)
  if (!session) return []
  return session
    .files()
    .filter((r) => r.kind === 'text')
    .map((r) => ({ path: r.path, guid: r.guid }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

function rootTextPaths(dev: BootedVault): Set<string> {
  return new Set(dev.root.files().filter((r) => r.kind === 'text').map((r) => r.path))
}

describe('nested mounts — the peer adopts a live carve (S10 Q1)', () => {
  it('same guids, mount namespace, parent scrubbed, ignore set updated, disk untouched', async () => {
    const duo = await bootDuo({ files: FILES, tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]) })
    try {
      await duo.deliver()
      const beforeB = await diskSnapshot(duo.b.adapter)
      const guidsBefore = new Map(
        duo.b.root
          .files()
          .filter((r) => r.path.startsWith('team/') && r.kind === 'text')
          .map((r) => [r.path, r.guid])
      )
      expect(guidsBefore.size).toBe(2)

      // A carves; the detach transaction announces the mount to the room.
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()

      // B adopted it: a mount at the same path, holding the SAME doc guids —
      // no content crossed a room, nothing was re-imported.
      expect(duo.b.mounts.has('team')).toBe(true)
      expect(mountRows(duo.b, 'team')).toEqual([
        { path: 'notes/deep.md', guid: guidsBefore.get('team/notes/deep.md')! },
        { path: 'plan.md', guid: guidsBefore.get('team/plan.md')! },
      ])
      expect(duo.b.mounts.get('team')!.docForPath('plan.md')?.getText()).toBe(FILES['team/plan.md'])

      // B's parent namespace is scrubbed: no keys under the boundary, no LCA
      // records for the moved guids, and the boundary itself is the ignore set.
      expect(rootTextPaths(duo.b)).toEqual(new Set(['keep.md']))
      const rootLcas = await duo.b.root.lcaRecords()
      expect(rootLcas.map((r) => r.path).sort()).toEqual(['keep.md'])
      expect([...duo.b.ignore]).toEqual(['team'])

      // The desc records where it came from and where its room lives.
      expect(duo.b.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        path: 'team',
        provenance: 'adopted',
        relay: { url: RELAY },
        status: 'active',
      })

      // Not one byte moved on B's disk.
      expect(await diskSnapshot(duo.b.adapter)).toEqual(beforeB)
      checkInvariants(duo.b)
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })

  it('adopts at reopen when the device was offline during the carve', async () => {
    const duo = await bootDuo({ files: FILES, tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]) })
    try {
      await duo.deliver()
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()
      // Still nothing on B: it never saw the transaction.
      expect(duo.b.mounts.has('team')).toBe(false)
      expect(rootTextPaths(duo.b)).toEqual(new Set(Object.keys(FILES)))

      // B reboots (its stores are pre-carve), comes back online, and the map
      // arrives as a foreign change — the same adopt, from the boot pass.
      const before = await diskSnapshot(duo.b.adapter)
      await duo.reboot('b')
      duo.net.setOffline('B', false)
      await duo.deliver()

      expect(mountRows(duo.b, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])
      expect(rootTextPaths(duo.b)).toEqual(new Set(['keep.md']))
      expect(await diskSnapshot(duo.b.adapter)).toEqual(before)
      checkInvariants(duo.b)
    } finally {
      duo.dispose()
    }
  })

  it('no token → needs-token: a provider-less mount, activated later with no re-seed', async () => {
    // B holds no token for the carved room (A4-C's paste-once case).
    const duo = await bootDuo({ files: FILES })
    try {
      await duo.deliver()
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()

      const mount = duo.b.mounts.get('team')!
      expect(duo.b.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        status: 'needs-token',
        relay: { url: RELAY }, // the room's location survives with no credential
      })
      expect(mount.isShared()).toBe(false)
      // "Keep + mark": the files are here, readable, and reconciling to disk.
      expect(mountRows(duo.b, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])
      expect(mount.docForPath('plan.md')?.getText()).toBe(FILES['team/plan.md'])
      expect(duo.b.events.notices.some((n) => n.kind === 'needs-token')).toBe(true)
      checkInvariants(duo.b)

      // The paste: enableSharing in place. Nothing re-seeds — same guids, same
      // blobs — and the desc merges to 'active' keeping its relay.
      const blobsBefore = await duo.b.vaultDir.list(`${TEAM_ROOM}/`)
      const guidsBefore = mountRows(duo.b, 'team')
      mount.enableSharing(TEAM_TOKEN)
      await duo.deliver()
      expect(mount.isShared()).toBe(true)
      expect(mountRows(duo.b, 'team')).toEqual(guidsBefore)
      expect(await duo.b.vaultDir.list(`${TEAM_ROOM}/`)).toEqual(blobsBefore)
      expect(duo.b.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        status: 'active',
        relay: { url: RELAY },
      })
      checkInvariants(duo.b)
    } finally {
      duo.dispose()
    }
  })

  it('an empty M(P) becomes a firstJoin (a foreign share, or a wiped device)', async () => {
    // A peer joined someone else's room at `guest/` inside the shared root, so
    // the entry announces a room whose files this device never held: there is
    // nothing to seed and the mount must PULL (S10 Q1's firstJoin rule, Q7).
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      await dev.root.setMountEntry('guest', 'guest-room', 'ws://cynthia.relay')
      const built: { room: string; firstJoin?: boolean }[] = []
      await reconcileMountEntries(
        adoptCtx(dev, {
          relay: { url: 'ws://cynthia.relay', token: 'guest-token' },
          onBuild: (o) => built.push({ room: o.room, firstJoin: o.firstJoin }),
        })
      )

      expect(built).toEqual([{ room: 'guest-room', firstJoin: true }])
      expect((await dev.mountsFile.load()).find((d) => d.room === 'guest-room')).toMatchObject({
        path: 'guest',
        provenance: 'adopted',
        relay: { url: 'ws://cynthia.relay' },
        status: 'active',
      })
    } finally {
      dev.dispose()
    }
  })

  it('with no token, an empty adopt waits as needs-token instead of pulling', async () => {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      await dev.root.setMountEntry('guest', 'guest-room', 'ws://cynthia.relay')
      const built: { room: string; firstJoin?: boolean }[] = []
      await reconcileMountEntries(
        adoptCtx(dev, { relay: null, onBuild: (o) => built.push({ room: o.room, firstJoin: o.firstJoin }) })
      )
      // Never a firstJoin without a credential: the pull would hang on a
      // provider that is never allowed to connect.
      expect(built).toEqual([{ room: 'guest-room', firstJoin: false }])
      expect((await dev.mountsFile.load()).find((d) => d.room === 'guest-room')?.status).toBe(
        'needs-token'
      )
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — the owner unshares (S10 Q1(b))', () => {
  it("the owner's reverse transaction puts the subtree back and replaces the mount entry", async () => {
    const duo = await bootDuo({ files: FILES, tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]) })
    try {
      await duo.deliver()
      const guids = new Map(
        duo.a.root.files().filter((r) => r.kind === 'text').map((r) => [r.path, r.guid])
      )
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()

      const mount = duo.a.mounts.get('team')!
      duo.a.mounts.delete('team')
      await unshareMount({
        vaultDir: duo.a.vaultDir,
        mountsFile: duo.a.mountsFile,
        engine: duo.a.engine,
        rootRoom: 'root-room',
        desc: { room: TEAM_ROOM, path: 'team' },
        mount,
        root: duo.a.root,
        removeIgnore: (p) => duo.a.ignore.delete(p),
      })
      // The shim's rebuildRoot: the surgery ran with both sessions down.
      const rebooted = await duo.reboot('a')

      // One transaction, on the LIVE map: 'team' is a dir again and every
      // child is back with its ORIGINAL guid.
      expect(rebooted.root.mountEntries()).toEqual([])
      expect(rebooted.root.files().find((r) => r.path === 'team')?.kind).toBe('dir')
      expect(rootTextPaths(rebooted)).toEqual(new Set(Object.keys(FILES)))
      expect(rebooted.root.files().find((r) => r.path === 'team/plan.md')?.guid).toBe(
        guids.get('team/plan.md')
      )
      expect(rebooted.root.docForPath('team/plan.md')?.getText()).toBe(FILES['team/plan.md'])
      checkInvariants(rebooted)
    } finally {
      duo.dispose()
    }
  })

  it('the peer absorbs it back: no map write of its own, and a single doc history', async () => {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    try {
      await duo.deliver()
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()
      expect(duo.b.mounts.has('team')).toBe(true)
      const beforeB = await diskSnapshot(duo.b.adapter)

      const mount = duo.a.mounts.get('team')!
      duo.a.mounts.delete('team')
      await unshareMount({
        vaultDir: duo.a.vaultDir,
        mountsFile: duo.a.mountsFile,
        engine: duo.a.engine,
        rootRoom: 'root-room',
        desc: { room: TEAM_ROOM, path: 'team' },
        mount,
        root: duo.a.root,
        removeIgnore: (p) => duo.a.ignore.delete(p),
      })
      await duo.reboot('a')
      await duo.deliver()

      // B folded the mount back: no desc, no namespace, files in the root map.
      expect(duo.b.descs().some((d) => d.room === TEAM_ROOM)).toBe(false)
      expect(await duo.b.vaultDir.list(`${TEAM_ROOM}/`)).toEqual([])
      expect(duo.b.mounts.has('team')).toBe(false)
      expect(rootTextPaths(duo.b)).toEqual(new Set(Object.keys(FILES)))
      expect(duo.b.ignore.size).toBe(0)

      // The whole point: ONE history per guid. A live root would have adopted
      // the returning entries, invented an empty doc, and ingested the file
      // into a second history — which shows up as the text twice.
      expect(duo.b.root.docForPath('team/plan.md')?.getText()).toBe(FILES['team/plan.md'])
      expect(duo.b.root.docForPath('team/notes/deep.md')?.getText()).toBe(
        FILES['team/notes/deep.md']
      )
      expect(await diskSnapshot(duo.b.adapter)).toEqual(beforeB)
      expect(duo.b.events.notices.some((n) => n.kind === 'absorbed')).toBe(true)
      checkInvariants(duo.b)
    } finally {
      duo.dispose()
    }
  })

  it('cancels an adopt the owner unshared underneath it (Q5 row 13)', async () => {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      const before = await diskSnapshot(base)
      const rootPathsBefore = rootTextPaths(dev)
      // What the owner's absorb will put back (mount-relative, as it holds it).
      const subtree = dev.root
        .mapEntries()
        .filter(([p]) => p.startsWith('team/'))
        .map(([p, e]) => [p.slice('team/'.length), e] as const)
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })

      // Retract the announcement the instant the seed finishes: the
      // 'adopting:detaching' write is the last step before the precondition
      // re-check, which is exactly the window row 13 names.
      const notices: string[] = []
      const hooked: BootedVault = {
        ...dev,
        vaultDir: hookDir(dir, async (name, bytes) => {
          if (name !== 'mounts.json' || !dec.decode(bytes).includes('adopting:detaching')) return
          // The owner's absorb lands: 'team' is a plain dir again, with every
          // child back under its original guid.
          await dev.root.announceAbsorb('team', subtree)
        }),
      }
      await reconcileMountEntries(
        adoptCtx(hooked, {
          relay: TEAM_TOKEN,
          onNotice: (k) => notices.push(k),
          onBuild: () => {
            throw new Error('a cancelled adopt must not build a session')
          },
        })
      )

      expect(notices).toEqual(['adopt-cancelled'])
      // A clean rollback: no desc, no namespace, the parent untouched.
      expect((await dev.mountsFile.load()).some((d) => d.room === TEAM_ROOM)).toBe(false)
      expect(await dir.list(`${TEAM_ROOM}/`)).toEqual([])
      expect(dev.mounts.has('team')).toBe(false)
      // The cancel does not undo the carve — it drops OUR half and lets the
      // steady-state pass act on what the map now says, which is the owner's
      // absorb: the subtree is back in the parent, with its original guids.
      expect(rootTextPaths(dev)).toEqual(rootPathsBefore)
      expect(await diskSnapshot(base)).toEqual(before)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — joining inside a shared root announces (S10 Q7)', () => {
  it('sets the mount entry with the FOREIGN relay in the detach transaction', async () => {
    const base = await seedAdapter({ 'keep.md': 'k\n' })
    const dir = new MemStoreDir()
    const vault = await bootVault(base, dir, 'root-room')
    try {
      vault.root.enableSharing({ url: RELAY, token: 'root-token' })
      const mountsFile = new MountsFile(dir.io('mounts.json'))
      await expect(
        joinMount({
          vaultDir: dir,
          mountsFile,
          root: vault.root,
          baseAdapter: base,
          existingMountPaths: [],
          mountPath: 'guest',
          room: 'guest-room',
          relayUrl: 'ws://cynthia.relay',
          addIgnore: (p) => vault.ignore.add(p),
          removeIgnore: (p) => vault.ignore.delete(p),
          buildSession: () =>
            vault.makeSession('guest-room', scopedAdapter(base, 'guest'), 'guest', {
              provenance: 'joined',
            }),
        })
      ).resolves.toBeDefined()

      // The entry's relay is CYNTHIA's, not this vault's: a peer of the root
      // must be told where the nested share actually lives.
      expect(vault.root.mountEntries()).toEqual([
        { path: 'guest', room: 'guest-room', relay: 'ws://cynthia.relay' },
      ])
    } finally {
      vault.dispose()
    }
  })
})

describe('nested mounts — the ghost-entry rule (S10 Q5)', () => {
  /** Adopt `team` on a single device, then hand back the live mount. */
  async function adopted(): Promise<{ dev: BootedVault; dir: MemStoreDir; base: MemVaultAdapter }> {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
    await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))
    return { dev, dir, base }
  }

  it('replays a rename, imports an unknown file, and HARD-deletes the parent keys', async () => {
    const { dev, base } = await adopted()
    try {
      const plan = dev.mounts.get('team')!.files().find((r) => r.path === 'plan.md')!.guid
      await base.writeAtomic('team/dropped-in.md', new TextEncoder().encode('from another peer\n'))

      // A peer that had not yet adopted renamed a file inside the subtree and
      // moved another one in — both land in the PARENT map under the boundary.
      applyForeignMap(dev, (m) => {
        m.set('team/renamed.md', { guid: plan, kind: 'text' })
        m.set('team/dropped-in.md', { guid: 'foreign-guid', kind: 'text' })
      })
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))

      const mount = dev.mounts.get('team')!
      // The rename was replayed inside the mount, keeping the guid...
      expect(mount.files().find((r) => r.guid === plan)?.path).toBe('renamed.md')
      // ...and the import got a FRESH guid: content identity never crosses rooms.
      const imported = mount.files().find((r) => r.path === 'dropped-in.md')
      expect(imported).toBeDefined()
      expect(imported!.guid).not.toBe('foreign-guid')

      // The parent keys are GONE, not tombstoned. A tombstone under a mount
      // root reaches a peer that has not adopted yet and makes it delete the
      // file from disk — the one thing this rule exists to prevent.
      const rootAll = dev.root.mapEntries(true).map(([p]) => p)
      expect(rootAll.filter((p) => p.startsWith('team/'))).toEqual([])
      expect(dev.root.mapEntries(true).find(([p]) => p === 'team')?.[1].kind).toBe('mount')
      checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })

  it('replays a tombstone as a delete inside the mount', async () => {
    const { dev, base } = await adopted()
    try {
      const plan = dev.mounts.get('team')!.files().find((r) => r.path === 'plan.md')!.guid
      applyForeignMap(dev, (m) => {
        m.set('team/plan.md', { guid: plan, kind: 'text', deleted: true })
      })
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))

      const mount = dev.mounts.get('team')!
      // Deleted where it now lives — journaled, and a tombstone for the
      // MOUNT's peers, which is where a tombstone is the correct thing.
      expect(mount.files().some((r) => r.path === 'plan.md')).toBe(false)
      expect(await base.read('team/plan.md')).toBeNull()
      expect(dev.root.mapEntries(true).filter(([p]) => p.startsWith('team/'))).toEqual([])
      checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })

  it('moves a file out across the boundary with a fresh guid', async () => {
    const { dev, base } = await adopted()
    try {
      const plan = dev.mounts.get('team')!.files().find((r) => r.path === 'plan.md')!.guid
      // A peer moved team/plan.md out to other/plan.md: the bytes are at the
      // destination and the parent map claims a guid the mount owns.
      await base.writeAtomic('other/plan.md', new TextEncoder().encode(FILES['team/plan.md']!))
      await base.remove('team/plan.md')
      applyForeignMap(dev, (m) => {
        m.set('other/plan.md', { guid: plan, kind: 'text' })
      })
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))

      const moved = dev.root.files().find((r) => r.path === 'other/plan.md')
      expect(moved).toBeDefined()
      expect(moved!.guid).not.toBe(plan) // fresh guid in the parent room
      expect(dev.mounts.get('team')!.files().some((r) => r.guid === plan)).toBe(false)
      checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — the LIVE trigger (S10 Q1 entry point 1)', () => {
  it('adopts and then sweeps ghosts from the map observer alone, with no boot pass', async () => {
    // autoAdopt on (the shim's wiring): nothing here calls the machine — the
    // session's own map observer queues it, ahead of its map scan.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', {
      tokens: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0))
    }
    try {
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
      await settle()
      expect(dev.mounts.has('team')).toBe(true)
      expect(mountRows(dev, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])

      // A ghost changes NO mount entry, so the entry-set signature alone would
      // never report it — the observer looks for keys under a mount root too.
      const plan = dev.mounts.get('team')!.files().find((r) => r.path === 'plan.md')!.guid
      applyForeignMap(dev, (m) => {
        m.set('team/renamed.md', { guid: plan, kind: 'text' })
      })
      await settle()
      expect(dev.mounts.get('team')!.files().find((r) => r.guid === plan)?.path).toBe('renamed.md')
      expect(dev.root.mapEntries(true).filter(([p]) => p.startsWith('team/'))).toEqual([])
      checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — adopt crash matrix (L1 fixture)', () => {
  it('killed after every possible store write, every reboot converges', async () => {
    // The carve.test.ts matrix, mirrored onto the peer: a device that learns
    // about someone else's carve is killed after every possible number of
    // store writes, and every reboot must land converged.
    for (let budget = 0; budget < 80; budget++) {
      const base = await seedAdapter(FILES)
      const dir = new MemStoreDir()
      const before = await diskSnapshot(base)

      const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
      let crashed = false
      try {
        await reconcileMountEntries(
          adoptCtx({ ...dev, vaultDir: crashingDir(dir, budget) }, { relay: TEAM_TOKEN })
        )
      } catch (err) {
        crashed = true
        expect(String(err)).toContain('injected-crash')
      }
      dev.dispose()

      // Reboot from durable state only: recoverMounts, then the boot pass.
      const reboot = await bootVault(base, dir, 'root-room', {
        tokens: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      })
      await reboot.reconcile()

      // Not a single disk byte changed, every desc settled, every file in
      // exactly one map — and, because the mount entry is a fact of the room,
      // the boot pass always finishes the adopt rather than abandoning it.
      expect(await diskSnapshot(base)).toEqual(before)
      checkInvariants(reboot)
      expect(mountRows(reboot, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])
      expect(rootTextPaths(reboot)).toEqual(new Set(['keep.md']))
      expect(reboot.mounts.get('team')!.docForPath('plan.md')?.getText()).toBe(
        FILES['team/plan.md']
      )
      reboot.dispose()
      if (!crashed) return // the whole matrix is covered
    }
    throw new Error('crash budget never reached the happy path — raise the sweep bound')
  }, 60_000)
})

/** StoreDir wrapper that runs `onWrite` before each write lands. */
function hookDir(base: StoreDir, onWrite: (name: string, bytes: Uint8Array) => unknown): StoreDir {
  return {
    io: (name) => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          await onWrite(name, bytes)
          await io.writeAtomic(bytes)
        },
      }
    },
    remove: (name) => base.remove(name),
    list: (prefix) => base.list(prefix),
  }
}

/** The adopt machine's context for a device, as the fixture wires it. */
function adoptCtx(
  dev: BootedVault,
  opts: {
    relay: RelayConfig | null
    onBuild?: (o: AdoptedMountOptions) => void
    onNotice?: (kind: string) => void
  }
): AdoptContext {
  return {
    vaultDir: dev.vaultDir,
    mountsFile: new MountsFile(dev.vaultDir.io('mounts.json')),
    engine: dev.engine,
    root: () => dev.root,
    rootRoom: 'root-room',
    mounts: () => dev.mounts,
    relayFor: () => opts.relay,
    buildSession: (o) => {
      // firstJoin is RECORDED, not obeyed: it is an awaited provider pull and
      // this fixture's sockets never open. The decision is what is under test.
      opts.onBuild?.(o)
      return dev.makeSession(o.room, scopedAdapter(dev.adapter, o.path), o.path, {
        provenance: o.provenance,
        ...(o.relay ? { relay: o.relay } : {}),
      })
    },
    attachMount: (path, session) => {
      dev.mounts.set(path, session)
    },
    detachMount: (path) => {
      const s = dev.mounts.get(path) ?? null
      dev.mounts.delete(path)
      return s
    },
    withRootDown: async (fn) => fn(),
    refreshIgnore: () => dev.refreshDescs(),
    notify: (n) => opts.onNotice?.(n.kind),
  }
}

describe('nested mounts — carve races carve (S10 Q5 rows 10/11)', () => {
  const ROOM_A = 'team-room-a'
  const ROOM_B = 'team-room-b'
  const bothTokens = (): Map<string, RelayConfig> =>
    new Map([
      [ROOM_A, { url: RELAY, token: 'tok-a' }],
      [ROOM_B, { url: RELAY, token: 'tok-b' }],
      [TEAM_ROOM, TEAM_TOKEN],
      [SUB_ROOM, { url: RELAY, token: 'tok-sub' }],
    ])

  it('row 10: both devices carve the same folder — the map’s room wins, the loser re-points', async () => {
    const duo = await bootDuo({ files: FILES, tokensA: bothTokens(), tokensB: bothTokens() })
    try {
      await duo.deliver()
      const guids = new Map(
        duo.a.root
          .files()
          .filter((r) => r.kind === 'text' && r.path.startsWith('team/'))
          .map((r) => [r.path, r.guid])
      )
      // Both operators are offline from one another and both carve `team/`.
      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'team', room: ROOM_A, token: 'tok-a' })
      await carveOn(duo.b, { path: 'team', room: ROOM_B, token: 'tok-b' })
      // ...and each one edits inside its own fresh mount before they meet.
      // These edits are the whole point of the re-point: the two namespaces
      // are guid-identical, so the loser's blobs must carry its work into the
      // winner's room instead of being dropped with the orphan namespace.
      for (const [dev, mark] of [
        [duo.a, '[A-edit]'],
        [duo.b, '[B-edit]'],
      ] as const) {
        dev.mounts.get('team')!.docForPath('plan.md')!.transact((t) => t.insert(0, `${mark}\n`), 'local')
      }
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      // The map is the statement everyone converges on: one entry, one room,
      // the same on both devices — whichever of the two Yjs's LWW picked.
      const entries = duo.a.root.mountEntries()
      expect(entries).toEqual(duo.b.root.mountEntries())
      expect(entries).toHaveLength(1)
      const winner = entries[0]!.room
      expect([ROOM_A, ROOM_B]).toContain(winner)
      const loserRoom = winner === ROOM_A ? ROOM_B : ROOM_A
      const loser = winner === ROOM_A ? duo.b : duo.a

      // The loser re-pointed its namespace rather than re-seeding: same guids,
      // the orphan room dropped, one loud notice.
      expect(loser.events.notices.filter((n) => n.kind === 'room-repointed')).toEqual([
        { kind: 'room-repointed', path: 'team', room: winner },
      ])
      expect(await loser.vaultDir.list(`${loserRoom}/`)).toEqual([])
      expect(loser.descs().some((d) => d.room === loserRoom)).toBe(false)

      for (const dev of [duo.a, duo.b]) {
        expect([...dev.mounts.keys()]).toEqual(['team'])
        expect(dev.mounts.get('team')!.room).toBe(winner)
        expect(mountRows(dev, 'team')).toEqual([
          { path: 'notes/deep.md', guid: guids.get('team/notes/deep.md')! },
          { path: 'plan.md', guid: guids.get('team/plan.md')! },
        ])
        const text = dev.mounts.get('team')!.docForPath('plan.md')!.getText()
        expect(text).toContain('[A-edit]')
        expect(text).toContain('[B-edit]')
        expect(text).toContain(FILES['team/plan.md']!.trim())
        checkInvariants(dev)
      }
    } finally {
      duo.dispose()
    }
  })

  it('row 11: a carve inside a concurrent carve dissolves into the outer mount (depth 1)', async () => {
    const duo = await bootDuo({ files: DEEP_FILES, tokensA: bothTokens(), tokensB: bothTokens() })
    try {
      await duo.deliver()
      const guids = new Map(
        duo.a.root
          .files()
          .filter((r) => r.kind === 'text' && r.path.startsWith('team/'))
          .map((r) => [r.path, r.guid])
      )
      const beforeB = await diskSnapshot(duo.b.adapter)

      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await carveOn(duo.b, { path: 'team/sub', room: SUB_ROOM, token: 'tok-sub' })
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      // The outer wins on both devices: one mount root, one entry in the map.
      for (const dev of [duo.a, duo.b]) {
        expect(dev.root.mountEntries()).toEqual([
          { path: 'team', room: TEAM_ROOM, relay: RELAY },
        ])
        expect([...dev.mounts.keys()]).toEqual(['team'])
        expect(mountRows(dev, 'team')).toEqual([
          { path: 'notes/deep.md', guid: guids.get('team/notes/deep.md')! },
          { path: 'plan.md', guid: guids.get('team/plan.md')! },
          { path: 'sub/nested.md', guid: guids.get('team/sub/nested.md')! },
        ])
        checkInvariants(dev)
      }
      // B's inner room is gone — its namespace folded into the outer mount's,
      // guid for guid, so nothing had to be re-imported.
      expect(duo.b.descs().some((d) => d.room === SUB_ROOM)).toBe(false)
      expect(await duo.b.vaultDir.list(`${SUB_ROOM}/`)).toEqual([])
      expect(duo.b.events.notices.some((n) => n.kind === 'depth-limit')).toBe(true)
      expect(duo.b.mounts.get('team')!.docForPath('sub/nested.md')?.getText()).toBe(
        DEEP_FILES['team/sub/nested.md']
      )
      expect(await diskSnapshot(duo.b.adapter)).toEqual(beforeB)
    } finally {
      duo.dispose()
    }
  })
})

describe('nested mounts — device links (S10 Q5 rows 14/15)', () => {
  it('row 15: two devices link at once — a rejoin, never a second enrollment', async () => {
    const duo = await bootDuo({ files: FILES })
    try {
      await duo.deliver()
      const guids = new Map(
        duo.a.root.files().filter((r) => r.kind === 'text').map((r) => [r.path, r.guid])
      )
      const c = await duo.link('C')
      const d = await duo.link('D')
      await duo.deliver()

      // Both linked devices hold the vault under the SAME guids: a fresh
      // enrollment on either would have minted a second guid per path and
      // merged two histories over one file — every note's text twice.
      for (const dev of [c, d]) {
        expect(
          new Map(dev.root.files().filter((r) => r.kind === 'text').map((r) => [r.path, r.guid]))
        ).toEqual(guids)
        expect(await diskSnapshot(dev.adapter)).toEqual(await diskSnapshot(duo.a.adapter))
        checkInvariants(dev)
      }
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })

  it('row 14a: linked BEFORE the carve — the device adopts what it just materialized', async () => {
    const duo = await bootDuo({ files: FILES })
    try {
      await duo.deliver()
      const c = await duo.link('C', new Map([[TEAM_ROOM, TEAM_TOKEN]]))
      await duo.deliver()
      expect(new Set(c.root.files().filter((r) => r.kind === 'text').map((r) => r.path))).toEqual(
        new Set(Object.keys(FILES))
      )
      const before = await diskSnapshot(c.adapter)
      const guids = new Map(
        c.root
          .files()
          .filter((r) => r.kind === 'text' && r.path.startsWith('team/'))
          .map((r) => [r.path, r.guid])
      )

      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()

      // Nothing pulled: C seeded the mount from the namespace it had just
      // built, so the guids are the room's own and no byte moved.
      expect(mountRows(c, 'team')).toEqual([
        { path: 'notes/deep.md', guid: guids.get('team/notes/deep.md')! },
        { path: 'plan.md', guid: guids.get('team/plan.md')! },
      ])
      expect(c.events.builds.filter((b) => b.room === TEAM_ROOM)).toEqual([
        { room: TEAM_ROOM, path: 'team', firstJoin: false },
      ])
      expect(await diskSnapshot(c.adapter)).toEqual(before)
      checkInvariants(c)
    } finally {
      duo.dispose()
    }
  })

  it('row 14b: linked AFTER the carve — an empty M(P), so the mount pulls its own room', async () => {
    const duo = await bootDuo({ files: FILES, tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]) })
    try {
      await duo.deliver()
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.deliver()

      const c = await duo.link('C', new Map([[TEAM_ROOM, TEAM_TOKEN]]))
      await duo.deliver()

      // The pulled map carries the mount entry and no `team/*` keys at all —
      // joinFolder and scanMap both skip non-text kinds — so the boot pass
      // adopts with nothing to seed, which is exactly the firstJoin rule.
      expect(c.events.builds.filter((b) => b.room === TEAM_ROOM)).toEqual([
        { room: TEAM_ROOM, path: 'team', firstJoin: true },
      ])
      expect(c.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        path: 'team',
        provenance: 'adopted',
        status: 'active',
      })
      expect(new Set(c.root.files().filter((r) => r.kind === 'text').map((r) => r.path))).toEqual(
        new Set(['keep.md'])
      )
      checkInvariants(c)
    } finally {
      duo.dispose()
    }
  })
})

describe('nested mounts — the seed→detach window (S10 Q5 row 2)', () => {
  const LATE = '[late update]\n'

  it('the CARVER re-flushes an update that lands after the seed', async () => {
    // carveFolder pauses nothing, and inside a shared root the parent session
    // is still connected between step 3 and step 5: a remote update or a
    // keystroke landing there was copied nowhere before N1's targetDir.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { rootRelay: { url: RELAY, token: 't' } })
    try {
      await carveFolder({
        root: dev.root,
        vaultDir: dir,
        mountsFile: hookedMounts(dir, async (json) => {
          if (!json.includes('carving:detaching')) return
          dev.root.docForPath('team/plan.md')!.transact((t) => t.insert(0, LATE), 'remote')
        }),
        mountPath: 'team',
        room: TEAM_ROOM,
        relayUrl: RELAY,
        addIgnore: (p) => dev.ignore.add(p),
      })
      const mount = await dev.makeSession(TEAM_ROOM, scopedAdapter(base, 'team'), 'team', {
        provenance: 'carved',
      })
      dev.mounts.set('team', mount)
      await dev.refreshDescs()

      expect(mount.docForPath('plan.md')?.getText()).toBe(LATE + FILES['team/plan.md'])
      checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })

  it('the PEER re-flushes an update that lands after its adopt seeded', async () => {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      // Capture the instance while the path still resolves: the carve's
      // transaction removes the key, and this doc lives on until step 5.
      const planDoc = dev.root.docForPath('team/plan.md')!
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
      // 'adopting:detaching' is written between the seed (step 3) and the
      // parent teardown (step 5) — the exact window row 2 names.
      const hooked: BootedVault = {
        ...dev,
        vaultDir: hookDir(dir, async (name, bytes) => {
          if (name !== 'mounts.json' || !dec.decode(bytes).includes('adopting:detaching')) return
          planDoc.transact((t) => t.insert(0, LATE), 'remote')
        }),
      }
      await reconcileMountEntries(adoptCtx(hooked, { relay: TEAM_TOKEN }))

      expect(dev.mounts.get('team')!.docForPath('plan.md')?.getText()).toBe(
        LATE + FILES['team/plan.md']
      )
      checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — the mount root itself is raced (S10 Q5 row 3)', () => {
  /** A duo where B has adopted A's carve of `team/`. */
  async function adoptedDuo(): Promise<Awaited<ReturnType<typeof bootDuo>>> {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    await duo.deliver()
    await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
    await duo.deliver()
    return duo
  }

  it('outcome (i): the mount entry survives — the renamed copies move OUT of the room', async () => {
    const duo = await adoptedDuo()
    try {
      const mount = duo.b.mounts.get('team')!
      const plan = mount.files().find((r) => r.path === 'plan.md')!.guid
      // A peer that never adopted renamed `team/` → `crew/`: same guids, new
      // keys, and the bytes follow on disk.
      await duo.b.adapter.writeAtomic('crew/plan.md', enc.encode(FILES['team/plan.md']!))
      applyForeignMap(duo.b, (m) => {
        m.set('crew', { guid: 'crew-dir', kind: 'dir' })
        m.set('crew/plan.md', { guid: plan, kind: 'text' })
      })
      await duo.deliver()

      // The mount wins: the entry is still at `team`, and the stray copy is a
      // cross-boundary move OUT — a fresh guid in the parent, never a second
      // room holding the same one.
      expect(duo.b.root.mountEntries()).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
      const moved = duo.b.root.files().find((r) => r.path === 'crew/plan.md')
      expect(moved).toBeDefined()
      expect(moved!.guid).not.toBe(plan)
      expect(duo.b.mounts.get('team')!.files().some((r) => r.guid === plan)).toBe(false)
      expect(duo.b.events.notices.some((n) => n.kind === 'mount-moved')).toBe(true)
      checkInvariants(duo.b)
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })

  it('outcome (ii): the mount entry is lost — mounts.json re-states it, never dissolves', async () => {
    const duo = await adoptedDuo()
    try {
      const rowsBefore = mountRows(duo.b, 'team')
      // The rename's delete of `team` won the LWW. A missing key is NOT an
      // unshare: treating it as one would dissolve a live mount.
      applyForeignMap(duo.b, (m) => m.delete('team'))
      await duo.deliver()

      expect(duo.b.root.mountEntries()).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
      expect(duo.b.descs().find((d) => d.room === TEAM_ROOM)?.status).toBe('active')
      expect(mountRows(duo.b, 'team')).toEqual(rowsBefore)
      expect(rootTextPaths(duo.b)).toEqual(new Set(['keep.md']))
      checkInvariants(duo.b)
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })
})

describe('nested mounts — a peer moves a file out mid-carve (S10 Q5 row 5)', () => {
  // What converges today. The half that does NOT — the parent keeps the
  // mount's guid, because on a peer the bytes are not at the destination and
  // `reenrollPath` is a silent no-op — is pinned as a skipped design question
  // in `fuzz-crashers/0001-move-out-on-a-peer.spec.ts`.
  it('the mount yields the file, both devices agree, and nothing is lost', async () => {
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    try {
      await duo.deliver()
      const plan = duo.b.root.files().find((r) => r.path === 'team/plan.md')!.guid

      // B knows nothing of the carve yet and drags the file out of the folder.
      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.b.root.renamePath('team/plan.md', 'other/plan.md')
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      for (const dev of [duo.a, duo.b]) {
        // The bytes are at the destination on both devices, in the PARENT map.
        const moved = dev.root.files().find((r) => r.path === 'other/plan.md')
        expect(moved, `other/plan.md missing on ${dev.root.user.name}`).toBeDefined()
        expect(dev.mounts.get('team')!.files().some((r) => r.path === 'plan.md')).toBe(false)
        expect(dec.decode((await dev.adapter.read('other/plan.md'))!)).toBe(FILES['team/plan.md'])
        checkInvariants(dev)
      }
      // One guid for the path on both devices, and it is no longer LIVE in the
      // room: the mount tombstoned it, so nothing claims it twice.
      expect(duo.a.root.files().find((r) => r.path === 'other/plan.md')!.guid).toBe(
        duo.b.root.files().find((r) => r.path === 'other/plan.md')!.guid
      )
      for (const dev of [duo.a, duo.b]) {
        expect(dev.mounts.get('team')!.files().some((r) => r.guid === plan)).toBe(false)
      }
      expect(duo.a.events.notices.some((n) => n.kind === 'mount-moved')).toBe(true)
    } finally {
      duo.dispose()
    }
  })
})

describe('nested mounts — a peer deletes the whole folder (S10 Q5 row 9)', () => {
  /** A carves `team/`; B, which never saw the carve, deletes the folder. */
  async function racedDelete(): Promise<{
    duo: Awaited<ReturnType<typeof bootDuo>>
    held: string[][]
  }> {
    const held: string[][] = []
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      // Only the MOUNT gets the low threshold: the root's own boot/watch
      // batches are a different breaker and would drown the signal.
      defaultsA: (mountPath) =>
        mountPath === ''
          ? {}
          : { thresholds: { massChangePaths: 1 }, events: { onBreaker: (p) => held.push(p) } },
    })
    await duo.deliver()
    duo.net.setOffline('A', true)
    duo.net.setOffline('B', true)
    await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
    await duo.b.root.deletePath('team')
    duo.net.setOffline('A', false)
    duo.net.setOffline('B', false)
    await duo.deliver()
    return { duo, held }
  }

  it('holds the mass delete behind the breaker instead of applying it silently', async () => {
    const { duo, held } = await racedDelete()
    try {
      // The whole folder, dir entry included — one confirmation, not N.
      expect(held).toHaveLength(1)
      expect([...held[0]!].sort()).toEqual(['notes', 'notes/deep.md', 'plan.md'])
      expect(duo.a.events.notices.some((n) => n.kind === 'ghosts-held')).toBe(true)
      // Held means held: the mount still has its files and its bytes.
      expect(mountRows(duo.a, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])
      expect(await duo.a.adapter.read('team/plan.md')).not.toBeNull()
      // The parent keys go either way — hard-deleted, never tombstoned, so a
      // peer that has not adopted is never told to remove the file from disk.
      expect(duo.a.root.mapEntries(true).filter(([p]) => p.startsWith('team/'))).toEqual([])
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })

  it('confirm replays the deletes inside the mount', async () => {
    const { duo } = await racedDelete()
    try {
      await duo.a.mounts.get('team')!.confirmBreaker()
      await duo.deliver()
      expect(mountRows(duo.a, 'team')).toEqual([])
      expect(await duo.a.adapter.read('team/plan.md')).toBeNull()
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })

  it('dismiss keeps the mount’s files, and the two maps still agree', async () => {
    const { duo } = await racedDelete()
    try {
      duo.a.mounts.get('team')!.dismissBreaker()
      await duo.deliver()
      expect(mountRows(duo.a, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])
      expect(dec.decode((await duo.a.adapter.read('team/plan.md'))!)).toBe(FILES['team/plan.md'])
      expect(duo.a.root.mapEntries(true).filter(([p]) => p.startsWith('team/'))).toEqual([])
      checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })
})

/** A MountsFile whose every write runs `onWrite` with the JSON first. */
function hookedMounts(dir: StoreDir, onWrite: (json: string) => Promise<void>): MountsFile {
  const io = dir.io('mounts.json')
  return new MountsFile({
    read: () => io.read(),
    writeAtomic: async (bytes) => {
      await onWrite(dec.decode(bytes))
      await io.writeAtomic(bytes)
    },
  })
}
