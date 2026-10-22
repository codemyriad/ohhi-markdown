/**
 * The headless custodian over a MemVaultAdapter and the real in-process relay
 * (decisions 6, 7, 8, 13): enrolment, reopen, first join, epoch mismatch,
 * held breakers, blocked writes and a lost lease.
 */
import { join } from 'node:path'
import type { Relay } from '@ohhi/relay'
import { RealClock } from '@ohhi/testkit'
import {
  formatHostMarker,
  MemStoreDir,
  MemVaultAdapter,
  OHHI_HOST_MARKER,
  parseHostMarker,
  WriteRefusedError,
  type StoreDir,
  type VaultAdapter,
} from '@ohhi/vault'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Custodian, EPOCH_FILE, type CustodianDeps, type CustodianMode } from '../src/custodian.js'
import type { VaultRow } from '../src/types.js'
import { connectPeer, relayWithDeviceToken, tempDir, until, vaultRow } from './fixtures.js'

const enc = new TextEncoder()
const dec = new TextDecoder()
const DEVICE = 'device-token-for-tests'

const row = vaultRow

describe('custodian', () => {
  let dir: ReturnType<typeof tempDir>
  let relay: Relay
  const rooms = new Map<string, string>()
  const running: Custodian[] = []
  const clock = new RealClock()

  beforeEach(async () => {
    dir = tempDir('custodian')
    relay = await relayWithDeviceToken({
      dbPath: join(dir.path, 'relay.db'),
      clock,
      token: DEVICE,
      vaultIdForRoom: (room) => rooms.get(room) ?? null,
    })
  })
  afterEach(async () => {
    for (const c of running.splice(0)) await c.stop()
    await relay.destroy()
    dir.remove()
  })

  function custodian(
    r: VaultRow,
    mode: CustodianMode,
    adapter: VaultAdapter,
    storeDir: StoreDir,
    over: Partial<CustodianDeps> = {}
  ): Custodian & { statuses: string[] } {
    rooms.set(r.room, r.id)
    const statuses: string[] = []
    const c = new Custodian({
      row: r,
      mode,
      clock,
      instance: 'inst-A',
      storeDir,
      adapter,
      relay: { url: `ws://127.0.0.1:${relay.port}`, token: DEVICE },
      webSocketPolyfill: globalThis.WebSocket,
      setStatus: (s) => statuses.push(s),
      log: () => {},
      ...over,
    })
    running.push(c)
    return Object.assign(c, { statuses })
  }

  async function seeded(): Promise<MemVaultAdapter> {
    const a = new MemVaultAdapter()
    await a.writeAtomic('a.md', enc.encode('alpha\n'))
    await a.writeAtomic('notes/b.md', enc.encode('beta\n'))
    return a
  }

  it('enrols disk once, writes the marker and the store epoch, and publishes Files status', async () => {
    const r = row()
    const adapter = await seeded()
    const store = new MemStoreDir()
    const c = custodian(r, 'enrol', adapter, store)
    expect(c.status(0).custodian).toBe('enrolling') // not `idle`: the shell counts its files
    expect(await c.start()).toBe(true)
    expect(c.status(0).custodian).toBe('enrolling')
    await c.ready
    expect(c.state).toBe('running')
    expect(c.status(0)).toMatchObject({ custodian: 'running', holds: [] })
    expect(c.status(0)).not.toHaveProperty('reason')
    expect(c.statuses).toEqual(['active'])
    expect(c.session!.files().map((f) => f.path).sort()).toEqual(['a.md', 'notes', 'notes/b.md'])
    const marker = parseHostMarker((await adapter.read(OHHI_HOST_MARKER))!)
    expect(marker).toMatchObject({ room: r.room, vault: r.id, epoch: 1, instance: 'inst-A' })
    expect(JSON.parse(dec.decode((await store.io(EPOCH_FILE).read())!))).toEqual({ epoch: 1, room: r.room })
    const disk = c.status(0).files
    expect(Object.values(disk).sort()).toEqual(['match', 'match'])
  })

  it('restart with stores present reopens (same guids); stores absent first-joins from the room', async () => {
    const r = row()
    const adapter = await seeded()
    const store = new MemStoreDir()
    const first = custodian(r, 'enrol', adapter, store)
    await first.start()
    await first.ready
    const guids = first.session!.files().map((f) => `${f.path}=${f.guid}`).sort()
    await first.stop()

    const again = custodian(r, 'boot', adapter, store)
    expect(await again.start()).toBe(true)
    await again.ready
    expect(again.state).toBe('running')
    expect(again.session!.files().map((f) => `${f.path}=${f.guid}`).sort()).toEqual(guids)

    // A fresh volume for the same row: pull the room, never enrol.
    const empty = new MemVaultAdapter()
    const freshStore = new MemStoreDir()
    const joiner = custodian(r, 'boot', empty, freshStore)
    expect(await joiner.start()).toBe(true)
    await joiner.ready
    expect(joiner.state).toBe('running')
    expect(joiner.session!.files().map((f) => `${f.path}=${f.guid}`).sort()).toEqual(guids)
    expect(dec.decode((await empty.read('a.md'))!)).toBe('alpha\n')
    expect(JSON.parse(dec.decode((await freshStore.io(EPOCH_FILE).read())!))).toEqual({ epoch: 1, room: r.room })
  })

  it('a reopen whose room does not answer before the boot scan is needs-operator, and stops (nextcloud-build R1 notes)', async () => {
    const r = row()
    const adapter = await seeded()
    const store = new MemStoreDir()
    const first = custodian(r, 'enrol', adapter, store)
    await first.start()
    await first.ready
    await first.stop()
    // The relay is not there: nothing answers the reopen's wait.
    const again = custodian(r, 'boot', adapter, store, {
      relay: { url: 'ws://127.0.0.1:9', token: DEVICE },
      awaitRoomMs: 200,
    })
    expect(await again.start()).toBe(true)
    await again.ready
    expect(again.state).toBe('needs-operator')
    expect(again.statuses).toContain('needs-operator')
    expect(again.session).toBeNull()
  })

  it('an epoch mismatch between row, store and marker is needs-operator, and nothing runs', async () => {
    const r = row()
    const adapter = await seeded()
    await adapter.writeAtomic(
      OHHI_HOST_MARKER,
      formatHostMarker({ room: r.room, vault: r.id, epoch: 2, instance: 'inst-A', heartbeat: new Date(0).toISOString() })
    )
    const c = custodian(r, 'boot', adapter, new MemStoreDir())
    expect(await c.start()).toBe(false)
    expect(c.state).toBe('needs-operator')
    expect(c.statuses).toEqual(['needs-operator'])
    expect(c.session).toBeNull()
    expect(c.status(0).custodian).toBe('needs-operator')

    // The store's own epoch disagreeing is the same refusal.
    const store = new MemStoreDir()
    const first = custodian(r, 'enrol', await seeded(), store)
    await first.start()
    await first.ready
    await first.stop()
    const bumped = custodian({ ...r, epoch: 2 }, 'boot', await seeded(), store)
    expect(await bumped.start()).toBe(false)
    expect(bumped.state).toBe('needs-operator')
  })

  it('enrolment writes the epoch before any store: a crash in between leaves a boot that first-joins (nextcloud-build R1 #10)', async () => {
    const r = row()
    // An empty folder: the crashed enrolment put nothing of its own in the room.
    const adapter = new MemVaultAdapter()
    const store = new MemStoreDir()
    // Every store write but the epoch file fails: the process "dies" right after it.
    const crashing: StoreDir = {
      io: (name) => {
        const io = store.io(name)
        if (name === EPOCH_FILE) return io
        return Object.assign(Object.create(io) as typeof io, {
          writeAtomic: async () => {
            throw new Error('crash')
          },
        })
      },
      remove: (name) => store.remove(name),
      list: (prefix) => store.list(prefix),
    }
    const crashed = custodian(r, 'enrol', adapter, crashing)
    expect(await crashed.start()).toBe(true)
    await crashed.ready
    expect(crashed.state).not.toBe('running')
    expect(JSON.parse(dec.decode((await store.io(EPOCH_FILE).read())!))).toEqual({ epoch: 1, room: r.room })
    expect(await store.list(`${r.room}/`)).toEqual([]) // no store survived
    await crashed.stop()

    // The room has what another peer put there; the restart pulls it — a
    // first join, not needs-operator.
    const peer = connectPeer(relay.port, `${r.room}/folder`, DEVICE)
    await until(() => peer.provider.synced, 'peer synced')
    peer.doc.getMap('files').set('from-room.md', { guid: 'g-room', kind: 'text' })
    const note = connectPeer(relay.port, `${r.room}/g-room`, DEVICE)
    await until(() => note.provider.synced, 'note synced')
    const booted = custodian(r, 'boot', adapter, store)
    expect(await booted.start()).toBe(true)
    await booted.ready
    expect(booted.state).toBe('running')
    expect(booted.session!.files().map((f) => f.path)).toContain('from-room.md')
    peer.destroy()
    note.destroy()
  })

  it('a stop during start leaves no heartbeat, wherever start was waiting (nextcloud-build R1 #15)', async () => {
    for (const gateOn of ['read', 'write'] as const) {
      const r = row()
      const inner = new MemVaultAdapter()
      let open: () => void = () => {}
      const gate = new Promise<void>((resolve) => (open = resolve))
      const markerWrites: string[] = []
      const adapter: VaultAdapter = Object.assign(Object.create(inner) as VaultAdapter, {
        read: async (p: string) => {
          if (p === OHHI_HOST_MARKER && gateOn === 'read') await gate
          return inner.read(p)
        },
        writeAtomic: async (p: string, b: Uint8Array, o?: { expectHash?: string }) => {
          if (p === OHHI_HOST_MARKER) {
            if (gateOn === 'write' && markerWrites.length === 0) await gate
            markerWrites.push(parseHostMarker(b)!.heartbeat)
          }
          return inner.writeAtomic(p, b, o)
        },
      })
      const c = custodian(r, 'boot', adapter, new MemStoreDir(), { heartbeatMs: 20 })
      const starting = c.start()
      await new Promise((resolve) => setTimeout(resolve, 20))
      const stopping = c.stop()
      open()
      expect(await starting).toBe(false)
      await stopping
      expect(c.state).toBe('stopped')
      expect(c.session).toBeNull()
      const after = markerWrites.length
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(markerWrites.length, gateOn).toBe(after) // no heartbeat is running
      if (gateOn === 'write') {
        // Taken as the stop landed: handed straight back, its heartbeat stale.
        expect(markerWrites.at(-1)).toBe(new Date(0).toISOString())
      } else {
        expect(markerWrites).toEqual([])
      }
    }
  })

  it('holds a mass-change batch until a user confirms it — never by itself', async () => {
    const r = row()
    const adapter = await seeded()
    const c = custodian(r, 'enrol', adapter, new MemStoreDir(), { thresholds: { massChangePaths: 1 } })
    await c.start()
    await c.ready
    adapter.autoEmit = false
    await adapter.writeAtomic('a.md', enc.encode('alpha changed\n'))
    await adapter.writeAtomic('notes/b.md', enc.encode('beta changed\n'))
    adapter.emitBatch(['a.md', 'notes/b.md'])
    await until(() => c.holds.list().length === 1, 'breaker held')
    const [hold] = c.status(0).holds
    expect(hold).toMatchObject({ kind: 'breaker', paths: ['a.md', 'notes/b.md'] })
    await new Promise((r) => setTimeout(r, 300))
    expect(c.session!.docForPath('a.md')!.getText()).toBe('alpha\n') // still held
    await c.applyHold(hold!.id, 'confirm')
    await until(() => c.session!.docForPath('a.md')!.getText() === 'alpha changed\n', 'batch applied')
    expect(c.holds.list()).toEqual([])
  })

  it('a second trip while a batch is held joins it; one confirm applies both (nextcloud-build R1 #9)', async () => {
    const r = row()
    const adapter = await seeded()
    const c = custodian(r, 'enrol', adapter, new MemStoreDir(), { thresholds: { massChangePaths: 1 } })
    await c.start()
    await c.ready
    adapter.autoEmit = false
    await adapter.writeAtomic('a.md', enc.encode('alpha changed\n'))
    await adapter.writeAtomic('notes/b.md', enc.encode('beta changed\n'))
    adapter.emitBatch(['a.md', 'notes/b.md'])
    await until(() => c.holds.list().length === 1, 'first trip held')
    await adapter.writeAtomic('c.md', enc.encode('gamma\n'))
    await adapter.writeAtomic('d.md', enc.encode('delta\n'))
    adapter.emitBatch(['c.md', 'd.md'])
    await until(() => c.holds.list()[0]!.paths.length === 4, 'second trip joined')
    const holds = c.status(0).holds
    expect(holds).toHaveLength(1)
    expect([...holds[0]!.paths].sort()).toEqual(['a.md', 'c.md', 'd.md', 'notes/b.md'])
    await new Promise((r) => setTimeout(r, 300))
    expect(c.session!.docForPath('c.md')).toBeFalsy() // still held
    await c.applyHold(holds[0]!.id, 'confirm')
    await until(
      () => c.session!.docForPath('a.md')!.getText() === 'alpha changed\n' && c.session!.docForPath('d.md')?.getText() === 'delta\n',
      'both batches applied'
    )
    expect(c.holds.list()).toEqual([])
  })

  it('a refused write shows as blocked with its status, and match once the retry lands', async () => {
    const r = row()
    const inner = await seeded()
    let refuse = false
    const adapter: VaultAdapter = Object.assign(Object.create(inner) as VaultAdapter, {
      writeAtomic: async (p: string, b: Uint8Array, o?: { expectHash?: string }) => {
        if (refuse && p === 'a.md') throw new WriteRefusedError(423, 'PUT', p)
        return inner.writeAtomic(p, b, o)
      },
    })
    const published: unknown[] = []
    const c = custodian(r, 'enrol', adapter, new MemStoreDir(), { retryBackoffMs: [200] })
    await c.start()
    await c.ready
    const publish = c.session!.publishCustodianState.bind(c.session!)
    c.session!.publishCustodianState = (s) => {
      published.push(s)
      publish(s)
    }
    const guid = c.session!.files().find((f) => f.path === 'a.md')!.guid
    refuse = true
    c.session!.docForPath('a.md')!.transact((t) => t.insert(0, 'edited '), 'local')
    await until(() => c.status(0).files[guid] === 'blocked', 'blocked', 10_000)
    await until(() => published.length > 0 && JSON.stringify(published.at(-1)).includes('423'), 'blocked published')
    expect(published.at(-1)).toMatchObject({ type: 'custodian', instance: 'inst-A', blocked: { [guid]: 423 }, disk: { [guid]: 'blocked' } })
    refuse = false
    await until(() => c.status(0).files[guid] === 'match', 'cleared', 10_000)
    expect(dec.decode((await inner.read('a.md'))!)).toBe('edited alpha\n')
    await until(() => JSON.stringify(published.at(-1)).includes('"blocked":{}'), 'cleared published')
  })

  it('a lost lease stops the custodian and marks the vault lease-lost', async () => {
    const r = row()
    const adapter = await seeded()
    const c = custodian(r, 'enrol', adapter, new MemStoreDir(), { heartbeatMs: 100 })
    await c.start()
    await c.ready
    await adapter.writeAtomic(
      OHHI_HOST_MARKER,
      formatHostMarker({ room: r.room, vault: r.id, epoch: 1, instance: 'inst-B', heartbeat: new Date().toISOString() })
    )
    await until(() => c.state === 'lease-lost' && c.session === null, 'lease lost')
    expect(c.statuses).toEqual(['active', 'lease-lost'])
    expect(c.status(0).custodian).toBe('lease-lost')
    expect(parseHostMarker((await adapter.read(OHHI_HOST_MARKER))!)!.instance).toBe('inst-B')
    await expect(c.applyHold('breaker-1', 'confirm')).rejects.toMatchObject({ status: 409 })
  })
})
