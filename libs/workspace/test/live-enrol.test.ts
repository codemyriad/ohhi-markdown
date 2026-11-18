/**
 * Live enrol-on-create (`agent-surface-shaping`: agents are first-class
 * writers). A file an outside writer puts in the vault while the app runs is
 * enrolled at once, by the boot scan's rules, instead of waiting for the next
 * launch; a populated folder moved in arrives as one directory event and is
 * listed; and the watch breaker counts new files together with known ones.
 * memfs adapter, injected SimClock — the web shim's wiring, as in
 * boot-machine.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import {
  BlobDocStore,
  FileJournal,
  ignoringAdapter,
  JsonFileLcaStore,
  lcaGuard,
  MemStoreDir,
  MemVaultAdapter,
  MountsFile,
  scopedStoreDir,
  type VaultAdapter,
} from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import type { AppEvent } from '../src/events.js'
import { MountSession } from '../src/mount-session.js'
import type { SyncRecordFields } from '../src/types.js'
import { yieldMacro } from './fixture.js'

const enc = new TextEncoder()
const ROOM = 'room-live'

async function boot(
  adapter: VaultAdapter,
  opts: { onBreaker?: (paths: string[]) => void; onEvent?: (e: AppEvent) => void; storeDir?: MemStoreDir } = {}
) {
  const engine = createYjsEngine()
  const clock = new SimClock()
  const storeDir = opts.storeDir ?? new MemStoreDir()
  const mountDir = scopedStoreDir(storeDir, `${ROOM}/`)
  const docStore = new BlobDocStore(engine, mountDir, clock)
  const errors: unknown[] = []
  const records = new Map<string, SyncRecordFields>()
  const changed: string[] = []
  /** Every [guid, path] a content listener heard of. */
  const seen: [string, string][] = []
  const session = await MountSession.create({
    engine,
    adapter,
    user: { name: 'Test', color: '#000' },
    room: ROOM,
    clock,
    lcaStore: lcaGuard(docStore, new JsonFileLcaStore(mountDir.io('lca.json'))),
    journal: new FileJournal(mountDir, { now: () => clock.now() }),
    docStore,
    mountsFile: new MountsFile(storeDir.io('mounts.json')),
    recordFor: (key) => {
      let rec = records.get(key)
      if (!rec) {
        rec = { connected: false, synced: false, pendingLocal: false, diskMatchesCrdt: true, diverged: false }
        records.set(key, rec)
      }
      return rec
    },
    makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
    events: {
      onError: (err) => errors.push(err),
      onDocChanged: (guid, path) => {
        changed.push(path)
        seen.push([guid, path])
      },
      ...(opts.onBreaker ? { onBreaker: opts.onBreaker } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    },
  })
  return { session, clock, errors, changed, seen }
}

/**
 * Let the watch chain (listing, enrolment) run to the end. With the clock,
 * time moves too: a new file is quiesced (read, wait, read again) before it
 * is enrolled, and the wait is on the injected clock.
 */
async function settle(clock?: SimClock): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await yieldMacro()
    clock?.advance(40)
  }
}

const textPaths = (s: MountSession) => s.files().filter((r) => r.kind === 'text').map((r) => r.path).sort()

/** The memfs adapter with its `list()` calls counted (each is a full recursive listing on disk). */
function countingLists(base: MemVaultAdapter): { adapter: VaultAdapter; lists: () => number } {
  let lists = 0
  const adapter = new Proxy(base, {
    get(target, key) {
      if (key === 'list') {
        return () => {
          lists++
          return target.list()
        }
      }
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
  return { adapter, lists: () => lists }
}

describe('live enrol-on-create', () => {
  it('a new note written from outside is enrolled, its doc holding the disk text', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('kept\n'))
    const { session, clock, errors, changed } = await boot(adapter)

    adapter.externalWrite('agent-note.md', enc.encode('# From an agent\n\nbody\n'))
    await settle(clock)

    expect(textPaths(session)).toEqual(['agent-note.md', 'keep.md'])
    expect(session.docForPath('agent-note.md')?.getText()).toBe('# From an agent\n\nbody\n')
    // The index hears about it like any other content change.
    expect(changed).toContain('agent-note.md')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('the enrolled note is tracked by the running session: a later outside edit is ingested', async () => {
    const adapter = new MemVaultAdapter()
    const { session, clock, errors } = await boot(adapter)
    adapter.externalWrite('n.md', enc.encode('one\n'))
    await settle(clock)
    adapter.externalWrite('n.md', enc.encode('one\ntwo\n'))
    await settle()
    // The quiesce double-read runs on the injected clock.
    clock.advance(100)
    await settle()
    expect(session.docForPath('n.md')?.getText()).toBe('one\ntwo\n')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('a populated folder moved in (one directory event) has every note enrolled', async () => {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('kept\n'))
    const { session, clock, errors } = await boot(adapter)

    // inotify reports a moved-in folder as ONE event, nothing for its files.
    adapter.autoEmit = false
    for (const n of ['a', 'b', 'c']) await adapter.writeAtomic(`moved/${n}.md`, enc.encode(`${n}\n`))
    adapter.autoEmit = true
    adapter.emitBatch(['moved'])
    await settle(clock)

    expect(textPaths(session)).toEqual(['keep.md', 'moved/a.md', 'moved/b.md', 'moved/c.md'])
    expect(session.files().find((r) => r.path === 'moved')?.kind).toBe('dir')
    expect(session.docForPath('moved/b.md')?.getText()).toBe('b\n')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('skips what the boot scan skips: ignored folders and temp names', async () => {
    const adapter = new MemVaultAdapter()
    const { session, clock } = await boot(adapter)
    adapter.autoEmit = false
    await adapter.writeAtomic('.ohhi/layouts/x.json', enc.encode('{}'))
    await adapter.writeAtomic('n.md.ohhi-tmp-123', enc.encode('partial'))
    adapter.autoEmit = true
    adapter.emitBatch(['.ohhi/layouts/x.json', 'n.md.ohhi-tmp-123'])
    await settle(clock)
    expect(session.files()).toEqual([])
    session.dispose()
  })

  it('a note the app creates itself is enrolled once, under its own guid', async () => {
    const adapter = new MemVaultAdapter()
    const { session, errors } = await boot(adapter)
    const path = await session.createFile('', 'made', 'hello\n')
    await settle()
    expect(path).toBe('made.md')
    expect(session.mapEntries().filter(([p]) => p === 'made.md')).toHaveLength(1)
    expect(session.docForPath('made.md')?.getText()).toBe('hello\n')
    expect(errors).toEqual([])
    session.dispose()
  })
})

describe('live enrol-on-create — a new file is quiesced, and scratch files are skipped', () => {
  it('a file still being written is enrolled once it holds still, with its final bytes', async () => {
    const adapter = new MemVaultAdapter()
    const { session, clock, errors } = await boot(adapter)
    // A writer that is not atomic: the first half lands, then the rest.
    adapter.externalWrite('slow.md', enc.encode('# Half'))
    await settle()
    expect(textPaths(session)).toEqual([]) // nothing enrolled on the first read
    adapter.autoEmit = false
    adapter.externalWrite('slow.md', enc.encode('# Half and the rest\n'))
    adapter.autoEmit = true
    await settle(clock)
    expect(textPaths(session)).toEqual(['slow.md'])
    expect(session.docForPath('slow.md')?.getText()).toBe('# Half and the rest\n')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('a file that vanishes before the second read is dropped, silently', async () => {
    const adapter = new MemVaultAdapter()
    const { session, clock, errors } = await boot(adapter)
    adapter.externalWrite('gone.md', enc.encode('brief\n'))
    await settle()
    adapter.autoEmit = false
    await adapter.remove('gone.md')
    adapter.autoEmit = true
    await settle(clock)
    expect(session.files()).toEqual([])
    expect(errors).toEqual([])
    session.dispose()
  })

  it('another tool’s swap, partial and backup files are never enrolled', async () => {
    const adapter = new MemVaultAdapter()
    const { session, clock, errors } = await boot(adapter)
    const scratch = ['.n.md.swp', 'n.md~', '.DS_Store', 'dl/n.md.part', '.syncthing.n.md.tmp', 'n.md.crdownload']
    adapter.autoEmit = false
    for (const p of [...scratch, 'dl/real.md']) await adapter.writeAtomic(p, enc.encode('x\n'))
    adapter.autoEmit = true
    adapter.emitBatch(scratch)
    adapter.emitBatch(['dl'])
    await settle(clock)
    expect(textPaths(session)).toEqual(['dl/real.md'])
    expect(errors).toEqual([])
    session.dispose()
  })
})

describe('live enrol-on-create — only a path the map does not know is listed for', () => {
  it('an attachment the app writes and a known folder’s mkdir cause no listing', async () => {
    const base = new MemVaultAdapter()
    await base.writeAtomic('docs/a.md', enc.encode('a\n'))
    const { adapter, lists } = countingLists(base)
    const { session, clock, errors } = await boot(adapter)
    expect(session.files().find((r) => r.path === 'docs')?.kind).toBe('dir')
    const before = lists()

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])
    expect(await session.writeAttachment('docs/pic.png', png)).toBe('docs/pic.png')
    await settle()
    // The attachment is in the map now; writing it again names a known path.
    base.externalWrite('docs/pic.png', png)
    await base.mkdir('docs')
    await settle(clock)

    expect(lists()).toBe(before)
    expect(errors).toEqual([])
    session.dispose()
  })
})

/**
 * The memfs adapter with `list()` held at a gate: `hold()` makes the next
 * listing wait until the returned release is called (a slow listing on disk).
 */
function slowLists(base: MemVaultAdapter): { adapter: VaultAdapter; hold: () => () => void } {
  let gate: Promise<void> | null = null
  const adapter = new Proxy(base, {
    get(target, key) {
      if (key === 'list') {
        return async () => {
          if (gate) await gate
          return target.list()
        }
      }
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
  const hold = (): (() => void) => {
    let release = (): void => {}
    gate = new Promise<void>((r) => (release = r))
    return () => {
      gate = null
      release()
    }
  }
  return { adapter, hold }
}

/**
 * Every `createFile` and `importFile` restarts the session. A restart that
 * lands while a live enrol is listing, or while its new file settles, must not
 * drop the file nor leave it in the map with no session tracking it.
 */
describe('live enrol-on-create — a session restart in the middle', () => {
  it('a restart during the listing waits for it: the new file is enrolled and tracked', async () => {
    const base = new MemVaultAdapter()
    const { adapter, hold } = slowLists(base)
    const { session, clock, errors } = await boot(adapter)

    const release = hold()
    base.externalWrite('agent.md', enc.encode('one\n'))
    await settle() // the batch is now waiting on the listing
    const made = session.createFile('', 'made', 'mine\n')
    await settle()
    release()
    expect(await made).toBe('made.md')
    await settle(clock)
    expect(session.docForPath('agent.md')?.getText()).toBe('one\n')

    // Tracked by the session running now: an outside edit is ingested.
    base.externalWrite('agent.md', enc.encode('one\ntwo\n'))
    await settle(clock)
    expect(session.docForPath('agent.md')?.getText()).toBe('one\ntwo\n')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('a restart while the new file settles: the current session tracks it', async () => {
    const adapter = new MemVaultAdapter()
    const { session, clock, errors } = await boot(adapter)

    adapter.externalWrite('agent.md', enc.encode('one\n'))
    await settle() // listed; the quiesce waits on the clock
    expect(await session.createFile('', 'made', 'mine\n')).toBe('made.md')
    await settle(clock)
    expect(session.docForPath('agent.md')?.getText()).toBe('one\n')

    adapter.externalWrite('agent.md', enc.encode('one\ntwo\n'))
    await settle(clock)
    expect(session.docForPath('agent.md')?.getText()).toBe('one\ntwo\n')
    expect(errors).toEqual([])
    session.dispose()
  })
})

/**
 * A boot batch held behind the breaker (or dismissed with "Not now") is the
 * dialog's to apply: its files, and the folders that hold them, are not
 * enrolled live behind it. And one dialog covers everything held.
 */
describe('live enrol-on-create — a held or dismissed boot batch', () => {
  const added = Array.from({ length: 21 }, (_, i) => `batch/n${i}.md`)
  const dirs = (s: MountSession) => s.files().filter((r) => r.kind === 'dir').map((r) => r.path).sort()

  async function heldBoot() {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('kept\n'))
    const storeDir = new MemStoreDir()
    const first = await boot(adapter, { storeDir })
    first.session.dispose()
    // While the app was closed: 21 new notes in a new folder.
    for (const p of added) await adapter.writeAtomic(p, enc.encode(`${p}\n`))
    const raised: string[][] = []
    const booted = await boot(adapter, { storeDir, onBreaker: (paths) => raised.push(paths) })
    expect(raised).toHaveLength(1)
    expect(textPaths(booted.session)).toEqual(['keep.md'])
    return { adapter, raised, ...booted }
  }

  /** An outside writer touches one of the batch's files, and the folder over them. */
  async function touchBatch(adapter: MemVaultAdapter, clock: SimClock): Promise<void> {
    adapter.externalWrite('batch/n3.md', enc.encode('batch/n3.md\nedited\n'))
    await settle(clock)
    adapter.emitBatch(['batch'])
    await settle(clock)
  }

  it('while held, a watch event naming its file or its folder enrols neither', async () => {
    const { adapter, session, clock, errors } = await heldBoot()
    await touchBatch(adapter, clock)
    expect(textPaths(session)).toEqual(['keep.md'])
    expect(dirs(session)).toEqual([])
    // Confirm still applies the whole batch, the edited file with its new bytes.
    await session.confirmBreaker()
    expect(textPaths(session)).toEqual(['keep.md', ...added].sort())
    expect(dirs(session)).toEqual(['batch'])
    expect(session.docForPath('batch/n3.md')?.getText()).toBe('batch/n3.md\nedited\n')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('after "Not now", they wait for the next launch: no live enrol either', async () => {
    const { adapter, session, clock, errors } = await heldBoot()
    session.dismissBreaker()
    await touchBatch(adapter, clock)
    expect(textPaths(session)).toEqual(['keep.md'])
    expect(dirs(session)).toEqual([])
    // A file that is not the batch's still enrols live.
    adapter.externalWrite('other.md', enc.encode('other\n'))
    await settle(clock)
    expect(textPaths(session)).toEqual(['keep.md', 'other.md'])
    expect(errors).toEqual([])
    session.dispose()
  })

  it('a 21-file watch batch while it is held joins it: one dialog, and confirm applies both', async () => {
    const { adapter, session, clock, raised, errors } = await heldBoot()
    const drop = Array.from({ length: 21 }, (_, i) => `drop/m${i}.md`)
    adapter.autoEmit = false
    for (const p of drop) await adapter.writeAtomic(p, enc.encode(`${p}\n`))
    adapter.autoEmit = true
    adapter.emitBatch(drop)
    await settle(clock)
    expect(raised).toHaveLength(1)
    expect(textPaths(session)).toEqual(['keep.md'])

    await session.confirmBreaker()
    await settle(clock)
    expect(textPaths(session)).toEqual(['keep.md', ...added, ...drop].sort())
    expect(errors).toEqual([])
    session.dispose()
  })

  it('a 21-file watch batch while it is held is dropped with it on "Not now"', async () => {
    const { adapter, session, clock, raised } = await heldBoot()
    const drop = Array.from({ length: 21 }, (_, i) => `drop/m${i}.md`)
    adapter.autoEmit = false
    for (const p of drop) await adapter.writeAtomic(p, enc.encode(`${p}\n`))
    adapter.autoEmit = true
    adapter.emitBatch(drop)
    await settle(clock)
    session.dismissBreaker()
    await settle(clock)
    expect(raised).toHaveLength(1)
    expect(textPaths(session)).toEqual(['keep.md'])
    session.dispose()
  })
})

/** The memfs adapter whose next read of one path waits for a release (a slow read on disk). */
function slowRead(base: MemVaultAdapter): { adapter: VaultAdapter; hold: (path: string) => () => void } {
  let held: { path: string; gate: Promise<void> } | null = null
  const adapter = new Proxy(base, {
    get(target, key) {
      if (key === 'read') {
        return async (p: string) => {
          if (held && held.path === p) {
            const { gate } = held
            held = null
            await gate
          }
          return target.read(p)
        }
      }
      const value = Reflect.get(target, key, target) as unknown
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value
    },
  })
  const hold = (path: string): (() => void) => {
    let release = (): void => {}
    held = { path, gate: new Promise<void>((r) => (release = r)) }
    return release
  }
  return { adapter, hold }
}

/**
 * The app's create and import race a live enrol of the same path: whichever
 * commits, the map ends with ONE entry whose guid is the doc everyone holds —
 * never a second guid written over the first, which would leave the first
 * tracked with a doc and an index entry but no map key.
 */
describe('live enrol-on-create — the app’s own create or import of the same path', () => {
  async function race(act: (s: MountSession) => Promise<unknown>) {
    const base = new MemVaultAdapter()
    const { adapter, hold } = slowRead(base)
    const booted = await boot(adapter)
    base.externalWrite('n.md', enc.encode('outside\n'))
    await settle() // listed; the quiesce has read once and waits on the clock
    const release = hold('n.md') // the app's own read of the path is slow
    const acting = act(booted.session)
    await settle(booted.clock) // the live enrol's quiesce completes meanwhile
    release()
    await acting
    await settle(booted.clock)
    return booted
  }
  const guidsFor = (s: MountSession, path: string) => s.mapEntries().filter(([p]) => p === path).map(([, e]) => e.guid)

  it('createFile: one entry, and no doc minted for the path is left without it', async () => {
    const { session, seen, errors } = await race((s) => s.createFile('', 'n'))
    const [guid] = guidsFor(session, 'n.md')
    expect(guidsFor(session, 'n.md')).toHaveLength(1)
    expect(session.docForPath('n.md')?.getText()).toBe('outside\n')
    for (const [g, p] of seen) if (p === 'n.md') expect(g).toBe(guid)
    expect(errors).toEqual([])
    session.dispose()
  })

  it('importFile: one entry, and no doc minted for the path is left without it', async () => {
    const { session, seen, errors } = await race((s) => s.importFile('n.md', enc.encode('imported\n')))
    const [guid] = guidsFor(session, 'n.md')
    expect(guidsFor(session, 'n.md')).toHaveLength(1)
    expect(session.docForPath('n.md')?.getText()).toBe('imported\n')
    for (const [g, p] of seen) if (p === 'n.md') expect(g).toBe(guid)
    expect(errors).toEqual([])
    session.dispose()
  })
})

/**
 * A carve in a PRIVATE vault writes no mount entry: the root's only guard is
 * the live ignore set the carve extends just before it detaches the subtree.
 * A live enrol that listed the path before that must re-check at commit time.
 */
describe('live enrol-on-create — a carve that starts while a new file settles', () => {
  it('the root does not enrol a file under the folder being carved', async () => {
    const base = new MemVaultAdapter()
    await base.writeAtomic('keep.md', enc.encode('kept\n'))
    const ignore = new Set<string>()
    const adapter = ignoringAdapter(base, ignore)
    const { session, clock, errors } = await boot(adapter)

    base.externalWrite('team/new.md', enc.encode('new\n'))
    await settle() // listed while 'team' was still the root's; the quiesce waits
    ignore.add('team') // the carve's addIgnore, just before its detach
    expect(adapter.hides?.('team/new.md')).toBe(true)
    await settle(clock)

    expect(session.mapEntries().map(([p]) => p).filter((p) => p.startsWith('team'))).toEqual([])
    expect(textPaths(session)).toEqual(['keep.md'])
    expect(errors).toEqual([])
    session.dispose()
  })
})

describe('live enrol-on-create — the watch breaker counts new files', () => {
  const batch = Array.from({ length: 21 }, (_, i) => `drop/n${i}.md`)
  async function held() {
    const adapter = new MemVaultAdapter()
    await adapter.writeAtomic('keep.md', enc.encode('kept\n'))
    let breaker: string[] | null = null
    const events: AppEvent[] = []
    const booted = await boot(adapter, { onBreaker: (paths) => (breaker = paths), onEvent: (e) => events.push(e) })
    adapter.autoEmit = false
    for (const p of batch) await adapter.writeAtomic(p, enc.encode(`${p}\n`))
    adapter.autoEmit = true
    adapter.emitBatch(batch)
    await settle()
    return { ...booted, breaker: () => breaker, events }
  }

  it('21 new files in one event trip the breaker, and nothing enrols while held', async () => {
    const { session, breaker } = await held()
    expect(breaker()?.sort()).toEqual([...batch].sort())
    expect(textPaths(session)).toEqual(['keep.md'])
    session.dispose()
  })

  it('confirm enrols them', async () => {
    const { session, clock, errors } = await held()
    await session.confirmBreaker()
    await settle(clock)
    expect(textPaths(session)).toEqual(['keep.md', ...batch].sort())
    expect(session.docForPath('drop/n7.md')?.getText()).toBe('drop/n7.md\n')
    expect(errors).toEqual([])
    session.dispose()
  })

  it('a session restart while held (the app makes a note) keeps the batch for the confirm', async () => {
    const { session, clock, errors } = await held()
    expect(await session.createFile('', 'made', 'mine\n')).toBe('made.md')
    await session.confirmBreaker()
    await settle(clock)
    expect(textPaths(session)).toEqual(['keep.md', 'made.md', ...batch].sort())
    expect(errors).toEqual([])
    session.dispose()
  })

  it('dismiss enrols none, and the log records what was let go', async () => {
    const { session, events } = await held()
    expect(events.filter((e) => e.kind === 'breaker.dismissed')).toEqual([])
    session.dismissBreaker()
    await settle()
    expect(textPaths(session)).toEqual(['keep.md'])
    const dismissed = events.filter((e) => e.kind === 'breaker.dismissed')
    expect(dismissed.map((e) => e.payload)).toEqual([{ count: 21 }])
    // A second dismiss with nothing held logs nothing.
    session.dismissBreaker()
    expect(events.filter((e) => e.kind === 'breaker.dismissed')).toHaveLength(1)
    session.dispose()
  })
})
