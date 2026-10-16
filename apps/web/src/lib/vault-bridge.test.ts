/**
 * The join hand-off between tabs (join-share-brief P3): a holder answers at
 * once and runs the one join described; a sender with no holder gets `false`
 * after the wait and opens the vault itself; stray or malformed messages run
 * nothing.
 */
import { describe, expect, it, vi } from 'vitest'
import { SimClock } from '@ohhi/testkit'
import { HAND_OFF_WAIT_MS, handOffJoin, openVaultBridge, type VaultChannel } from './vault-bridge.js'

/** Two ends of one BroadcastChannel: what one posts, the OTHER hears. */
function channelPair(): [VaultChannel, VaultChannel] {
  const listeners: [Set<(ev: { data: unknown }) => void>, Set<(ev: { data: unknown }) => void>] = [new Set(), new Set()]
  const end = (mine: 0 | 1): VaultChannel => ({
    postMessage: (message) => {
      for (const l of listeners[mine === 0 ? 1 : 0]) l({ data: message })
    },
    addEventListener: (_t, l) => listeners[mine].add(l),
    removeEventListener: (_t, l) => listeners[mine].delete(l),
    close: () => listeners[mine].clear(),
  })
  return [end(0), end(1)]
}

const JOIN = { link: 'editor1:abc', dest: 'HackMD notes', name: 'Robin' }

describe('vault bridge', () => {
  it('a holder acknowledges and runs the join; the sender resolves true before the wait is up', async () => {
    const [holderEnd, senderEnd] = channelPair()
    const clock = new SimClock()
    const onJoin = vi.fn()
    const stop = openVaultBridge('v1', onJoin, holderEnd)

    const handed = handOffJoin('v1', JOIN, clock, senderEnd)
    expect(await handed).toBe(true)
    expect(onJoin).toHaveBeenCalledWith(JOIN)
    stop()
  })

  it('no holder: false after the wait, and nothing else happens', async () => {
    const [, senderEnd] = channelPair()
    const clock = new SimClock()
    const handed = handOffJoin('v1', JOIN, clock, senderEnd)
    clock.advance(HAND_OFF_WAIT_MS - 1)
    let settled = false
    void handed.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    clock.advance(1)
    expect(await handed).toBe(false)
  })

  it('a holder ignores what is not a join for it; an acknowledgement for another request is not this one', async () => {
    const [holderEnd, senderEnd] = channelPair()
    const clock = new SimClock()
    const onJoin = vi.fn()
    openVaultBridge('v1', onJoin, holderEnd)
    senderEnd.postMessage({ kind: 'join', id: 'x', join: { link: 1 } })
    senderEnd.postMessage('not an object')
    senderEnd.postMessage({ kind: 'join-ack', id: 'someone-else' })
    expect(onJoin).not.toHaveBeenCalled()
    // And the sender does not take a stray ack for its own.
    const [, lonely] = channelPair()
    const handed = handOffJoin('v1', JOIN, clock, lonely)
    lonely.postMessage({ kind: 'join-ack', id: 'someone-else' })
    clock.advance(HAND_OFF_WAIT_MS)
    expect(await handed).toBe(false)
  })

  it('without BroadcastChannel there is no hand-off: false at once, and the holder listens to nothing', async () => {
    const clock = new SimClock()
    expect(await handOffJoin('v1', JOIN, clock, null)).toBe(false)
    expect(openVaultBridge('v1', vi.fn(), null)).toBeTypeOf('function')
  })
})
