/**
 * The per-room persisted event log (sharing E3, spike S22 Q4): caps (count,
 * bytes, age), the doc.changed window fold, the debounced write on the
 * injected scheduler, flush on shutdown, and droppability — a missing,
 * corrupt or other-version file reads as empty (golden rule 8).
 */
import { MemStoreDir } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { describe, expect, it } from 'vitest'
import { bootVault, seedAdapter, yieldMacro } from './fixture.js'
import {
  DOC_CHANGE_WINDOW_MS,
  EVENT_LOG_MAX_AGE_MS,
  EVENT_WRITE_DEBOUNCE_MS,
  EVENTS_SCHEMA_VERSION,
  RoomEventLog,
  parseEventsFile,
  type EventInput,
} from '../src/index.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const DAY = 24 * 60 * 60_000

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

const change = (guid: string, by: string, added = 1, removed = 0): EventInput<'doc.changed'> => ({
  kind: 'doc.changed',
  level: 'info',
  scope: { room: 'r', mount: '', path: `${guid}.md` },
  actor: { kind: 'peer', name: by },
  payload: { guid, added, removed },
})

function setup(extra: Partial<ConstructorParameters<typeof RoomEventLog>[0]> = {}) {
  const clock = new SimClock()
  const dir = new MemStoreDir()
  const io = dir.io('r/events.json')
  const log = new RoomEventLog({ clock, room: 'r', io, ...extra })
  const stored = async () => parseEventsFile(await io.read())
  return { clock, dir, io, log, stored }
}

describe('RoomEventLog (sharing E3)', () => {
  it('folds one note by one actor within the window into one line, summing the deltas', () => {
    const { clock, log } = setup()
    clock.advance(1000)
    const first = log.append(change('a', 'Cynthia', 3, 1))
    clock.advance(1000)
    log.append(change('b', 'Cynthia'))
    clock.advance(1000)
    const again = log.append(change('a', 'Cynthia', 2, 4))
    // Same id, count 2, deltas summed, moved to the head (newest first).
    expect(again.id).toBe(first.id)
    expect(log.events().map((e) => [e.id, e.count, e.payload])).toEqual([
      [first.id, 2, { guid: 'a', added: 5, removed: 5 }],
      ['r:2', 1, { guid: 'b', added: 1, removed: 0 }],
    ])
    // Another actor on the same note is another line.
    log.append(change('a', 'Dmitri'))
    expect(log.size).toBe(3)
    // Past the window the note gets a fresh line.
    clock.advance(DOC_CHANGE_WINDOW_MS + 1)
    expect(log.append(change('a', 'Cynthia')).id).not.toBe(first.id)
  })

  it('caps at the count limit, oldest dropped first', () => {
    const { log } = setup({ cap: 3 })
    for (let i = 0; i < 5; i++) log.append({ kind: 'file.created', level: 'info', scope: { path: `n${i}.md` }, payload: {} })
    expect(log.events().map((e) => e.scope.path)).toEqual(['n4.md', 'n3.md', 'n2.md'])
  })

  it('caps the serialized size at write time, oldest dropped first', async () => {
    const { clock, log, io } = setup({ maxBytes: 2_000 })
    for (let i = 0; i < 60; i++) log.append({ kind: 'file.created', level: 'info', scope: { path: `note-${i}.md` }, payload: {} })
    await log.flush()
    const bytes = (await io.read())!
    expect(bytes.length).toBeLessThanOrEqual(2_000)
    const kept = parseEventsFile(bytes)
    expect(kept.length).toBeGreaterThan(5)
    expect(kept.length).toBeLessThan(60)
    expect(kept[kept.length - 1]!.scope.path).toBe('note-59.md')
    expect(log.size).toBe(kept.length)
    clock.advance(0)
  })

  it('prunes by age on append and on load', async () => {
    const { clock, log, io, stored } = setup()
    log.append({ kind: 'peer.joined', level: 'info', actor: { kind: 'peer', name: 'old' }, payload: {} })
    clock.advance(EVENT_LOG_MAX_AGE_MS - DAY)
    log.append({ kind: 'peer.joined', level: 'info', actor: { kind: 'peer', name: 'young' }, payload: {} })
    clock.advance(2 * DAY)
    // On append: `old` is now 31 days old.
    log.append({ kind: 'peer.left', level: 'info', actor: { kind: 'peer', name: 'young' }, payload: {} })
    expect(log.events().map((e) => e.actor.name)).toEqual(['young', 'young'])
    await log.flush()
    expect((await stored()).length).toBe(2)

    // On load: a reopen 40 days later sees nothing.
    clock.advance(40 * DAY)
    const reopened = new RoomEventLog({ clock, room: 'r', io })
    await reopened.load()
    expect(reopened.events()).toEqual([])
  })

  it('debounces writes on the injected scheduler and never writes on its own before then', async () => {
    let writes = 0
    const { clock, io, stored } = setup()
    const counting = { ...io, writeAtomic: async (b: Uint8Array) => { writes++; await io.writeAtomic(b) } }
    const log = new RoomEventLog({ clock, room: 'r', io: counting })
    for (let i = 0; i < 20; i++) {
      log.append(change(`g${i}`, 'B'))
      clock.advance(100)
    }
    await settle()
    expect(writes).toBe(0)
    clock.advance(EVENT_WRITE_DEBOUNCE_MS)
    await settle()
    expect(writes).toBe(1)
    expect((await stored()).length).toBe(20)
    // Quiet → no further writes.
    clock.advance(EVENT_WRITE_DEBOUNCE_MS * 3)
    await settle()
    expect(writes).toBe(1)
  })

  it('flush writes the tail at once (shutdown) and the reopen continues the ids', async () => {
    const { clock, io, log, stored } = setup()
    log.append(change('a', 'B'))
    log.append({ kind: 'relay.state', level: 'error', actor: { kind: 'relay', name: 'relay.test' }, payload: { to: 'refused', reason: 'nope' } })
    await log.flush()
    log.dispose()
    expect((await stored()).map((e) => e.kind)).toEqual(['doc.changed', 'relay.state'])
    const raw = JSON.parse(dec.decode((await io.read())!)) as { schemaVersion: number; events: unknown[] }
    expect(raw.schemaVersion).toBe(EVENTS_SCHEMA_VERSION)

    const reopened = new RoomEventLog({ clock, room: 'r', io })
    await reopened.load()
    expect(reopened.events().map((e) => e.id)).toEqual(['r:2', 'r:1'])
    expect(reopened.append(change('c', 'B')).id).toBe('r:3')
  })

  it('reads a missing, corrupt or other-version file as empty', async () => {
    const clock = new SimClock()
    const dir = new MemStoreDir()
    const cases: (Uint8Array | null)[] = [
      null,
      enc.encode('{not json'),
      enc.encode(JSON.stringify({ schemaVersion: 2, events: [{ id: 'r:1' }] })),
      enc.encode(JSON.stringify({ schemaVersion: EVENTS_SCHEMA_VERSION, events: 'nope' })),
      enc.encode('null'),
    ]
    for (const [i, bytes] of cases.entries()) {
      const io = dir.io(`r${i}/events.json`)
      if (bytes) await io.writeAtomic(bytes)
      const log = new RoomEventLog({ clock, room: `r${i}`, io })
      await log.load()
      expect(log.events()).toEqual([])
      // …and it still works: the next write replaces the bad file.
      log.append(change('a', 'B'))
      await log.flush()
      expect(parseEventsFile(await io.read()).length).toBe(1)
    }
    // A malformed ROW is skipped, the rest survive.
    const io = dir.io('mixed/events.json')
    await io.writeAtomic(
      enc.encode(
        JSON.stringify({
          schemaVersion: EVENTS_SCHEMA_VERSION,
          events: [
            { id: 'mixed:1', at: 0, kind: 'nonsense', level: 'info', scope: {}, actor: { kind: 'app' }, count: 1, payload: {} },
            { id: 'mixed:2', at: 0, kind: 'peer.left', level: 'info', scope: {}, actor: { kind: 'peer', name: 'B' }, count: 1, payload: {} },
          ],
        })
      )
    )
    const mixed = new RoomEventLog({ clock, room: 'mixed', io })
    await mixed.load()
    expect(mixed.events().map((e) => e.id)).toEqual(['mixed:2'])
  })

  it('a read failure is a lost feed, never a thrown load; a write failure retries later', async () => {
    const clock = new SimClock()
    let fail = true
    const io = {
      read: async (): Promise<Uint8Array | null> => {
        throw new Error('disk gone')
      },
      writeAtomic: async (): Promise<void> => {
        if (fail) throw new Error('disk full')
      },
    }
    const log = new RoomEventLog({ clock, room: 'r', io })
    await expect(log.load()).resolves.toBeUndefined()
    log.append(change('a', 'B'))
    await expect(log.flush()).resolves.toBeUndefined()
    fail = false
    await expect(log.flush()).resolves.toBeUndefined()
  })

  it('rebuild() clears and writes the empty log at once', async () => {
    const { log, stored, io } = setup()
    log.append(change('a', 'B'))
    await log.flush()
    await log.rebuild()
    expect(log.events()).toEqual([])
    expect(await stored()).toEqual([])
    expect(JSON.parse(dec.decode((await io.read())!))).toEqual({ schemaVersion: EVENTS_SCHEMA_VERSION, events: [] })
  })
})

describe('MountSession × events.json', () => {
  it('a session loads its room log on open and flushes the tail on shutdown', async () => {
    const dir = new MemStoreDir()
    const io = dir.io('root-room/events.json')
    // History from an earlier session, in the store before the mount opens.
    await io.writeAtomic(
      enc.encode(
        JSON.stringify({
          schemaVersion: EVENTS_SCHEMA_VERSION,
          events: [
            { id: 'root-room:7', at: 0, kind: 'peer.left', level: 'info', scope: { room: 'root-room' }, actor: { kind: 'peer', name: 'B' }, count: 1, payload: {} },
          ],
        })
      )
    )
    const base = await seedAdapter({ 'note.md': 'hello\n' })
    const vault = await bootVault(base, dir, 'root-room', { sessionDefaults: () => ({ eventsIo: io }) })
    expect(vault.root.roomEvents().map((e) => e.id)).toEqual(['root-room:7'])
    base.externalWrite('note.md', enc.encode('hello\nagain\n'))
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 4; j++) await yieldMacro()
      vault.clock.advance(30)
    }
    for (let j = 0; j < 12; j++) await yieldMacro()
    // Not yet written: the debounce has not elapsed…
    expect((await parseEventsFile(await io.read())).length).toBe(1)
    // …but shutdown flushes it.
    await vault.root.shutdown()
    const stored = parseEventsFile(await io.read())
    expect(stored.map((e) => [e.id, e.kind, e.actor.kind])).toEqual([
      ['root-room:7', 'peer.left', 'peer'],
      ['root-room:8', 'doc.changed', 'disk'],
    ])
    vault.dispose()
  })
})
