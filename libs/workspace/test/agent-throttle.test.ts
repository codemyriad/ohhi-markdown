import { describe, expect, it } from 'vitest'
import { SimClock } from '@ohhi/testkit'
import { AgentThrottle } from '../src/agent-throttle.js'

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('AgentThrottle — the token bucket on the injected clock', () => {
  it('runs a burst of `capacity` at once, then refills at capacity per window', async () => {
    const clock = new SimClock()
    const t = new AgentThrottle(clock)
    const ran: number[] = []
    const all = Array.from({ length: 25 }, (_, i) => t.run(() => ran.push(i)))
    expect(ran).toHaveLength(10)
    expect(t.pending).toBe(15)
    clock.advance(50)
    expect(ran).toHaveLength(15)
    clock.advance(50)
    expect(ran).toHaveLength(20)
    clock.advance(100)
    expect(ran).toHaveLength(25)
    await Promise.all(all)
    expect(ran).toEqual([...Array(25).keys()]) // FIFO
    expect(clock.pendingCount()).toBe(0)
  })

  it('never runs more than 2 × capacity in any window, and the long-run rate is capacity per window', () => {
    const clock = new SimClock()
    const t = new AgentThrottle(clock)
    const at: number[] = []
    for (let i = 0; i < 300; i++) void t.run(() => at.push(clock.now()))
    clock.advance(5_000)
    expect(at).toHaveLength(300)
    for (const start of at) expect(at.filter((x) => x >= start && x < start + 100).length).toBeLessThanOrEqual(20)
    // 300 ops: 10 at once, 290 at 10 per 100 ms ≈ 2.9 s.
    expect(at.at(-1)!).toBeGreaterThanOrEqual(2_800)
    expect(at.at(-1)!).toBeLessThanOrEqual(3_000)
  })

  it('a cost takes that many tokens; a throwing op rejects alone and the queue moves on', async () => {
    const clock = new SimClock()
    const t = new AgentThrottle(clock, { capacity: 4, windowMs: 100 })
    const a = t.run(() => 'a', 3)
    const b = t.run(() => {
      throw new Error('boom')
    }, 2)
    const c = t.run(() => 'c', 1)
    await expect(a).resolves.toBe('a')
    expect(t.pending).toBe(2) // one token left; b needs 2
    clock.advance(25) // one token back
    await expect(b).rejects.toThrow('boom')
    await settle()
    expect(t.pending).toBe(1)
    clock.advance(25)
    await expect(c).resolves.toBe('c')
  })

  it('dispose drops the queue and the wake-up', () => {
    const clock = new SimClock()
    const t = new AgentThrottle(clock, { capacity: 1 })
    const ran: number[] = []
    void t.run(() => ran.push(1))
    void t.run(() => ran.push(2))
    t.dispose()
    clock.advance(1_000)
    expect(ran).toEqual([1])
    return expect(t.run(() => 3)).rejects.toThrow('disposed')
  })
})
