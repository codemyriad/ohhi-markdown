/** The held-changes reads (decision 7): at open, at once when the custodian's hold count moves, every 5 s only while there is something to watch. */
import { SimClock } from '@ohhi/testkit'
import { describe, expect, it, vi } from 'vitest'
import type { NcApi, NcHold, NcVaultStatus } from './api.js'
import { NcApiError } from './api.js'
import { createHoldsPoll, HOLDS_POLL_MS } from './holds.svelte.js'

const hold: NcHold = { id: 'h1', kind: 'breaker', paths: ['a.md', 'b.md'], since: 1 }

function status(holds: NcHold[], custodian: NcVaultStatus['custodian'] = 'running'): NcVaultStatus {
  return {
    vault: { id: 'v1', fileId: 1, ownerUid: 'alice', ownerPath: 'Notes', room: 'r1', epoch: 1, createdAt: '', status: 'active' },
    custodian,
    holds,
    files: {},
    peers: 1,
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0))

function fakeApi(holds: () => NcHold[], custodian: () => NcVaultStatus['custodian'] = () => 'running'): NcApi & { statusCalls: number } {
  const api = {
    statusCalls: 0,
    me: vi.fn(),
    vaults: vi.fn(),
    enrol: vi.fn(),
    grant: vi.fn(),
    status: vi.fn(async () => {
      api.statusCalls++
      return status(holds(), custodian())
    }),
    resolveHold: vi.fn(async () => status([])),
  }
  return api as unknown as NcApi & { statusCalls: number }
}

describe('createHoldsPoll', () => {
  it('reads at once on open, and never on the clock while there is nothing to watch', async () => {
    const clock = new SimClock()
    const api = fakeApi(() => [])
    const poll = createHoldsPoll(api, clock)
    poll.start('v1')
    await tick()
    expect(api.statusCalls).toBe(1)
    expect(clock.pendingCount()).toBe(0)
    clock.advance(10 * 60_000)
    await tick()
    expect(api.statusCalls).toBe(1)
  })

  it("reads at once when the custodian's hold count moves; every 5 s while a hold is up; stops after stop", async () => {
    const clock = new SimClock()
    let current: NcHold[] = []
    const api = fakeApi(() => current)
    const poll = createHoldsPoll(api, clock)
    poll.start('v1')
    await tick()
    poll.noteHolds(0) // agrees with what was read: no read
    poll.noteHolds(null) // no custodian announced: no read
    await tick()
    expect(api.statusCalls).toBe(1)

    current = [hold]
    poll.noteHolds(1) // the awareness says a hold appeared: read NOW, not 15 s later
    await tick()
    expect(api.statusCalls).toBe(2)
    expect(poll.holds).toEqual([hold])
    poll.noteHolds(1)
    await tick()
    expect(api.statusCalls).toBe(2)

    clock.advance(HOLDS_POLL_MS - 1)
    await tick()
    expect(api.statusCalls).toBe(2)
    clock.advance(1)
    await tick()
    expect(api.statusCalls).toBe(3)

    current = [] // answered by someone else
    poll.noteHolds(0)
    await tick()
    expect(api.statusCalls).toBe(4)
    expect(poll.holds).toEqual([])
    expect(clock.pendingCount()).toBe(0) // nothing to watch: no timer

    current = [hold]
    poll.noteHolds(1)
    await tick()
    poll.stop()
    expect(poll.holds).toEqual([])
    clock.advance(HOLDS_POLL_MS * 3)
    poll.noteHolds(2)
    await tick()
    expect(api.statusCalls).toBe(5)
    expect(clock.pendingCount()).toBe(0)
  })

  it('re-reads every 5 s while an enrolment is in flight, then stops', async () => {
    const clock = new SimClock()
    let state: NcVaultStatus['custodian'] = 'enrolling'
    const api = fakeApi(() => [], () => state)
    const poll = createHoldsPoll(api, clock)
    poll.start('v1')
    await tick()
    expect(poll.status?.custodian).toBe('enrolling')
    clock.advance(HOLDS_POLL_MS)
    await tick()
    expect(api.statusCalls).toBe(2)
    state = 'running'
    clock.advance(HOLDS_POLL_MS)
    await tick()
    expect(api.statusCalls).toBe(3)
    expect(clock.pendingCount()).toBe(0)
  })

  it('keeps the last answer through a failed read, and keeps watching the hold', async () => {
    const clock = new SimClock()
    const api = fakeApi(() => [hold])
    const poll = createHoldsPoll(api, clock)
    poll.start('v1')
    await tick()
    expect(poll.holds).toEqual([hold])
    vi.mocked(api.status).mockRejectedValueOnce(new NcApiError(0, 'down'))
    clock.advance(HOLDS_POLL_MS)
    await tick()
    expect(poll.holds).toEqual([hold])
    expect(clock.pendingCount()).toBe(1) // still watching
  })

  it('posts the answer and shows the status it returns; a failure is said', async () => {
    const clock = new SimClock()
    const api = fakeApi(() => [hold])
    const poll = createHoldsPoll(api, clock)
    poll.start('v1')
    await tick()
    await poll.resolve('h1', 'confirm')
    expect(api.resolveHold).toHaveBeenCalledWith('v1', 'h1', 'confirm')
    expect(poll.holds).toEqual([])
    expect(poll.busy).toBeNull()

    vi.mocked(api.resolveHold).mockRejectedValueOnce(new NcApiError(403, 'forbidden'))
    await poll.resolve('h1', 'discard')
    expect(poll.error).toBeTruthy()
  })
})
