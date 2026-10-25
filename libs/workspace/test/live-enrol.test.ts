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
  opts: { onBreaker?: (paths: string[]) => void; onEvent?: (e: AppEvent) => void } = {}
) {
  const engine = createYjsEngine()
  const clock = new SimClock()
  const storeDir = new MemStoreDir()
  const mountDir = scopedStoreDir(storeDir, `${ROOM}/`)
  const docStore = new BlobDocStore(engine, mountDir, clock)
  const errors: unknown[] = []
  const records = new Map<string, SyncRecordFields>()
  const changed: string[] = []
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
      onDocChanged: (_guid, path) => changed.push(path),
      ...(opts.onBreaker ? { onBreaker: opts.onBreaker } : {}),
      ...(opts.onEvent ? { onEvent: opts.onEvent } : {}),
    },
  })
  return { session, clock, errors, changed }
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
