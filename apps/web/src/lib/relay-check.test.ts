/**
 * The relay facts a received link is shown with (first-run C2/C3): the
 * health check's answer, mapped once for the join page and the Add dialog —
 * a relay that answered unhealthy is not one that could not be reached.
 */
import { describe, expect, it, vi } from 'vitest'
import { checkRelay, teamRelayHost, type Probe } from './relay-check.js'
import type { ProbeResult } from './relay-probe.js'

const RELAY = 'wss://team.example/relay'
const flush = () => new Promise((r) => setTimeout(r, 0))

function answering(result: ProbeResult | Error): Probe {
  return async () => {
    if (result instanceof Error) throw result
    return result
  }
}

describe('checkRelay', () => {
  it.each([
    [{ ok: true } as ProbeResult, 'ok'],
    [{ ok: false, reason: 'unhealthy' } as ProbeResult, 'unhealthy'],
    [{ ok: false, reason: 'unreachable' } as ProbeResult, 'down'],
    [{ ok: false, reason: 'timeout' } as ProbeResult, 'down'],
  ])('maps %j to %s', async (result, expected) => {
    const onResult = vi.fn()
    checkRelay(RELAY, answering(result), onResult)
    await flush()
    expect(onResult).toHaveBeenCalledExactlyOnceWith(expected)
  })

  it('a probe that throws is down', async () => {
    const onResult = vi.fn()
    checkRelay(RELAY, answering(new Error('boom')), onResult)
    await flush()
    expect(onResult).toHaveBeenCalledExactlyOnceWith('down')
  })

  it('asks the probe about the link\'s relay; cancelling aborts it and drops a late answer', async () => {
    let signal: AbortSignal | null = null
    let resolve: (r: ProbeResult) => void = () => {}
    const probe: Probe = (relay, s) => {
      expect(relay).toBe(RELAY)
      signal = s
      return new Promise((r) => (resolve = r))
    }
    const onResult = vi.fn()
    const cancel = checkRelay(RELAY, probe, onResult)
    cancel()
    expect(signal!.aborted).toBe(true)
    resolve({ ok: true })
    await flush()
    expect(onResult).not.toHaveBeenCalled()
  })
})

describe('teamRelayHost', () => {
  it('is the configured relay\'s host, and null on the local-dev fallback', () => {
    expect(teamRelayHost(true, RELAY)).toBe('team.example')
    expect(teamRelayHost(false, RELAY)).toBeNull()
  })
})
