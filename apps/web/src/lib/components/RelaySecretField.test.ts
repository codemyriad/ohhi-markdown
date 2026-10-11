// @vitest-environment jsdom
/**
 * The team's secret field (first-run D2): the check it reports is a gate
 * (the share sheet keeps *Share* disabled until it is `ok`), so it must never
 * outlive the value or the relay it was about. A relay change resets it AT
 * ONCE — not after the debounce — and a slow answer for an older check is
 * dropped when a newer one has been asked.
 *
 * The clock is manual: nothing runs until the test flushes it.
 */
import { getLL } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import userEvent from '@testing-library/user-event'
import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SecretCheck } from '../relay-probe.js'
import RelaySecretField from './RelaySecretField.svelte'

afterEach(cleanup)

const t = getLL().web.relay_card.secret
const A = 'wss://a.example/relay'
const B = 'wss://b.example/relay'

/** A clock whose scheduled work runs only when `flush()` is called. */
function manualClock(): Clock & { flush(): void } {
  let jobs: { fn: () => void; live: boolean }[] = []
  return {
    now: () => 0,
    schedule(fn) {
      const job = { fn, live: true }
      jobs.push(job)
      return () => {
        job.live = false
      }
    },
    flush() {
      const due = jobs
      jobs = []
      for (const j of due) if (j.live) j.fn()
    },
  }
}

/** A verify call the test answers by hand. */
function deferredVerify() {
  const calls: { relay: string; secret: string; answer: (c: SecretCheck) => void }[] = []
  const verify = vi.fn(
    (relay: string, secret: string) =>
      new Promise<SecretCheck>((resolve) => {
        calls.push({ relay, secret, answer: resolve })
      })
  )
  return { verify, calls }
}

const status = (): HTMLElement => screen.getByTestId('secret-check')

describe('RelaySecretField', () => {
  it('a relay change resets the check synchronously — never "ok" for a relay it was not asked about', async () => {
    const clock = manualClock()
    const verify = vi.fn(async (): Promise<SecretCheck> => 'ok')
    const { rerender } = render(RelaySecretField, { relayUrl: A, value: 's3cret', clock, verify })
    clock.flush()
    await waitFor(() => expect(status()).toHaveAttribute('data-check', 'ok'))
    expect(verify).toHaveBeenLastCalledWith(A, 's3cret')

    await rerender({ relayUrl: B, value: 's3cret', clock, verify })
    await tick()
    // Before the debounce has run: no longer ok.
    expect(status()).toHaveAttribute('data-check', 'checking')
    expect(verify).toHaveBeenCalledTimes(1)

    clock.flush()
    await waitFor(() => expect(status()).toHaveAttribute('data-check', 'ok'))
    expect(verify).toHaveBeenLastCalledWith(B, 's3cret')
  })

  it('a relay taken away ("" — nothing it may be checked against) clears the check and asks nothing', async () => {
    const clock = manualClock()
    const verify = vi.fn(async (): Promise<SecretCheck> => 'ok')
    const { rerender } = render(RelaySecretField, { relayUrl: A, value: 's3cret', clock, verify })
    clock.flush()
    await waitFor(() => expect(status()).toHaveAttribute('data-check', 'ok'))

    await rerender({ relayUrl: '', value: 's3cret', clock, verify })
    await tick()
    expect(status()).toHaveAttribute('data-check', 'idle')
    clock.flush()
    await tick()
    expect(status()).toHaveAttribute('data-check', 'idle')
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('a slow, stale answer arriving after a newer check is dropped', async () => {
    const clock = manualClock()
    const { verify, calls } = deferredVerify()
    const user = userEvent.setup()
    render(RelaySecretField, { relayUrl: A, value: '', clock, verify })
    const field = screen.getByLabelText(t.title(), { exact: false })

    await user.type(field, 'old')
    clock.flush()
    expect(calls).toHaveLength(1)

    await user.clear(field)
    await user.type(field, 'new')
    clock.flush()
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ relay: A, secret: 'new' })

    calls[1]!.answer('bad_secret')
    await waitFor(() => expect(status()).toHaveAttribute('data-check', 'bad_secret'))
    // The answer for "old" lands late: ignored.
    calls[0]!.answer('ok')
    await tick()
    await Promise.resolve()
    expect(status()).toHaveAttribute('data-check', 'bad_secret')
    expect(status()).toHaveTextContent(t.bad_secret())
  })

  it('typing resets the check at once and reports oninput', async () => {
    const clock = manualClock()
    const verify = vi.fn(async (): Promise<SecretCheck> => 'ok')
    const oninput = vi.fn()
    const user = userEvent.setup()
    render(RelaySecretField, { relayUrl: A, value: 'abc', clock, verify, oninput })
    clock.flush()
    await waitFor(() => expect(status()).toHaveAttribute('data-check', 'ok'))

    await user.type(screen.getByLabelText(t.title(), { exact: false }), 'd')
    expect(oninput).toHaveBeenCalled()
    expect(status()).toHaveAttribute('data-check', 'checking')
  })
})
