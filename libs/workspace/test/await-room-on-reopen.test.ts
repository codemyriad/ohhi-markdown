/**
 * `MountSessionConfig.awaitRoomOnReopen` (nextcloud-build decision 6): a
 * headless custodian's durable reopen waits for the room before the boot
 * scan; a timeout falls through to the ordinary reopen and is reported on
 * `onError`. Without the option (the desktop) the relay is never awaited.
 * Shape: boot-machine.test.ts's direct `MountSession.create`, with a
 * `DeadSocket` so the provider never syncs and a SimClock the test drives.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { MemStoreDir, MemVaultAdapter, MountsFile, type StoreDir, type VaultAdapter } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import { createMountStores } from '../src/mount-stores.js'
import { recoverMounts } from '../src/vault-boot.js'
import { DeadSocket, freshRecord } from './fixture.js'
import type { SyncRecordFields } from '../src/types.js'

const ROOM = 'room-reopen'
const enc = (s: string) => new TextEncoder().encode(s)
const settle = () => new Promise<void>((r) => setTimeout(r, 0))

async function seeded(): Promise<MemVaultAdapter> {
  const adapter = new MemVaultAdapter()
  await adapter.writeAtomic('a.md', enc('works offline\n'))
  return adapter
}

function bootStart(adapter: VaultAdapter, storeDir: StoreDir, clock: SimClock, extra: Partial<MountSessionConfig> = {}) {
  const engine = createYjsEngine()
  const errors: unknown[] = []
  const records = new Map<string, SyncRecordFields>()
  const start = async (): Promise<MountSession> => {
    const mountsFile = new MountsFile(storeDir.io('mounts.json'))
    await recoverMounts(storeDir, mountsFile, engine)
    const { docStore, lcaStore, journal } = createMountStores(engine, storeDir, ROOM, clock)
    return MountSession.create({
      engine,
      adapter,
      user: { name: 'Custodian', color: '#000' },
      room: ROOM,
      clock,
      lcaStore,
      journal,
      docStore,
      mountsFile,
      recordFor: (key) => {
        let rec = records.get(key)
        if (!rec) {
          rec = freshRecord()
          records.set(key, rec)
        }
        return rec
      },
      makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
      events: { onError: (err) => errors.push(err) },
      ...extra,
    })
  }
  return { start, errors }
}

describe('awaitRoomOnReopen', () => {
  it('without the option a relay-down reopen never waits on the clock', async () => {
    const adapter = await seeded()
    const store = new MemStoreDir()
    const clock = new SimClock()
    const first = await bootStart(adapter, store, clock).start()
    first.dispose()
    const b = bootStart(adapter, store, clock, {
      relay: { url: 'ws://127.0.0.1:9', token: 'irrelevant' },
      webSocketPolyfill: DeadSocket,
    })
    // The clock is never advanced: a reopen that awaited the room would hang here.
    const session = await b.start()
    expect(session.docForPath('a.md')?.getText()).toBe('works offline\n')
    expect(b.errors).toEqual([])
    session.dispose()
  })

  it('with the option the reopen waits for the room and falls through on timeout, reported', async () => {
    const adapter = await seeded()
    const store = new MemStoreDir()
    const clock = new SimClock()
    const first = await bootStart(adapter, store, clock).start()
    first.dispose()
    const b = bootStart(adapter, store, clock, {
      relay: { url: 'ws://127.0.0.1:9', token: 'irrelevant' },
      webSocketPolyfill: DeadSocket,
      awaitRoomOnReopen: { timeoutMs: 1_000 },
    })
    let settled = false
    const pending = b.start().then((s) => {
      settled = true
      return s
    })
    for (let i = 0; i < 5; i++) await settle()
    // Still waiting for a room that will never sync…
    expect(settled).toBe(false)
    clock.advance(1_001)
    for (let i = 0; i < 5; i++) await settle()
    const session = await pending
    // …then the ordinary reopen: content present, and the wait reported.
    expect(session.docForPath('a.md')?.getText()).toBe('works offline\n')
    expect(b.errors.length).toBeGreaterThanOrEqual(1)
    session.dispose()
  })
})
