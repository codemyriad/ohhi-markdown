/**
 * A relay refusal's event says whether the room is a share this device
 * joined (`relay.state` → `joined`), so the host words a dead token as the
 * link's or as this device's. The root of a folder share opened as a vault of
 * its own is a joined share too, though its room is at the root.
 *
 * The provider's auth-failure callback is the seam under test; it is reached
 * directly here (no relay process), as the provider would call it.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { FileJournal, MemLcaStore, MemStoreDir, MemVaultAdapter } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import type { AppEvent } from '../src/events.js'
import { MountSession, type MountSessionConfig } from '../src/mount-session.js'
import type { SyncRecordFields } from '../src/types.js'

async function refusedEvent(extra: Partial<MountSessionConfig>): Promise<AppEvent<'relay.state'>> {
  const clock = new SimClock()
  const events: AppEvent[] = []
  const session = await MountSession.create({
    engine: createYjsEngine(),
    adapter: new MemVaultAdapter(),
    user: { name: 'Test', color: '#000' },
    room: 'room-refused',
    clock,
    lcaStore: new MemLcaStore(),
    journal: new FileJournal(new MemStoreDir(), { now: () => clock.now() }),
    recordFor: (): SyncRecordFields => ({
      connected: false,
      synced: false,
      pendingLocal: false,
      diskMatchesCrdt: true,
      diverged: false,
    }),
    makeShareLink: (relay, room) => `link:${relay.url}:${room}`,
    events: { onEvent: (e) => events.push(e), onError: () => {} },
    ...extra,
  })
  ;(session as unknown as { reportAuthFailure(reason: string): void }).reportAuthFailure('unknown_token')
  session.dispose()
  const refused = events.filter((e) => e.kind === 'relay.state') as AppEvent<'relay.state'>[]
  expect(refused).toHaveLength(1)
  return refused[0]!
}

describe('a relay refusal names whether the room is a joined share', () => {
  it('this device’s own vault: not joined', async () => {
    const e = await refusedEvent({ provenance: 'local' })
    expect(e.payload).toEqual({ to: 'refused', reason: 'unknown_token', joined: false })
  })

  it('a folder share opened as a vault of its own: joined, though its room is the root', async () => {
    const e = await refusedEvent({ provenance: 'local', joinedShare: true })
    expect(e.scope.mount ?? '').toBe('')
    expect(e.payload.joined).toBe(true)
  })

  it('a joined mount: joined', async () => {
    const e = await refusedEvent({ provenance: 'joined', mountPath: 'team' })
    expect(e.payload.joined).toBe(true)
  })
})
