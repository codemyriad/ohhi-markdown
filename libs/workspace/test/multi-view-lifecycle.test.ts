/**
 * L1 fixture for spike S9 (multi-pane docSession lifecycle) — the build gate
 * of tab-groups W1.
 *
 * `MountSession`'s editor-ownership policy used to be written for ONE open
 * path per mount. With panes and tabs, N views can hold N notes and two of
 * them can hold the SAME note, so the policy is now a set: `setOpenPaths`.
 * What has to stay true, for every open/close/rename/delete/unshare ordering
 * (shaping R4.1, S9 Q1–Q3):
 *
 *  - no edit is lost to disk;
 *  - no open doc is materialized over while ANY view still holds it — the
 *    reconciler noops for a path in `ctx.openPaths` and the editor's own
 *    flush is the single writer;
 *  - `markClosed` runs exactly ONCE per guid, at the LAST close;
 *  - a pending flush debounce is cancelled at mount teardown;
 *  - the same guid open in two views flushes once, not twice.
 *
 * The probe for "materialized over" is an A/B: a FOREIGN doc update schedules
 * a reconcile 50 ms later, which materializes CRDT→disk for a closed doc and
 * noops for an open one. So "did the disk move within 100 ms of a peer's
 * edit?" answers "who owns this file?" without reaching into private state.
 */
import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { MemStoreDir, MountsFile, VaultSession, type MemVaultAdapter } from '@ohhi/vault'
import { carveFolder } from '../src/carve.js'
import { MountRegistry } from '../src/registry.js'
import type { MountSession } from '../src/mount-session.js'
import { unshareMount } from '../src/unshare.js'
import {
  applyForeignMap,
  bootVault,
  dec,
  diskSnapshot,
  seedAdapter,
  watchWrites,
  yieldMacro,
  type BootedVault,
} from './fixture.js'

const ROOT_ROOM = 'root-room'
const TEAM_ROOM = 'team-room'

const FILES: Record<string, string> = {
  'a.md': 'alpha\n',
  'b.md': 'bravo\n',
  'notes/deep.md': 'deep\n',
  'team/plan.md': 'plan\n',
}

/** Per-PR bound; the nightly lane raises it (testing skill, CI budget). */
const RUNS = Number(process.env['MULTI_VIEW_RUNS'] ?? 40)

/**
 * Advance the sim clock by `ms` and let the promise chains it started run.
 * Deliberately NOT a loop to quiescence: the whole point of these tests is
 * what has (and has not) happened at a given instant.
 */
async function tick(vault: BootedVault, ms: number): Promise<void> {
  vault.clock.advance(ms)
  for (let i = 0; i < 6; i++) await yieldMacro()
}

/**
 * A peer's edit, delivered the way a relay provider would (a foreign origin,
 * so the vault session schedules its own reconcile). The ':' in the temp doc's
 * name keeps it off the fixture's net, exactly as `applyForeignCarve` does.
 */
function applyForeignEdit(vault: BootedVault, session: MountSession, path: string, text: string): void {
  const doc = session.docForPath(path)!
  const peer = vault.engine.createDoc(`peer:${doc.guid}`)
  vault.engine.applyUpdate(peer, vault.engine.encodeUpdateSince(doc, null), 'remote')
  peer.transact((t) => t.insert(0, text), 'local')
  vault.engine.applyUpdate(doc, vault.engine.encodeUpdateSince(peer, null), 'remote')
  peer.destroy()
}

/**
 * The web facade's refcount, in miniature (S9 Q1): view id → path, collapsed
 * to ONE set per mount and handed to `setOpenPaths`. The pane tree that feeds
 * it lives in apps/web; what libs/workspace has to get right is what it
 * drives, so the model sits next to the thing it drives. Ownership uses the
 * production `MountRegistry.resolve`, never a second copy of that rule.
 */
class Views {
  private readonly byView = new Map<string, string>()

  constructor(private readonly vault: BootedVault) {}

  open(view: string, path: string): void {
    this.byView.set(view, path)
    this.apply()
  }

  close(view: string): void {
    this.byView.delete(view)
    this.apply()
  }

  /** The shell's rename hook: a folder rename repoints every view under it. */
  rename(from: string, to: string): void {
    for (const [view, path] of this.byView) {
      if (path === from) this.byView.set(view, to)
      else if (path.startsWith(`${from}/`)) this.byView.set(view, `${to}/${path.slice(from.length + 1)}`)
    }
    this.apply()
  }

  /** `dropLiveViewsUnder`: release a subtree whose docs are about to die. */
  dropUnder(prefix: string): void {
    for (const [view, path] of this.byView) {
      if (path === prefix || path.startsWith(`${prefix}/`)) this.byView.delete(view)
    }
    this.apply()
  }

  /** `reapplyLiveViews`: a rebuilt mount is a NEW session with an empty set. */
  reapply(): void {
    this.apply()
  }

  paths(): Set<string> {
    return new Set(this.byView.values())
  }

  private apply(): void {
    const registry = new MountRegistry()
    const perSession = new Map<MountSession, Set<string>>()
    for (const { mountPath, session } of this.vault.registry()) {
      registry.add(mountPath, session)
      perSession.set(session, new Set())
    }
    for (const path of this.paths()) {
      const resolved = registry.resolve(path)
      if (resolved) perSession.get(resolved.session)!.add(resolved.rel)
    }
    for (const [session, rels] of perSession) session.setOpenPaths(rels)
  }
}

/**
 * Count `markOpen` / `markClosed` per guid across every VaultSession. The real
 * implementations still run — the policy under test is what they DO, not a
 * stub — so this is a tap, not a mock.
 */
function spyOnLifecycle(): {
  opened: string[]
  closed: string[]
  reset: () => void
  restore: () => void
} {
  const opened: string[] = []
  const closed: string[] = []
  const realOpen = VaultSession.prototype.markOpen
  const realClosed = VaultSession.prototype.markClosed
  VaultSession.prototype.markOpen = function (guid: string): void {
    opened.push(guid)
    realOpen.call(this, guid)
  }
  VaultSession.prototype.markClosed = async function (guid: string): Promise<void> {
    closed.push(guid)
    await realClosed.call(this, guid)
  }
  return {
    opened,
    closed,
    reset: () => {
      opened.length = 0
      closed.length = 0
    },
    restore: () => {
      VaultSession.prototype.markOpen = realOpen
      VaultSession.prototype.markClosed = realClosed
    },
  }
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
    room: TEAM_ROOM,
    relayUrl: 'ws://relay.test',
    addIgnore: (p) => first.ignore.add(p),
  })
  first.dispose()
  const vault = await bootVault(base, dir, ROOT_ROOM)
  return { base, dir, vault }
}

describe('S9 — N views over one mount', () => {
  it('the same note in two views: one flush, one markClosed, at the LAST close', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    const life = spyOnLifecycle()
    try {
      const views = new Views(vault)
      const guid = vault.root.files().find((r) => r.path === 'a.md')!.guid

      views.open('pane1', 'a.md')
      views.open('pane2', 'a.md')
      await yieldMacro()
      // Two views, ONE membership: the doc is opened once, not twice.
      expect(life.opened.filter((g) => g === guid)).toEqual([guid])

      vault.root.docForPath('a.md')!.transact((t) => t.insert(5, ' edited'), 'local')
      writes.reset()

      // The first view leaves while the second still holds the note: nothing
      // closes, nothing is written, the pending flush stays armed (S9 Q2).
      views.close('pane1')
      await tick(vault, 100)
      expect(life.closed).toEqual([])
      expect(writes.paths).toEqual([])

      // One debounce for the doc, not one per view — so ONE flush.
      await tick(vault, 1000)
      expect(writes.paths).toEqual(['a.md'])
      expect(dec.decode((await base.read('a.md'))!)).toBe('alpha edited\n')

      writes.reset()
      views.close('pane2')
      await tick(vault, 300)
      expect(life.closed).toEqual([guid]) // exactly once, at the last close
      expect(vault.events.errors).toEqual([])
    } finally {
      life.restore()
      vault.dispose()
    }
  })

  it('a peer edit never materializes over a doc while any view holds it', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    try {
      const views = new Views(vault)
      views.open('pane1', 'a.md')
      views.open('pane2', 'a.md')
      await yieldMacro()

      // Held by two views → the reconciler noops; the editor's flush is the
      // only writer, and it has not fired yet.
      applyForeignEdit(vault, vault.root, 'a.md', 'one ')
      writes.reset()
      await tick(vault, 100)
      expect(writes.paths).toEqual([])

      // Held by ONE view → still nobody else's to write.
      views.close('pane1')
      applyForeignEdit(vault, vault.root, 'a.md', 'two ')
      writes.reset()
      await tick(vault, 100)
      expect(writes.paths).toEqual([])

      // The last view leaves: the doc is closed and reconciled, and every
      // edit made while it was held reaches disk (nothing is lost).
      views.close('pane2')
      await tick(vault, 300)
      expect(dec.decode((await base.read('a.md'))!)).toBe('two one alpha\n')

      // Now closed: a peer edit materializes on the reconciler's own schedule.
      applyForeignEdit(vault, vault.root, 'a.md', 'three ')
      writes.reset()
      await tick(vault, 100)
      expect(writes.paths).toEqual(['a.md'])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('different notes in different views close independently', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const life = spyOnLifecycle()
    try {
      const views = new Views(vault)
      const guidA = vault.root.files().find((r) => r.path === 'a.md')!.guid
      const guidB = vault.root.files().find((r) => r.path === 'b.md')!.guid

      views.open('pane1', 'a.md')
      views.open('pane2', 'b.md')
      await yieldMacro()
      expect(new Set(life.opened)).toEqual(new Set([guidA, guidB]))

      // Re-pointing pane2 at a.md closes b.md and opens nothing new: a.md is
      // already held by pane1.
      life.reset()
      views.open('pane2', 'a.md')
      await tick(vault, 300)
      expect(life.closed).toEqual([guidB])
      expect(life.opened).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      life.restore()
      vault.dispose()
    }
  })

  it('a view held over a note that does not exist YET is marked when it does', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    const life = spyOnLifecycle()
    try {
      const views = new Views(vault)
      // A path can be in the open set before it has a guid: a tab survives the
      // note it points at being deleted and re-created, and a peer's note
      // arrives as a map change with no restart to re-mark anything. The mark
      // used to be skipped silently and never retried (Minor 4), leaving a
      // live buffer the reconciler was free to materialize over.
      views.open('pane1', 'peer-note.md')
      await yieldMacro()
      expect(life.opened).toEqual([]) // there is nothing to name yet

      const guid = crypto.randomUUID()
      const peerDoc = vault.engine.createDoc(`peer:${guid}`)
      peerDoc.transact((t) => t.insert(0, 'from the other device\n'), 'local')
      applyForeignMap(vault, (m) => m.set('peer-note.md', { guid, kind: 'text' }), ROOT_ROOM)
      await tick(vault, 300)
      // The adopt pass created the doc and materialized the room's bytes; the
      // retry pass then marked the path its view holds.
      vault.engine.applyUpdate(
        vault.root.docForPath('peer-note.md')!,
        vault.engine.encodeUpdateSince(peerDoc, null),
        'remote'
      )
      peerDoc.destroy()
      await tick(vault, 300)
      expect(new Set(life.opened)).toEqual(new Set([guid]))

      // Which is the whole point: the note is the editor's now, so the NEXT
      // peer edit waits for the flush instead of landing on disk under it.
      applyForeignEdit(vault, vault.root, 'peer-note.md', 'more ')
      writes.reset()
      await tick(vault, 300)
      expect(writes.paths).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      life.restore()
      vault.dispose()
    }
  })

  it('a session restart re-marks every held path (the reattach)', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    try {
      const views = new Views(vault)
      views.open('pane1', 'a.md')
      views.open('pane2', 'b.md')
      await yieldMacro()

      // Creating a note rebuilds the VaultSession, whose ctx.openPaths starts
      // empty — every path a view still holds has to be re-marked or the next
      // peer edit materializes over a live buffer.
      await vault.root.createFile('', 'c.md', 'charlie\n')
      await tick(vault, 100)
      applyForeignEdit(vault, vault.root, 'a.md', 'peer ')
      applyForeignEdit(vault, vault.root, 'b.md', 'peer ')
      writes.reset()
      await tick(vault, 100)
      expect(writes.paths).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })
})

describe('S9 — renames and deletes under live views', () => {
  it('a rename keeps ownership BEFORE the shell catches up: still the flush path', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    const life = spyOnLifecycle()
    try {
      const views = new Views(vault)
      views.open('pane1', 'a.md')
      views.open('pane2', 'a.md')
      await yieldMacro()
      life.reset()

      // The session rekeys its OWN open set from the rename hook, so an edit
      // arriving in the window before the shell re-derives its live set still
      // routes to the editor-owned flush (800 ms) rather than the closed
      // reconcile (200 ms), which would markClosed a note two views hold.
      await vault.root.renamePath('a.md', 'renamed.md')
      applyForeignEdit(vault, vault.root, 'renamed.md', 'peer ')
      writes.reset()
      await tick(vault, 300)
      expect(life.closed).toEqual([])
      expect(writes.paths).toEqual([])

      views.rename('a.md', 'renamed.md') // the shell's onPathsRenamed hook
      await tick(vault, 100)
      expect(life.closed).toEqual([])

      vault.root.docForPath('renamed.md')!.transact((t) => t.insert(0, 'mine '), 'local')
      await tick(vault, 1000)
      expect(writes.paths).toEqual(['renamed.md'])
      expect(dec.decode((await base.read('renamed.md'))!)).toBe('mine peer alpha\n')
      expect(await base.read('a.md')).toBeNull()
      expect(vault.events.errors).toEqual([])
    } finally {
      life.restore()
      vault.dispose()
    }
  })

  it('a folder rename repoints every view under it', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    try {
      const views = new Views(vault)
      views.open('pane1', 'notes/deep.md')
      views.open('pane2', 'notes/deep.md')
      await yieldMacro()

      await vault.root.renamePath('notes', 'archive')
      views.rename('notes', 'archive')
      await tick(vault, 100)
      expect(views.paths()).toEqual(new Set(['archive/deep.md']))

      // Ownership followed the prefix: the note is still the editor's.
      applyForeignEdit(vault, vault.root, 'archive/deep.md', 'peer ')
      writes.reset()
      await tick(vault, 100)
      expect(writes.paths).toEqual([])

      views.close('pane1')
      views.close('pane2')
      await tick(vault, 300)
      expect(dec.decode((await base.read('archive/deep.md'))!)).toBe('peer deep\n')
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })

  it('deleting a note held by two views releases both and loses nothing else', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    const writes = watchWrites(base)
    const life = spyOnLifecycle()
    try {
      const views = new Views(vault)
      const guidA = vault.root.files().find((r) => r.path === 'a.md')!.guid
      views.open('pane1', 'a.md')
      views.open('pane2', 'a.md')
      views.open('pane3', 'b.md')
      await yieldMacro()
      life.reset()

      // The mount lets go of the doomed path ITSELF, without waiting for the
      // shell to prune the tabs — the bytes are about to go, and a path left
      // in the open set would keep the reconciler off a file that no longer
      // exists (and off any note later created at that path).
      await vault.root.deletePath('a.md')
      await tick(vault, 300)
      expect(life.closed).toEqual([guidA])
      expect(await base.read('a.md')).toBeNull()

      // The unrelated views are untouched: b.md is still editor-owned.
      applyForeignEdit(vault, vault.root, 'b.md', 'peer ')
      writes.reset()
      await tick(vault, 100)
      expect(writes.paths).toEqual([])

      // The shell catches up (prune closes the orphaned tabs): still no second
      // close for the deleted guid.
      views.close('pane1')
      views.close('pane2')
      await tick(vault, 300)
      expect(life.closed).toEqual([guidA])
      expect(vault.events.errors).toEqual([])
    } finally {
      life.restore()
      vault.dispose()
    }
  })
})

describe('S9 — teardown', () => {
  it('cancels a pending flush debounce, and the edit survives the reboot', async () => {
    const base = await seedAdapter(FILES)
    const dir = new MemStoreDir()
    const vault = await bootVault(base, dir, ROOT_ROOM)
    const writes = watchWrites(base)
    const views = new Views(vault)
    views.open('pane1', 'a.md')
    await yieldMacro()
    const idle = vault.clock.pendingCount()
    vault.root.docForPath('a.md')!.transact((t) => t.insert(5, ' edited'), 'local')
    const armed = vault.clock.pendingCount()
    expect(armed).toBeGreaterThan(idle) // the flush debounce is on the clock

    await vault.root.shutdown()
    // EXACTLY back to idle, not merely fewer (M7): the edit arms two timers —
    // the flush debounce and the doc-store's blob debounce — and `< armed`
    // passed on the blob one alone, so it held with `shutdown`'s debounce
    // cancel loop deleted. The count is the only handle the sim clock gives
    // on "nothing of ours is still armed", so it has to be an equality.
    expect(vault.clock.pendingCount()).toBe(idle)

    // Nothing writes after teardown, however far the clock runs.
    writes.reset()
    await tick(vault, 5000)
    expect(writes.paths).toEqual([])
    vault.dispose()

    // The edit is not lost: it is durable in the doc store, and the next boot
    // reconciles it onto disk.
    const reboot = await bootVault(base, dir, ROOT_ROOM)
    try {
      await tick(reboot, 1000)
      expect(dec.decode((await base.read('a.md'))!)).toBe('alpha edited\n')
      expect(reboot.events.errors).toEqual([])
    } finally {
      reboot.dispose()
    }
  })

  it('releasing the views BEFORE teardown flushes the edit through the normal path', async () => {
    const base = await seedAdapter(FILES)
    const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
    try {
      const views = new Views(vault)
      views.open('pane1', 'a.md')
      views.open('pane2', 'a.md')
      await yieldMacro()
      vault.root.docForPath('a.md')!.transact((t) => t.insert(5, ' edited'), 'local')

      // S9 Q3's ordering: the counts drop to 0 first, so the pending debounce
      // is cancelled by setOpenPaths(∅) and the close reconcile writes the
      // bytes — before any doc instance is destroyed.
      views.close('pane1')
      views.close('pane2')
      await tick(vault, 300)
      expect(dec.decode((await base.read('a.md'))!)).toBe('alpha edited\n')
      await vault.root.shutdown()
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })
})

describe('S9 — unshare with views open', () => {
  it('releases the mount subtree, keeps ownership of the notes outside it', async () => {
    const { base, dir, vault } = await carvedVault()
    try {
      const views = new Views(vault)
      views.open('pane1', 'team/plan.md')
      views.open('pane2', 'a.md')
      await yieldMacro()

      vault.mounts.get('team')!.docForPath('plan.md')!.transact((t) => t.insert(4, ' edited'), 'local')
      await tick(vault, 1000) // the open flush lands before the surgery

      // The facade's order: drop the views under the mount, THEN tear down.
      views.dropUnder('team')
      await tick(vault, 300)
      const before = await diskSnapshot(base)

      await unshareMount({
        vaultDir: dir,
        mountsFile: new MountsFile(dir.io('mounts.json')),
        engine: vault.engine,
        rootRoom: ROOT_ROOM,
        desc: { room: TEAM_ROOM, path: 'team' },
        mount: vault.mounts.get('team')!,
        root: vault.root,
        removeIgnore: (p) => vault.ignore.delete(p),
      })
      vault.mounts.delete('team')
      await vault.rebuildRoot()
      views.reapply() // the root is a NEW session and knows nothing

      // Not a byte moved, and the edit made while it was shared is on disk.
      expect(await diskSnapshot(base)).toEqual(before)
      expect(before['team/plan.md']).toBe('plan edited\n')

      // a.md is still held: the rebuilt root was re-told.
      const writes = watchWrites(base)
      applyForeignEdit(vault, vault.root, 'a.md', 'peer ')
      await tick(vault, 100)
      expect(writes.paths).toEqual([])
      expect(vault.events.errors).toEqual([])
    } finally {
      vault.dispose()
    }
  })
})

describe('S9 — property: markOpen/markClosed track the refcount exactly', () => {
  it('opens on 0→1 and closes on 1→0, whatever the interleaving', async () => {
    const paths = ['a.md', 'b.md', 'team/plan.md']
    const viewIds = ['p1', 'p2', 'p3']
    const command = fc.oneof(
      fc.record({ op: fc.constant('open' as const), view: fc.constantFrom(...viewIds), path: fc.constantFrom(...paths) }),
      fc.record({ op: fc.constant('close' as const), view: fc.constantFrom(...viewIds) })
    )
    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 14 }), async (script) => {
        const base = await seedAdapter(FILES)
        const vault = await bootVault(base, new MemStoreDir(), ROOT_ROOM)
        const life = spyOnLifecycle()
        try {
          const views = new Views(vault)
          const guidOf = new Map(
            vault.root
              .files()
              .filter((r) => r.kind === 'text')
              .map((r) => [r.path, r.guid] as const)
          )
          /** The model: how many views hold each path right now. */
          const refs = new Map<string, number>()
          const held = new Map<string, string>()
          const expectedOpens: string[] = []
          const expectedCloses: string[] = []
          const rebind = (view: string, path: string | null): void => {
            const prev = held.get(view)
            if (prev === path) return
            if (prev !== undefined) {
              const left = refs.get(prev)! - 1
              refs.set(prev, left)
              if (left === 0) expectedCloses.push(guidOf.get(prev)!)
            }
            if (path === null) held.delete(view)
            else {
              held.set(view, path)
              const now = (refs.get(path) ?? 0) + 1
              refs.set(path, now)
              if (now === 1) expectedOpens.push(guidOf.get(path)!)
            }
          }

          for (const cmd of script) {
            if (cmd.op === 'open') {
              rebind(cmd.view, cmd.path)
              views.open(cmd.view, cmd.path)
            } else {
              rebind(cmd.view, null)
              views.close(cmd.view)
            }
            await yieldMacro()
          }
          // No edits in this script, so nothing else can call either hook:
          // the sequences must match the refcount's transitions exactly.
          expect(life.opened).toEqual(expectedOpens)
          expect(life.closed).toEqual(expectedCloses)
          expect(vault.events.errors).toEqual([])
        } finally {
          life.restore()
          vault.dispose()
        }
      }),
      { numRuns: RUNS }
    )
  }, 120_000)
})
