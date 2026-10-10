/**
 * The relay probe and the secret check (first-run D1/D2): a fake `fetch` and
 * a hand-driven timer stand in for the relay and for time.
 */
import { describe, expect, it, vi } from 'vitest'
import { PROBE_TIMEOUT_MS, probeRelay, verifySecret } from './relay-probe.js'

const RELAY = 'wss://relay.example.test/relay'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fake fetch answering with `res` (or rejecting), recording what it was asked. */
function fakeFetch(answer: Response | Error) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (answer instanceof Error) throw answer
    return answer
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>
}

/** A fetch that never answers until its signal aborts. */
function hangingFetch() {
  return vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
  ) as unknown as typeof fetch
}

/** A timer the test fires by hand. */
function manualTimer() {
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = []
  return {
    pending,
    schedule: (fn: () => void, ms: number) => {
      const entry = { fn, ms, cancelled: false }
      pending.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
    fire() {
      for (const p of pending) if (!p.cancelled) p.fn()
    },
  }
}

describe('probeRelay', () => {
  it('asks the http(s) base’s /healthz and calls a 200 {ok:true} reachable', async () => {
    const f = fakeFetch(json(200, { ok: true }))
    const timer = manualTimer()
    expect(await probeRelay(RELAY, { fetch: f, schedule: timer.schedule })).toEqual({ ok: true })
    expect(f.mock.calls[0]![0]).toBe('https://relay.example.test/relay/healthz')
    expect((f.mock.calls[0]![1] as RequestInit).method).toBe('GET')
    // The deadline is the default, and it is cancelled once the answer is in.
    expect(timer.pending[0]!.ms).toBe(PROBE_TIMEOUT_MS)
    expect(timer.pending[0]!.cancelled).toBe(true)
  })

  it('maps a dev relay ws:// URL to http://', async () => {
    const f = fakeFetch(json(200, { ok: true }))
    await probeRelay('ws://localhost:8787', { fetch: f, schedule: manualTimer().schedule })
    expect(f.mock.calls[0]![0]).toBe('http://localhost:8787/healthz')
  })

  it('a relay that answers but cannot persist is unhealthy: 503, or {ok:false}', async () => {
    const schedule = manualTimer().schedule
    expect(await probeRelay(RELAY, { fetch: fakeFetch(json(503, { ok: false })), schedule })).toEqual({
      ok: false,
      reason: 'unhealthy',
    })
    expect(await probeRelay(RELAY, { fetch: fakeFetch(json(200, { ok: false })), schedule })).toEqual({
      ok: false,
      reason: 'unhealthy',
    })
    // Something answering that is not the health JSON is not a healthy relay either.
    expect(
      await probeRelay(RELAY, { fetch: fakeFetch(new Response('<html>Welcome</html>', { status: 200 })), schedule })
    ).toEqual({ ok: false, reason: 'unhealthy' })
  })

  it('no answer at all is unreachable', async () => {
    const r = await probeRelay(RELAY, { fetch: fakeFetch(new TypeError('Failed to fetch')), schedule: manualTimer().schedule })
    expect(r).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('no answer in time is a timeout, after the given deadline', async () => {
    const timer = manualTimer()
    const pending = probeRelay(RELAY, { fetch: hangingFetch(), timeoutMs: 500, schedule: timer.schedule })
    expect(timer.pending[0]!.ms).toBe(500)
    timer.fire()
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
  })
})

describe('verifySecret', () => {
  it('lists shares with the secret as bearer — for a room that does not exist — and says ok', async () => {
    const f = fakeFetch(json(200, { shares: [] }))
    expect(await verifySecret(RELAY, 's3cret', { fetch: f, schedule: manualTimer().schedule })).toBe('ok')
    const [url, init] = f.mock.calls[0]! as [string, RequestInit]
    expect(url).toMatch(/^https:\/\/relay\.example\.test\/relay\/shares\?folder=/)
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer s3cret')
  })

  it('401 is a secret that does not match', async () => {
    const f = fakeFetch(json(401, { error: 'unauthorized' }))
    expect(await verifySecret(RELAY, 'wrong', { fetch: f, schedule: manualTimer().schedule })).toBe('bad_secret')
  })

  it('the relay’s own 404 "not found" is a relay with no admin API', async () => {
    const f = fakeFetch(json(404, { error: 'not found' }))
    expect(await verifySecret(RELAY, 's3cret', { fetch: f, schedule: manualTimer().schedule })).toBe('no_admin')
  })

  it('no answer, or an answer that cannot vouch for the secret, is unreachable', async () => {
    const schedule = manualTimer().schedule
    expect(await verifySecret(RELAY, 's', { fetch: fakeFetch(new TypeError('Failed to fetch')), schedule })).toBe(
      'unreachable'
    )
    // A 404 from something else in front of the relay (a proxy's page) is not "no admin".
    expect(await verifySecret(RELAY, 's', { fetch: fakeFetch(new Response('nope', { status: 404 })), schedule })).toBe(
      'unreachable'
    )
    const timer = manualTimer()
    const pending = verifySecret(RELAY, 's', { fetch: hangingFetch(), schedule: timer.schedule })
    timer.fire()
    expect(await pending).toBe('unreachable')
  })
})
