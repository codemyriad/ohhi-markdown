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
  docBlobName,
  FOLDER_DOC_KEY,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedAdapter,
  scopedStoreDir,
  isRecoverable,
  type MountDesc,
  type StoreDir,
} from '@editor/vault'
import { createYjsEngine, type FileEntry, type SyncEngine } from '@editor/sync'
import { MAX_SEED_BYTES, type MountSession } from '../src/mount-session.js'
import {
  applyForeignCarve,
  applyForeignMap,
  bootDuo,
  bootVault,
  carveOn,
  checkInvariants,
  announcedMounts,
  crashingDir,
  dec,
  diskSnapshot,
  enc,
  seedAdapter,
  type BootedVault,
} from './fixture.js'
import { activateMount } from '../src/activate.js'
import { carveFolder } from '../src/carve.js'
import { recoverMounts } from '../src/vault-boot.js'
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
      await checkInvariants(duo.b)
      await checkInvariants(duo.a)
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
      await checkInvariants(duo.b)
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
      await checkInvariants(duo.b)

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
      await checkInvariants(duo.b)
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
          onBuild: (o) => {
            built.push({ room: o.room, firstJoin: o.firstJoin === true })
          },
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
        adoptCtx(dev, {
          relay: null,
          onBuild: (o) => {
            built.push({ room: o.room, firstJoin: o.firstJoin === true })
          },
        })
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
      await checkInvariants(rebooted)
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
      await checkInvariants(duo.b)
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
      expect(announcedMounts(vault.root)).toEqual([
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

      // ...and so are the STORES behind them (M5). Removing the map key alone
      // left the parent holding a live doc, a provider, an LCA record and a
      // blob for a guid the mount now owns — one guid with durable state in
      // two namespaces, which no map-only invariant can see and which the
      // parent's next boot would restore as a rival copy.
      const rootLcas = (await dev.root.lcaRecords()).map((r) => r.guid)
      expect(rootLcas).not.toContain(plan)
      expect(rootLcas).not.toContain('foreign-guid')
      expect(dev.root.docForPath('team/renamed.md')).toBeNull()
      expect(await dev.vaultDir.list('root-room/docs/')).not.toContain(
        `root-room/docs/${encodeURIComponent(plan)}.bin`
      )
      await checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })

  it('takes the parent’s doc, provider, LCA and blob away with the key (M5)', async () => {
    // The reachable shape: this device created a file under `team/` while it
    // was closed, `bootScan` enrolled it into the ROOT with a fresh guid, and
    // only then did the carve arrive. The seeded membership does not contain
    // it, so the detach does not tear it down — it is a ghost, and the sweep
    // imports it into the mount with a fresh guid.
    //
    // Removing the map key alone leaves the parent holding a live doc, a
    // provider, an LCA record and a blob for a guid that has just been
    // retired. Invisible to any map-only invariant, and the parent's next boot
    // restores it as a rival copy of a note the mount already owns.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      // Enrolled by the ROOT, before anyone said `team/` was going anywhere.
      await base.writeAtomic('team/offline.md', enc.encode('made while closed\n'))
      await dev.root.rescan()
      const stray = dev.root.files().find((r) => r.path === 'team/offline.md')!.guid
      expect((await dev.root.lcaRecords()).map((r) => r.guid)).toContain(stray)

      // The carve arrives, and its seed knows nothing about that file.
      applyForeignCarve(dev, 'team', {
        room: TEAM_ROOM,
        relay: RELAY,
        omit: ['team/offline.md'],
      })
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))

      // It is in the mount now, under a guid of the mount's own...
      const imported = dev.mounts.get('team')!.files().find((r) => r.path === 'offline.md')
      expect(imported).toBeDefined()
      expect(imported!.guid).not.toBe(stray)
      // ...and the parent kept nothing of the old one.
      expect(dev.root.mapEntries(true).some(([p]) => p === 'team/offline.md')).toBe(false)
      expect((await dev.root.lcaRecords()).map((r) => r.guid)).not.toContain(stray)
      expect(await dev.vaultDir.list('root-room/docs/')).not.toContain(
        `root-room/docs/${encodeURIComponent(stray)}.bin`
      )
      await checkInvariants(dev)
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
      await checkInvariants(dev)
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
      await checkInvariants(dev)
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
      await checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — adopt crash matrix (L1 fixture)', () => {
  // Two shapes of the same sweep. A PRIVATE root is the V1 case: nothing is
  // announced anywhere, so a crash can only lose derived state. A SHARED root
  // with its folder blob already flushed is the one that matters for N1 — the
  // owner's `kind:'mount'` entry is DURABLE on this device before the kill, so
  // every recovery path is working next to a key it must not touch. Deleting
  // it there is a hard delete in this device's folder history, which its next
  // reconnect ships back to the room and which dissolves the announcement for
  // every peer of that room at once.
  for (const shared of [false, true]) {
    it(`killed after every possible store write, every reboot converges (${
      shared ? 'shared root, announcement durable' : 'private root'
    })`, async () => {
      for (let budget = 0; budget < 120; budget++) {
        const base = await seedAdapter(FILES)
        const dir = new MemStoreDir()
        const before = await diskSnapshot(base)

        const dev = await bootVault(base, dir, 'root-room', {
          autoAdopt: false,
          ...(shared ? { rootRelay: TEAM_TOKEN } : {}),
        })
        applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
        if (shared) {
          // Past the doc-store debounce: the root folder blob now carries the
          // mount entry, so the crash lands with the announcement durable.
          dev.clock.advance(2_000)
          await new Promise((r) => setTimeout(r, 0))
        }
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
          ...(shared ? { rootRelay: TEAM_TOKEN } : {}),
        })
        await reboot.reconcile()

        // Not a single disk byte changed, every desc settled, every file in
        // exactly one map — and, because the mount entry is a fact of the room,
        // the boot pass always finishes the adopt rather than abandoning it.
        expect(await diskSnapshot(base)).toEqual(before)
        await checkInvariants(reboot)
        expect(mountRows(reboot, 'team').map((r) => r.path)).toEqual(['notes/deep.md', 'plan.md'])
        expect(rootTextPaths(reboot)).toEqual(new Set(['keep.md']))
        expect(reboot.mounts.get('team')!.docForPath('plan.md')?.getText()).toBe(
          FILES['team/plan.md']
        )
        if (shared) {
          // The announcement is still there, on every recovery path.
          expect(announcedMounts(reboot.root)).toEqual([
            { path: 'team', room: TEAM_ROOM, relay: RELAY },
          ])
        }
        reboot.dispose()
        if (!crashed) return // the whole matrix is covered
      }
      throw new Error('crash budget never reached the happy path — raise the sweep bound')
    }, 60_000)
  }
})

/** StoreDir wrapper that runs `onWrite` before each write lands. */
function hookDir(base: StoreDir, onWrite: (name: string, bytes: Uint8Array) => unknown): StoreDir {
  // The binding names THIS dir, not `base` (see StoreIo.binding): dropping it
  // hands the LCA store the pre-S10 whole-file layout, so the hook would never
  // see the per-record writes it exists to observe.
  const dir: StoreDir = {
    io: (name) => {
      const io = base.io(name)
      return {
        read: () => io.read(),
        writeAtomic: async (bytes) => {
          await onWrite(name, bytes)
          await io.writeAtomic(bytes)
        },
        binding: { dir, name },
      }
    },
    remove: (name) => base.remove(name),
    list: (prefix) => base.list(prefix),
  }
  return dir
}

/** The adopt machine's context for a device, as the fixture wires it. */
function adoptCtx(
  dev: BootedVault,
  opts: {
    relay: RelayConfig | null
    onBuild?: (o: AdoptedMountOptions) => void | Promise<void>
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
    buildSession: async (o) => {
      // firstJoin is RECORDED, not obeyed: it is an awaited provider pull and
      // this fixture's sockets never open. The decision is what is under test.
      // Awaited, so a caller can inspect the durable state as it stood when
      // the machine asked for the session.
      await opts.onBuild?.(o)
      return dev.makeSession(o.room, scopedAdapter(dev.adapter, o.path), o.path, {
        provenance: o.provenance,
        ...(o.relay ? { relay: o.relay } : {}),
        // `firstJoin` decides boot ordering and is passed through; the pull
        // itself cannot run here (no sockets), so `neverHeld` stands in for
        // it — boot empty, enrol nothing.
        ...(o.firstJoin ? { firstJoin: true } : {}),
        ...(o.neverHeld || o.firstJoin ? { neverHeld: true } : {}),
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
      const entries = announcedMounts(duo.a.root)
      expect(entries).toEqual(announcedMounts(duo.b.root))
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
        await checkInvariants(dev)
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
        expect(announcedMounts(dev.root)).toEqual([
          { path: 'team', room: TEAM_ROOM, relay: RELAY },
        ])
        expect([...dev.mounts.keys()]).toEqual(['team'])
        expect(mountRows(dev, 'team')).toEqual([
          { path: 'notes/deep.md', guid: guids.get('team/notes/deep.md')! },
          { path: 'plan.md', guid: guids.get('team/plan.md')! },
          { path: 'sub/nested.md', guid: guids.get('team/sub/nested.md')! },
        ])
        await checkInvariants(dev)
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
        await checkInvariants(dev)
      }
      await checkInvariants(duo.a)
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
      await checkInvariants(c)
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
      await checkInvariants(c)
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
      await checkInvariants(dev)
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
      await checkInvariants(dev)
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
      expect(announcedMounts(duo.b.root)).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
      const moved = duo.b.root.files().find((r) => r.path === 'crew/plan.md')
      expect(moved).toBeDefined()
      expect(moved!.guid).not.toBe(plan)
      expect(duo.b.mounts.get('team')!.files().some((r) => r.guid === plan)).toBe(false)
      expect(duo.b.events.notices.some((n) => n.kind === 'mount-moved')).toBe(true)
      await checkInvariants(duo.b)
      await checkInvariants(duo.a)
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

      expect(announcedMounts(duo.b.root)).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
      expect(duo.b.descs().find((d) => d.room === TEAM_ROOM)?.status).toBe('active')
      expect(mountRows(duo.b, 'team')).toEqual(rowsBefore)
      expect(rootTextPaths(duo.b)).toEqual(new Set(['keep.md']))
      await checkInvariants(duo.b)
      await checkInvariants(duo.a)
    } finally {
      duo.dispose()
    }
  })
})

describe('nested mounts — a peer moves a file out mid-carve (S10 Q5 row 5)', () => {
  // The decided rule (spike S10 Q5 row 5, 2026-09-10): ONLY the device whose
  // disk already holds the bytes at the destination performs the move-out —
  // re-enrol there with a FRESH guid, tombstone inside the mount. Every other
  // device does nothing and receives both halves.
  //
  // Both roles are asserted, and the run is parameterised over WHICH device
  // carves, so the mover is once the carver's peer and once the other way
  // round. Every device re-enrolling instead would mint a different guid per
  // device over the same bytes and merge them as the note's text twice; the
  // older "delete inside the mount anyway" left the mount's guid live in the
  // parent map over a doc only the mover could fill (`fuzz-crashers/0001`).
  for (const carver of ['a', 'b'] as const) {
    const mover = carver === 'a' ? 'b' : 'a'
    it(`${carver} carves, ${mover} moves the file out: one fresh guid, one copy of the text`, async () => {
      const duo = await bootDuo({
        files: FILES,
        tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
        tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      })
      try {
        await duo.deliver()
        const plan = duo.a.root.files().find((r) => r.path === 'team/plan.md')!.guid

        // The mover knows nothing of the carve yet and drags the file out.
        duo.net.setOffline('A', true)
        duo.net.setOffline('B', true)
        await carveOn(duo.dev(carver), { path: 'team', room: TEAM_ROOM, token: 'team-token' })
        await duo.dev(mover).root.renamePath('team/plan.md', 'other/plan.md')
        duo.net.setOffline('A', false)
        duo.net.setOffline('B', false)
        await duo.deliver()

        for (const dev of [duo.a, duo.b]) {
          const who = dev.root.user.name
          const moved = dev.root.files().find((r) => r.path === 'other/plan.md')
          expect(moved, `other/plan.md missing on ${who}`).toBeDefined()
          // Identity never crosses rooms: the guid the mount held is retired.
          expect(moved!.guid, `guid reused on ${who}`).not.toBe(plan)
          expect(dev.mounts.get('team')!.files().some((r) => r.path === 'plan.md')).toBe(false)
          expect(dev.mounts.get('team')!.files().some((r) => r.guid === plan)).toBe(false)
          // ...and the text is at the destination exactly once.
          expect(dec.decode((await dev.adapter.read('other/plan.md'))!)).toBe(FILES['team/plan.md'])
          expect(dev.root.docForPath('other/plan.md')?.getText()).toBe(FILES['team/plan.md'])
          await checkInvariants(dev)
        }
        // Both devices agree on the new identity...
        expect(duo.a.root.files().find((r) => r.path === 'other/plan.md')!.guid).toBe(
          duo.b.root.files().find((r) => r.path === 'other/plan.md')!.guid
        )
        // ...and exactly one device claimed the move.
        expect(duo.dev(mover).events.notices.some((n) => n.kind === 'mount-moved')).toBe(true)
        expect(duo.dev(carver).events.notices.some((n) => n.kind === 'mount-moved')).toBe(false)
      } finally {
        duo.dispose()
      }
    })
  }
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
      await checkInvariants(duo.a)
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
      await checkInvariants(duo.a)
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
      await checkInvariants(duo.a)
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

// ---------------------------------------------------------------------------
// Boot recovery: the rows that only a hand-built mounts.json can reach.
// ---------------------------------------------------------------------------

/** Write a folder blob for `room` holding exactly `entries`. */
async function writeFolderBlob(
  engine: SyncEngine,
  dir: StoreDir,
  room: string,
  entries: Record<string, FileEntry>
): Promise<void> {
  const doc = engine.createDoc(`blob-fixture:${room}:${crypto.randomUUID()}`)
  doc.transactMap((m) => {
    for (const [path, entry] of Object.entries(entries)) m.set(path, entry)
  }, 'seed')
  await scopedStoreDir(dir, `${room}/`)
    .io(docBlobName(FOLDER_DOC_KEY))
    .writeAtomic(engine.encodeUpdateSince(doc, null))
  doc.destroy()
}

/** Read a room's folder blob back as `path → entry`. */
async function readFolderBlob(
  engine: SyncEngine,
  dir: StoreDir,
  room: string
): Promise<Map<string, FileEntry>> {
  const bytes = await scopedStoreDir(dir, `${room}/`).io(docBlobName(FOLDER_DOC_KEY)).read()
  if (!bytes) return new Map()
  const doc = engine.createDoc(`blob-read:${room}:${crypto.randomUUID()}`)
  engine.applyUpdate(doc, bytes, 'seed')
  const out = new Map(doc.getMap().entries())
  doc.destroy()
  return out
}

describe('nested mounts — boot recovery of an interrupted adopt (S10 Q1)', () => {
  const ROOT = 'root-room'

  it('rolls the detach forward WITHOUT dissolving the owner’s announcement (C2)', async () => {
    // The peer was killed during step 5. Its root folder blob already carries
    // the owner's `kind:'mount'` entry (the carve transaction was flushed
    // before the crash — a live shared root flushes on its own debounce), and
    // the subtree keys are still there.
    //
    // Deleting that key here is not tidying: it is a hard delete written into
    // THIS device's folder history, which its next reconnect ships back to the
    // room. One peer's crash would retract the carve for everyone.
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const mountsFile = new MountsFile(dir.io('mounts.json'))
    await mountsFile.save([
      { room: ROOT, path: '', provenance: 'local', status: 'active' },
      {
        room: TEAM_ROOM,
        path: 'team',
        provenance: 'adopted',
        relay: { url: RELAY },
        status: 'adopting:detaching',
      },
    ])
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
    })
    await writeFolderBlob(engine, dir, ROOT, {
      'keep.md': { guid: 'g-keep', kind: 'text' },
      team: { guid: TEAM_ROOM, kind: 'mount', relay: RELAY },
      'team/plan.md': { guid: 'g-plan', kind: 'text' },
    })

    await recoverMounts(dir, mountsFile, engine)

    const root = await readFolderBlob(engine, dir, ROOT)
    expect(root.get('team')).toEqual({ guid: TEAM_ROOM, kind: 'mount', relay: RELAY })
    expect(root.has('team/plan.md')).toBe(false)
    expect((await mountsFile.load()).find((m) => m.room === TEAM_ROOM)?.status).toBe('active')
  })

  it('re-states the CARVER’s own announcement when its transaction was lost', async () => {
    // The mirror row: on the device that carved, the map entry is ours to
    // write, and the crash may have taken the transaction with it. mounts.json
    // is the authority on WHETHER a mount exists — so re-state it, with the
    // seed, or every peer would be told to pull a room it already holds.
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const mountsFile = new MountsFile(dir.io('mounts.json'))
    await mountsFile.save([
      { room: ROOT, path: '', provenance: 'local', status: 'active' },
      {
        room: TEAM_ROOM,
        path: 'team',
        provenance: 'carved',
        relay: { url: RELAY },
        status: 'carving:detaching',
      },
    ])
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
    })
    await writeFolderBlob(engine, dir, ROOT, {
      team: { guid: 'g-dir', kind: 'dir' },
      'team/plan.md': { guid: 'g-plan', kind: 'text' },
    })

    await recoverMounts(dir, mountsFile, engine)

    const entry = (await readFolderBlob(engine, dir, ROOT)).get('team')
    expect(entry?.kind).toBe('mount')
    expect(entry?.guid).toBe(TEAM_ROOM)
    expect(entry?.seed).toBeTypeOf('string')
  })

  it('leaves an unfinishable detach for the next boot instead of calling it done (M3)', async () => {
    // No mount folder blob: the seed never landed, so nothing says what moved
    // and the rollforward has no membership authority. Declaring the mount
    // 'active' here strands the subtree in the parent namespace forever,
    // because no later boot would look at it again.
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const mountsFile = new MountsFile(dir.io('mounts.json'))
    await mountsFile.save([
      { room: ROOT, path: '', provenance: 'local', status: 'active' },
      { room: TEAM_ROOM, path: 'team', provenance: 'adopted', status: 'adopting:detaching' },
    ])
    await writeFolderBlob(engine, dir, ROOT, {
      team: { guid: TEAM_ROOM, kind: 'mount' },
      'team/plan.md': { guid: 'g-plan', kind: 'text' },
    })

    await recoverMounts(dir, mountsFile, engine)

    expect((await mountsFile.load()).find((m) => m.room === TEAM_ROOM)?.status).toBe(
      'adopting:detaching'
    )
    // ...and nothing was scrubbed on the strength of a membership nobody knows.
    expect((await readFolderBlob(engine, dir, ROOT)).has('team/plan.md')).toBe(true)
  })

  it('folds an interrupted depth-1 dissolve into the OUTER mount, not the root (M6)', async () => {
    // `dissolveNested` writes 'absorbing', whose recovery row defaults to the
    // ROOT namespace — and the outer mount owns those paths. Without
    // `absorbInto` the inner namespace lands in the root, putting one guid in
    // two namespaces the moment the outer mount comes up.
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const mountsFile = new MountsFile(dir.io('mounts.json'))
    await mountsFile.save([
      { room: ROOT, path: '', provenance: 'local', status: 'active' },
      { room: TEAM_ROOM, path: 'team', provenance: 'adopted', status: 'active' },
      {
        room: SUB_ROOM,
        path: 'team/sub',
        provenance: 'carved',
        status: 'absorbing',
        absorbInto: TEAM_ROOM,
      },
    ])
    await writeFolderBlob(engine, dir, SUB_ROOM, {
      'nested.md': { guid: 'g-nested', kind: 'text' },
    })
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
    })
    await writeFolderBlob(engine, dir, ROOT, { team: { guid: TEAM_ROOM, kind: 'mount' } })

    await recoverMounts(dir, mountsFile, engine)

    expect([...(await readFolderBlob(engine, dir, TEAM_ROOM)).keys()].sort()).toEqual([
      'plan.md',
      'sub',
      'sub/nested.md',
    ])
    expect([...(await readFolderBlob(engine, dir, ROOT)).keys()]).toEqual(['team'])
    expect(await dir.list(`${SUB_ROOM}/`)).toEqual([])
  })

  it('repairs a stale root blob that still names an absorbed mount', async () => {
    // A peer writes 'absorbing' off the LIVE map; its own folder blob can
    // still be pre-announcement. Left alone, the next boot's adopt pass reads
    // a mount entry with no desc and adopts the subtree straight back into a
    // room that no longer exists. A dir entry states the same conclusion the
    // owner's announcement does — and a hard delete would not be ours to make.
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const mountsFile = new MountsFile(dir.io('mounts.json'))
    await mountsFile.save([
      { room: ROOT, path: '', provenance: 'local', status: 'active' },
      { room: TEAM_ROOM, path: 'team', provenance: 'adopted', status: 'absorbing' },
    ])
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
    })
    await writeFolderBlob(engine, dir, ROOT, { team: { guid: TEAM_ROOM, kind: 'mount' } })

    await recoverMounts(dir, mountsFile, engine)

    const root = await readFolderBlob(engine, dir, ROOT)
    expect(root.get('team')?.kind).toBe('dir')
    // ...and nothing else in the root map was rewritten: on a peer the map is
    // the owner's, so the subtree's entries arrive from the announcement, not
    // from a blob-loaded temp doc that may already be behind the live map.
    expect([...root.keys()]).toEqual(['team'])
    expect((await mountsFile.load()).some((m) => m.room === TEAM_ROOM)).toBe(false)
  })
})

describe('nested mounts — the guards that keep the root out of a mount (M4)', () => {
  it('never adopts a ghost key under an in-flight mount root into the root namespace', async () => {
    // The window: the mount entry has landed but this device has no desc yet,
    // so the host's ignore set is derived from the map alone — and
    // `ignoringAdapter` filters list/listDirs/watch, never the MAP. Every map
    // reader needs the boundary check `reconcileKnown` already had.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false, rootRelay: TEAM_TOKEN })
    try {
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
      // A peer that had not adopted yet dropped a file into the subtree.
      await base.writeAtomic('team/ghost.md', enc.encode('from another peer\n'))
      applyForeignMap(dev, (m) => {
        m.set('team/ghost.md', { guid: 'ghost-guid', kind: 'text' })
      })
      await settleTicks()

      // scanMap must not have adopted it: no doc, no provider, no LCA record
      // in the ROOT namespace for a guid whose subtree has moved.
      expect(dev.root.docForPath('team/ghost.md')).toBeNull()
      expect((await dev.root.lcaRecords()).map((r) => r.guid)).not.toContain('ghost-guid')

      // ...and neither does the next boot: `tryDurableReopen` and `bootScan`'s
      // changed pre-pass read the same map.
      dev.dispose()
      const reboot = await bootVault(base, dir, 'root-room', {
        autoAdopt: false,
        rootRelay: TEAM_TOKEN,
      })
      try {
        expect(reboot.root.docForPath('team/ghost.md')).toBeNull()
        expect((await reboot.root.lcaRecords()).map((r) => r.guid)).not.toContain('ghost-guid')
        // The bytes are untouched — kept, not adopted and not deleted.
        expect(await reboot.adapter.read('team/ghost.md')).not.toBeNull()
      } finally {
        reboot.dispose()
      }
    } catch (err) {
      dev.dispose()
      throw err
    }
  })

  it('a held boot batch re-derives the boundaries before it enrols (M4)', async () => {
    // The batch waits for a human, and a mount entry can arrive while it does.
    // Enrolling then would mint root-room guids for files a mount now owns.
    const base = await seedAdapter({ 'keep.md': 'root note\n' })
    const dir = new MemStoreDir()
    const first = await bootVault(base, dir, 'root-room', { rootRelay: TEAM_TOKEN })
    first.dispose()
    await settleTicks()

    for (const [path, text] of Object.entries({
      'extra/a.md': 'a\n',
      'extra/b.md': 'b\n',
      'extra/c.md': 'c\n',
    })) {
      await base.writeAtomic(path, enc.encode(text))
    }

    let held: string[] = []
    const dev = await bootVault(base, dir, 'root-room', {
      autoAdopt: false,
      rootRelay: TEAM_TOKEN,
      sessionDefaults: (mountPath) =>
        mountPath === ''
          ? { thresholds: { massChangePaths: 1 }, events: { onBreaker: (paths) => (held = paths) } }
          : {},
    })
    try {
      expect(held.sort()).toEqual(['extra/a.md', 'extra/b.md', 'extra/c.md'])
      // ...and NOW a peer's carve of that very folder arrives.
      applyForeignCarve(dev, 'extra', { room: TEAM_ROOM, relay: RELAY })
      await dev.root.confirmBreaker()

      expect(dev.root.files().map((r) => r.path).sort()).toEqual(['extra', 'keep.md'])
      expect(dev.root.mapEntries().find(([p]) => p === 'extra')?.[1].kind).toBe('mount')
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — depth 1 does not fight the desc repair (M9)', () => {
  it('dissolves an inner mount the outer already owns, instead of re-stating it', async () => {
    // The reachable shape: this device carved `team/sub` while the root was
    // shared, someone else carved `team` around it, and the device reboots
    // holding BOTH descs with both entries in the root map.
    //
    // The depth-1 rule hard-deletes the inner ANNOUNCEMENT — but nothing used
    // to move the inner mount's stores unless the OUTER was being adopted in
    // that same pass. So the inner desc survived with no map entry, the
    // desc-driven repair row put the entry straight back, and the two rows
    // took turns forever over a mount inside a mount that no device can
    // represent.
    const base = await seedAdapter({
      'keep.md': 'stays in the root vault\n',
      'team/plan.md': 'shared plan\n',
      'team/sub/nested.md': 'inner note\n',
    })
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    await new MountsFile(dir.io('mounts.json')).save([
      { room: 'root-room', path: '', provenance: 'local', status: 'active' },
      {
        room: TEAM_ROOM,
        path: 'team',
        provenance: 'adopted',
        relay: { url: RELAY },
        status: 'active',
      },
      {
        room: SUB_ROOM,
        path: 'team/sub',
        provenance: 'carved',
        relay: { url: RELAY },
        status: 'active',
      },
    ])
    await writeFolderBlob(engine, dir, SUB_ROOM, {
      'nested.md': { guid: 'g-nested', kind: 'text' },
    })
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
      sub: { guid: SUB_ROOM, kind: 'mount', relay: RELAY },
    })
    await writeFolderBlob(engine, dir, 'root-room', {
      'keep.md': { guid: 'g-keep', kind: 'text' },
      team: { guid: TEAM_ROOM, kind: 'mount', relay: RELAY },
      'team/sub': { guid: SUB_ROOM, kind: 'mount', relay: RELAY },
    })

    const dev = await bootVault(base, dir, 'root-room', {
      autoAdopt: false,
      rootRelay: TEAM_TOKEN,
      tokens: new Map([
        [TEAM_ROOM, TEAM_TOKEN],
        [SUB_ROOM, { url: RELAY, token: 'tok-sub' }],
      ]),
    })
    try {
      await dev.reconcile()

      expect(announcedMounts(dev.root)).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
      expect([...dev.mounts.keys()]).toEqual(['team'])
      expect(dev.descs().some((d) => d.room === SUB_ROOM)).toBe(false)
      expect(await dev.vaultDir.list(`${SUB_ROOM}/`)).toEqual([])
      // The inner namespace folded into the OUTER mount, guid for guid.
      expect(dev.mounts.get('team')!.files().map((r) => r.path).sort()).toEqual([
        'plan.md',
        'sub',
        'sub/nested.md',
      ])
      await checkInvariants(dev)

      // A second pass changes nothing — the row that used to re-state it.
      await dev.reconcile()
      expect(announcedMounts(dev.root)).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
      expect(dev.descs().some((d) => d.room === SUB_ROOM)).toBe(false)
      await checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — a peer deletes the folder while it is being carved (S10 Q5 row 9)', () => {
  it('the mount survives on both devices and the delete replays inside it', async () => {
    // Row 9 crossed with the carve itself. B deletes `team/` whole while A is
    // carving it, so the key at `team` carries A's `kind:'mount'` entry AND
    // B's dir tombstone, and Yjs's LWW hands it to one of them on every
    // device at once.
    //
    // When the tombstone won, the announcement was gone everywhere: A kept
    // running the mount it had just made, B never adopted, and the subtree
    // lived on one device for good. The desc-driven repair row treated a
    // tombstone as a settled state — it only ever fired on a MISSING key —
    // so nothing put the announcement back.
    const duo = await bootDuo({
      files: FILES,
      tokensA: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      tokensB: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      defaultsB: () => ({ thresholds: { massChangePaths: 50 } }),
    })
    try {
      await duo.deliver()
      duo.net.setOffline('A', true)
      duo.net.setOffline('B', true)
      await carveOn(duo.a, { path: 'team', room: TEAM_ROOM, token: 'team-token' })
      await duo.b.root.deletePath('team')
      duo.net.setOffline('A', false)
      duo.net.setOffline('B', false)
      await duo.deliver()

      for (const dev of [duo.a, duo.b]) {
        // The announcement stands on both devices, whoever won the key...
        expect(announcedMounts(dev.root)).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
        expect([...dev.mounts.keys()]).toEqual(['team'])
        await checkInvariants(dev)
      }
      // ...and B's delete was replayed INSIDE the mount rather than dropped,
      // so the two rooms agree about what is left.
      expect(mountRows(duo.a, 'team')).toEqual(mountRows(duo.b, 'team'))
      expect(await diskSnapshot(duo.a.adapter)).toEqual(await diskSnapshot(duo.b.adapter))
    } finally {
      duo.dispose()
    }
  })
})

describe('nested mounts — the empty adopt and its paste (N3, spike S10 Q2)', () => {
  const NEVER_HELD: MountDesc[] = [
    { room: 'root-room', path: '', provenance: 'local', status: 'active' },
    {
      room: TEAM_ROOM,
      path: 'team',
      provenance: 'adopted',
      relay: { url: RELAY },
      status: 'needs-token',
      neverHeld: true,
    },
  ]

  it('boots with an empty map and enrols nothing from disk', async () => {
    // The device whose app data was wiped but whose vault was kept. The files
    // under `team/` are the room's; enrolling them would mint fresh guids that
    // LWW-clobber the owner's entries at the first paste. "Keep + mark" means
    // the bytes stay and the folder is marked — not that they are adopted.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    await new MountsFile(dir.io('mounts.json')).save(NEVER_HELD)
    const before = await diskSnapshot(base)

    const dev = await bootVault(base, dir, 'root-room', { tokens: new Map() })
    try {
      expect(dev.mounts.get('team')!.files()).toEqual([])
      expect(rootTextPaths(dev)).toEqual(new Set(['keep.md']))
      expect(await diskSnapshot(base)).toEqual(before)
      // Nothing durable was invented for it either.
      expect(await dev.vaultDir.list(`${TEAM_ROOM}/`)).toEqual([])
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        status: 'needs-token',
        neverHeld: true,
      })
    } finally {
      dev.dispose()
    }
  })

  it('the paste rebuilds it as an awaited firstJoin, not an enableSharing', async () => {
    // The discriminator is `neverHeld`, not "does this session list files".
    // An empty folder blob would let `tryDurableReopen` win over `firstJoin`
    // and the awaited pull would never run — measured on the shim as a paste
    // that returned in 1 ms with 0 rows.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    await new MountsFile(dir.io('mounts.json')).save(NEVER_HELD)
    const dev = await bootVault(base, dir, 'root-room', { tokens: new Map() })
    try {
      const desc = dev.descs().find((d) => d.room === TEAM_ROOM)!
      dev.events.builds.length = 0 // only what the PASTE builds
      await activateMount({
        vaultDir: dev.vaultDir,
        mountsFile: dev.mountsFile,
        desc,
        session: dev.mounts.get('team')!,
        relay: TEAM_TOKEN,
        buildSession: async (o) => {
          const built = await dev.makeSession(o.room, scopedAdapter(dev.adapter, o.path), o.path, {
            provenance: o.provenance,
            ...(o.relay ? { relay: o.relay } : {}),
          })
          dev.events.builds.push({ room: o.room, path: o.path, firstJoin: o.firstJoin === true })
          return built
        },
        detachMount: (p) => dev.mounts.delete(p),
        attachMount: (p, next) => dev.mounts.set(p, next),
      })
      await dev.refreshDescs()

      expect(dev.events.builds.filter((b) => b.room === TEAM_ROOM)).toEqual([
        { room: TEAM_ROOM, path: 'team', firstJoin: true },
      ])
      const after = dev.descs().find((d) => d.room === TEAM_ROOM)!
      expect(after.status).toBe('active')
      expect(after.neverHeld).toBeUndefined()
    } finally {
      dev.dispose()
    }
  })

  it('pulls even when the session DOES list files — the desc decides, not the rows', async () => {
    // The discriminator that lost data: "does this session list any files".
    // A `neverHeld` mount whose boot enrolled the on-disk files under its root
    // lists plenty — and every one of them is a fresh guid this device minted
    // for a room it has never seen. `enableSharing` would push them into that
    // room and LWW-clobber the owner's entries. The desc is the authority.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    await new MountsFile(dir.io('mounts.json')).save(NEVER_HELD)
    const dev = await bootVault(base, dir, 'root-room', { tokens: new Map() })
    try {
      const desc = dev.descs().find((d) => d.room === TEAM_ROOM)!
      expect(desc.neverHeld).toBe(true)
      // A session that DID enrol the disk under the mount root — the state
      // the old discriminator saw and read as "this mount has content". (A
      // real adopted mount refuses to enrol at all now; `provenance: 'local'`
      // is how the fixture reproduces the rows without that refusal.)
      dev.mounts.get('team')!.dispose()
      const enrolled = await dev.makeSession(
        TEAM_ROOM,
        scopedAdapter(dev.adapter, 'team'),
        'team',
        { provenance: 'local' }
      )
      dev.mounts.set('team', enrolled)
      expect(enrolled.files().length).toBeGreaterThan(0)

      dev.events.builds.length = 0
      await activateMount({
        vaultDir: dev.vaultDir,
        mountsFile: dev.mountsFile,
        desc,
        session: enrolled,
        relay: TEAM_TOKEN,
        buildSession: async (o) => {
          dev.events.builds.push({ room: o.room, path: o.path, firstJoin: o.firstJoin === true })
          return dev.makeSession(o.room, scopedAdapter(dev.adapter, o.path), o.path, {
            provenance: o.provenance,
            ...(o.relay ? { relay: o.relay } : {}),
          })
        },
        detachMount: (p) => dev.mounts.delete(p),
        attachMount: (p, next) => dev.mounts.set(p, next),
      })

      expect(dev.events.builds).toEqual([{ room: TEAM_ROOM, path: 'team', firstJoin: true }])
      // ...and the guids it had minted went with the namespace.
      expect(enrolled.isShared()).toBe(false)
    } finally {
      dev.dispose()
    }
  })

  it('an announcement over the seed cap pulls the room instead of inventing a map', async () => {
    // Above 64 KB the `kind:'mount'` entry ships without its seed — the map is
    // advisory structure, not a payload every peer of the parent room carries
    // forever. There is then nothing shared to build the new room's history
    // from, and building one from THIS device's own membership is exactly the
    // independent-history bug the seed exists to prevent
    // (`fuzz-crashers/0003`). So the namespace stays empty and the mount pulls.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const before = await diskSnapshot(base)
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      const built: AdoptedMountOptions[] = []
      /** The mount's namespace as it stood when the machine asked for a session. */
      let namespaceAtBuild: string[] = []
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY, seed: false })
      await reconcileMountEntries(
        adoptCtx(dev, {
          relay: TEAM_TOKEN,
          onBuild: async (o) => {
            built.push(o)
            namespaceAtBuild = await dev.vaultDir.list(`${TEAM_ROOM}/`)
          },
        })
      )
      await dev.refreshDescs()

      expect(built.map((o) => ({ room: o.room, firstJoin: o.firstJoin === true }))).toEqual([
        { room: TEAM_ROOM, firstJoin: true },
      ])
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)?.neverHeld).toBe(true)
      // Nothing of ours was left in the mount's namespace to merge with — in
      // particular no folder blob, which would make `tryDurableReopen` win
      // over the pull the machine just asked for.
      expect(namespaceAtBuild).toEqual([])
      // ...and nothing of the subtree was left in the parent's either.
      expect(rootTextPaths(dev)).toEqual(new Set(['keep.md']))
      expect((await dev.root.lcaRecords()).every((r) => !r.path.startsWith('team/'))).toBe(true)
      // The files are untouched on disk the whole time (golden rule 1).
      expect(await diskSnapshot(base)).toEqual(before)
    } finally {
      dev.dispose()
    }
  })

  it('a SEEDED mount merges in place instead — no rebuild, no re-seed', async () => {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false, tokens: new Map() })
    try {
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
      await reconcileMountEntries(adoptCtx(dev, { relay: null }))
      const seeded = dev.mounts.get('team')!
      expect(seeded.files().length).toBeGreaterThan(0)
      await dev.refreshDescs()
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)?.neverHeld).toBeUndefined()

      const built: string[] = []
      const next = await activateMount({
        vaultDir: dev.vaultDir,
        mountsFile: dev.mountsFile,
        desc: dev.descs().find((d) => d.room === TEAM_ROOM)!,
        session: seeded,
        relay: TEAM_TOKEN,
        buildSession: async (o) => {
          built.push(o.room)
          throw new Error('a seeded mount must never be rebuilt')
        },
        detachMount: () => {},
        attachMount: () => {},
      })
      expect(next).toBe(seeded) // the same session, with a relay on it
      expect(built).toEqual([])
      expect(seeded.isShared()).toBe(true)
      await dev.refreshDescs()
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)?.status).toBe('active')
    } finally {
      dev.dispose()
    }
  })
})

/** Let queued map work (the session's own chain) run to quiescence. */
async function settleTicks(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}

// ---------------------------------------------------------------------------
// The review round: what a mount does when its credential, its namespace and
// its desc disagree (device-link N3 review).
// ---------------------------------------------------------------------------

describe('nested mounts — an adopted mount never enrols INTO its room', () => {
  it('refuses the fresh-vault branch when a credential is live', async () => {
    // The last line of the `bootFlagsFor` defence. A session built for an
    // adopted room with a live relay, no durable state and neither flag fell
    // into the fresh-vault branch: `enrollFolder` mints a guid per file on
    // disk and the connected provider pushes them straight into the room,
    // LWW-clobbering the owner's entries. Silent, permanent, and only visible
    // from the other device.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const before = await diskSnapshot(base)
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      const session = await dev.makeSession(
        TEAM_ROOM,
        scopedAdapter(dev.adapter, 'team'),
        'team',
        { provenance: 'adopted', relay: TEAM_TOKEN } // no firstJoin, no stores
      )
      dev.mounts.set('team', session)
      expect(session.files()).toEqual([])
      expect(await diskSnapshot(base)).toEqual(before)
      expect(dev.events.errors.map(String).join(' ')).toContain('not enrolling')
      // A 'local' mount in the same state still enrols — this is about rooms.
      const local = await dev.makeSession(
        'local-room',
        scopedAdapter(dev.adapter, 'team'),
        'team',
        { provenance: 'local' }
      )
      expect(local.files().length).toBeGreaterThan(0)
      local.dispose()
    } finally {
      dev.dispose()
    }
  })

  it('keeps + marks instead when there is no credential to push through', async () => {
    // Spike S10 Q2's promise, kept: a folder waiting for its key still shows
    // its files. Nothing can reach the room from here, so enrolling them costs
    // nothing — but the guids are this device's, not the room's, so the desc
    // says `neverHeld` and the paste PULLS rather than merging them in.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      const session = await dev.makeSession(
        TEAM_ROOM,
        scopedAdapter(dev.adapter, 'team'),
        'team',
        { provenance: 'adopted' } // provider-less: no relay
      )
      dev.mounts.set('team', session)
      expect(session.files().map((r) => r.path).sort()).toContain('plan.md')
      await dev.refreshDescs()
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)?.neverHeld).toBe(true)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — the re-point and re-key rows carry the desc (C3)', () => {
  it('a re-point keeps neverHeld, so the winner still pulls rather than enrols', async () => {
    // The loser's stores are copied verbatim into the winner's room, so
    // whatever they hold is what the winner holds. Dropping `neverHeld` told
    // the next boot the mount had content when it had none — and told the next
    // paste to merge when it had to pull.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false, tokens: new Map() })
    try {
      // An empty adopt of room A (seedless ⇒ neverHeld, no token ⇒ waits).
      applyForeignCarve(dev, 'team', { room: 'room-a', relay: RELAY, seed: false })
      await reconcileMountEntries(adoptCtx(dev, { relay: null }))
      await dev.refreshDescs()
      expect(dev.descs().find((d) => d.room === 'room-a')?.neverHeld).toBe(true)

      // ...and now the map says the folder lives in room B instead (row 10).
      const built: AdoptedMountOptions[] = []
      applyForeignMap(dev, (m) => {
        m.set('team', { guid: 'room-b', kind: 'mount', relay: RELAY })
      })
      await reconcileMountEntries(
        adoptCtx(dev, { relay: null, onBuild: (o) => void built.push(o) })
      )
      await dev.refreshDescs()

      const desc = dev.descs().find((d) => d.room === 'room-b')
      expect(desc?.neverHeld).toBe(true)
      expect(desc?.status).toBe('needs-token')
      expect(built.map((o) => ({ room: o.room, neverHeld: o.neverHeld === true }))).toEqual([
        { room: 'room-b', neverHeld: true },
      ])
    } finally {
      dev.dispose()
    }
  })

  it('a re-key rebuilds with the flags the desc implies, and settles both ways', async () => {
    // The mount root moved, and the entry at its new path names a relay this
    // device does hold a key for. Rebuilding without the derived flags put a
    // `neverHeld` mount back on the fresh-vault enrol branch; settling only
    // downward left it running a live provider while the tree still said
    // "Link needed" — sync state that lies (golden rule 4).
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false, tokens: new Map() })
    try {
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY, seed: false })
      await reconcileMountEntries(adoptCtx(dev, { relay: null }))
      await dev.refreshDescs()
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        status: 'needs-token',
        neverHeld: true,
      })

      // The folder is renamed on another device, and a token turns up for it.
      const built: AdoptedMountOptions[] = []
      applyForeignMap(dev, (m) => {
        const at = m.get('team')!
        m.delete('team')
        m.set('crew', at)
      })
      await reconcileMountEntries(
        adoptCtx(dev, { relay: TEAM_TOKEN, onBuild: (o) => void built.push(o) })
      )
      await dev.refreshDescs()

      expect(built.map((o) => ({ path: o.path, firstJoin: o.firstJoin === true }))).toEqual([
        { path: 'crew', firstJoin: true },
      ])
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)).toMatchObject({
        path: 'crew',
        status: 'active',
      })
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — the repair row and the announced seed', () => {
  it('restates the bytes the map last carried, not this session’s own', async () => {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', {
      autoAdopt: false,
      rootRelay: TEAM_TOKEN,
      tokens: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    try {
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY })
      const announced = dev.root.mountEntries()[0]!.seed
      expect(announced).toBeTypeOf('string')
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))

      // A concurrent rename/delete takes the key away; the repair row restates
      // it — with the SAME announcement every peer already applied.
      applyForeignMap(dev, (m) => m.delete('team'))
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))

      expect(dev.root.mountEntries()[0]?.seed).toBe(announced)
    } finally {
      dev.dispose()
    }
  })

  it('never publishes an EMPTY seed from a device that has never held the room', async () => {
    // On a `neverHeld` device the mount's folder doc is empty. Publishing that
    // as the room's seed tells every other peer the room is empty — the
    // owner's real announcement overwritten by a device that has never seen a
    // byte of it.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', {
      autoAdopt: false,
      rootRelay: TEAM_TOKEN,
      tokens: new Map(),
    })
    try {
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY, seed: false })
      await reconcileMountEntries(adoptCtx(dev, { relay: null }))
      await dev.refreshDescs()
      expect(dev.descs().find((d) => d.room === TEAM_ROOM)?.neverHeld).toBe(true)
      expect(dev.mounts.get('team')!.files()).toEqual([])

      applyForeignMap(dev, (m) => m.delete('team'))
      await reconcileMountEntries(adoptCtx(dev, { relay: null }))

      const entry = dev.root.mountEntries()[0]
      expect(entry?.room).toBe(TEAM_ROOM) // the mount is restated...
      expect(entry?.seed).toBeUndefined() // ...without a seed it cannot vouch for
    } finally {
      dev.dispose()
    }
  })

  it('treats a malformed seed as no seed at all, never as a throw', async () => {
    // The seed rides in a folder map any peer of the room can write, so it is
    // untrusted input. A throw here lands inside the adopt, which the boot
    // pass retries on every open: a permanent failure loop over one bad map
    // entry, with the subtree stranded meanwhile.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      applyForeignMap(dev, (m) => {
        for (const [p] of m.entries()) if (p === 'team' || p.startsWith('team/')) m.delete(p)
        m.set('team', { guid: TEAM_ROOM, kind: 'mount', relay: RELAY, seed: 'not base64 at all!!' })
      })
      await reconcileMountEntries(adoptCtx(dev, { relay: TEAM_TOKEN }))
      await dev.refreshDescs()

      const desc = dev.descs().find((d) => d.room === TEAM_ROOM)
      expect(desc?.neverHeld).toBe(true) // degraded to the pull path
      expect(desc && isRecoverable(desc.status)).toBe(false)
      expect(dev.events.errors).toEqual([])
      await checkInvariants(dev)
    } finally {
      dev.dispose()
    }
  })

  it('omits a seed whose BASE64 is over the cap, even when the raw update is not', async () => {
    // The cap has to be measured on what travels. 64 KB of Yjs is 87 KB of
    // map — a third over budget on every peer of the room, forever.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      const big = dev.engine.createDoc(`cap-fixture:${crypto.randomUUID()}`)
      big.transactMap((m) => {
        for (let i = 0; i < 700; i++) {
          m.set(`folder-${i}/note-${i}.md`, { guid: crypto.randomUUID(), kind: 'text' })
        }
      }, 'seed')
      const raw = dev.engine.encodeUpdateSince(big, null)
      big.destroy()
      // The window the bug lived in: under the cap raw, over it encoded.
      expect(raw.byteLength).toBeLessThanOrEqual(MAX_SEED_BYTES)
      expect(Math.ceil(raw.byteLength / 3) * 4).toBeGreaterThan(MAX_SEED_BYTES)

      await dev.root.setMountEntry('team', TEAM_ROOM, RELAY, raw)
      expect(dev.root.mountEntries()).toEqual([{ path: 'team', room: TEAM_ROOM, relay: RELAY }])
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — activateMount is one at a time', () => {
  it('a second paste joins the first instead of wiping the pull it is running', async () => {
    // The pull branch writes a recoverable status and WIPES the namespace. A
    // second call arriving mid-pull would re-enter both, then attach a second
    // session at the same path — and the first caller's attach would overwrite
    // it, leaving a live session nobody holds a handle to.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    await new MountsFile(dir.io('mounts.json')).save([
      { room: 'root-room', path: '', provenance: 'local', status: 'active' },
      {
        room: TEAM_ROOM,
        path: 'team',
        provenance: 'adopted',
        relay: { url: RELAY },
        status: 'needs-token',
        neverHeld: true,
      },
    ])
    const dev = await bootVault(base, dir, 'root-room', { tokens: new Map() })
    try {
      const desc = dev.descs().find((d) => d.room === TEAM_ROOM)!
      let built = 0
      const activate = (): Promise<MountSession> =>
        activateMount({
          vaultDir: dev.vaultDir,
          mountsFile: dev.mountsFile,
          desc,
          session: dev.mounts.get('team')!,
          relay: TEAM_TOKEN,
          buildSession: async (o) => {
            built++
            await new Promise((r) => setTimeout(r, 5)) // the pull takes a while
            return dev.makeSession(o.room, scopedAdapter(dev.adapter, o.path), o.path, {
              provenance: o.provenance,
              ...(o.relay ? { relay: o.relay } : {}),
            })
          },
          detachMount: (p) => dev.mounts.delete(p),
          attachMount: (p, next) => dev.mounts.set(p, next),
        })

      const [first, second] = await Promise.all([activate(), activate()])
      expect(built).toBe(1)
      expect(second).toBe(first)
      expect(dev.mounts.get('team')).toBe(first)
    } finally {
      dev.dispose()
    }
  })
})

describe('nested mounts — the orphan-namespace sweep keeps its receipts', () => {
  it('drops a dead room’s derived state but never its journal', async () => {
    // Doc blobs and LCA records of a room nobody names any more are derived
    // and safe to drop. The journal is not: every Editor-initiated disk write
    // records its pre-image there first (golden rule 1), and those entries are
    // the only copy of what a file looked like before we touched it.
    const dir = new MemStoreDir()
    await new MountsFile(dir.io('mounts.json')).save([
      { room: 'root-room', path: '', provenance: 'local', status: 'active' },
    ])
    await dir.io('dead-room/docs/g.bin').writeAtomic(enc.encode('blob'))
    await dir.io('dead-room/lca/g.json').writeAtomic(enc.encode('{}'))
    await dir.io('dead-room/journal/1.900-team%2Fplan.md.bin').writeAtomic(enc.encode('pre-image'))

    await recoverMounts(dir, new MountsFile(dir.io('mounts.json')), createYjsEngine())

    expect(await dir.list('dead-room/')).toEqual(['dead-room/journal/1.900-team%2Fplan.md.bin'])
    expect(dec.decode((await dir.io('dead-room/journal/1.900-team%2Fplan.md.bin').read())!)).toBe(
      'pre-image'
    )
  })
})

describe('nested mounts — the absorb never restores an inner announcement', () => {
  it('drops a child kind:mount entry when folding a dissolved room back', async () => {
    // A dissolved mount's map can still name an inner one. Putting that back
    // announces a room that no longer exists — carrying a stale seed every
    // peer would then adopt from. The live twin (`announceAbsorb`) filters
    // them; boot recovery has to agree.
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    const mountsFile = new MountsFile(dir.io('mounts.json'))
    await mountsFile.save([
      { room: 'root-room', path: '', provenance: 'local', status: 'active' },
      { room: TEAM_ROOM, path: 'team', provenance: 'carved', status: 'unsharing:absorbing' },
    ])
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
      sub: { guid: SUB_ROOM, kind: 'mount', relay: RELAY, seed: 'c3RhbGU=' },
    })
    await writeFolderBlob(engine, dir, 'root-room', { team: { guid: TEAM_ROOM, kind: 'mount' } })

    await recoverMounts(dir, mountsFile, engine)

    const root = await readFolderBlob(engine, dir, 'root-room')
    expect(root.get('team/plan.md')).toEqual({ guid: 'g-plan', kind: 'text' })
    expect(root.has('team/sub')).toBe(false)
  })
})

describe('nested mounts — the empty adopt settles only after the wipe', () => {
  it('a mount told to pull pulls, whatever an interrupted adopt left behind', async () => {
    // An interrupted adopt can roll FORWARD into a settled desc while the
    // seeded folder blob is still there. `tryDurableReopen` would accept that
    // map — the room's file list with none of its content — and the awaited
    // pull would never run. On a mount, an explicit `firstJoin` outranks
    // durable state for exactly this reason.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const engine = createYjsEngine()
    await new MountsFile(dir.io('mounts.json')).save([
      { room: 'root-room', path: '', provenance: 'local', status: 'active' },
      {
        room: TEAM_ROOM,
        path: 'team',
        provenance: 'adopted',
        relay: { url: RELAY },
        status: 'active',
        neverHeld: true,
      },
    ])
    // The leftover: a map, and nothing behind it.
    await writeFolderBlob(engine, dir, TEAM_ROOM, {
      'plan.md': { guid: 'g-plan', kind: 'text' },
    })

    const dev = await bootVault(base, dir, 'root-room', {
      tokens: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
    })
    try {
      expect(dev.events.builds.filter((b) => b.room === TEAM_ROOM)).toEqual([
        { room: TEAM_ROOM, path: 'team', firstJoin: true },
      ])
      // ...and it did NOT come up holding that map (the fixture stands a pull
      // in as an empty boot — what matters is that the blob did not win).
      expect(dev.mounts.get('team')!.files()).toEqual([])
    } finally {
      dev.dispose()
    }
  })

  it('writes a RECOVERABLE status over the wipe, never a settled one', async () => {
    // The wipe drops the namespace the seed step just built. Settling first
    // and wiping after leaves a crash in between with a desc that says
    // `active`/`needs-token` over a half-removed namespace and no machine
    // that owns it. 'joining' rolls back — drop what is left and the desc with
    // it — and the boot pass re-adopts, which is the retry this wants.
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
    try {
      /** Every status this room's desc passed through, in order. */
      const seen: string[] = []
      const mountsFile = hookedMounts(dir, async (json) => {
        const desc = (JSON.parse(json) as MountDesc[]).find((d) => d.room === TEAM_ROOM)
        if (desc && seen[seen.length - 1] !== desc.status) seen.push(desc.status)
      })
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY, seed: false })
      await reconcileMountEntries({ ...adoptCtx(dev, { relay: null }), mountsFile })

      // ...and the last recoverable one it passed through is the wipe's.
      expect(seen).toContain('joining')
      expect(seen.indexOf('joining')).toBeGreaterThan(seen.indexOf('adopting:detaching'))
      expect(seen[seen.length - 1]).toBe('needs-token')
      expect(await dev.vaultDir.list(`${TEAM_ROOM}/`)).toEqual([])
    } finally {
      dev.dispose()
    }
  })

  it('never leaves a settled desc over a namespace it cannot fill', async () => {
    // The wipe used to run AFTER the status settled. A crash in between left a
    // desc saying `active`/`needs-token` over a namespace holding the seeded
    // folder blob and nothing else — which the next boot's `tryDurableReopen`
    // wins with, giving the mount a map it has no content for and no pull to
    // fill it. Every kill point must leave either a recoverable desc or a
    // settled one with no blob behind it.
    for (let budget = 0; budget < 40; budget++) {
      const base = await seedAdapter(FILES)
      const dir = new MemStoreDir()
      const dev = await bootVault(base, dir, 'root-room', { autoAdopt: false })
      applyForeignCarve(dev, 'team', { room: TEAM_ROOM, relay: RELAY, seed: false })
      let crashed = false
      try {
        await reconcileMountEntries(
          adoptCtx({ ...dev, vaultDir: crashingDir(dir, budget) }, { relay: null })
        )
      } catch (err) {
        crashed = true
        expect(String(err)).toContain('injected-crash')
      }
      dev.dispose()

      // Reboot WITH a credential — the case that matters. Whatever the kill
      // point left in the namespace, a mount whose desc says `neverHeld` must
      // fetch the room rather than come up holding a half-written map of it.
      const reboot = await bootVault(base, dir, 'root-room', {
        tokens: new Map([[TEAM_ROOM, TEAM_TOKEN]]),
      })
      await reboot.reconcile()
      const desc = reboot.descs().find((d) => d.room === TEAM_ROOM)
      if (desc?.neverHeld) {
        expect(
          reboot.events.builds.filter((b) => b.room === TEAM_ROOM).map((b) => b.firstJoin)
        ).toEqual([true])
        expect(reboot.mounts.get('team')!.files()).toEqual([])
      }
      await checkInvariants(reboot)
      reboot.dispose()
      if (!crashed) return
    }
    throw new Error('crash budget never reached the happy path — raise the sweep bound')
  }, 60_000)
})
