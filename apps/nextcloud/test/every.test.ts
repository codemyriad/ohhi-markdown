import { SimClock } from '@ohhi/testkit'
import { describe, expect, it } from 'vitest'
import { every } from '../src/every.js'

describe('every', () => {
  it('runs on the clock, keeps going past a failure, and stops', () => {
    const clock = new SimClock()
    const errors: unknown[] = []
    let runs = 0
    const stop = every(
      clock,
      1000,
      () => {
        runs++
        if (runs === 2) throw new Error('boom')
      },
      (e) => errors.push(e)
    )
    clock.advance(999)
    expect(runs).toBe(0)
    clock.advance(1)
    clock.advance(1000)
    clock.advance(1000)
    expect(runs).toBe(3)
    expect(errors).toHaveLength(1)
    stop()
    clock.advance(5000)
    expect(runs).toBe(3)
  })

  it('re-arms an async task only after it settles, so passes never overlap', async () => {
    const clock = new SimClock()
    let release: () => void = () => {}
    let runs = 0
    every(clock, 1000, () => {
      runs++
      return new Promise<void>((r) => (release = r))
    })
    clock.advance(1000)
    clock.advance(5000)
    expect(runs).toBe(1)
    release()
    await new Promise((r) => setTimeout(r, 0))
    clock.advance(1000)
    expect(runs).toBe(2)
  })
})
