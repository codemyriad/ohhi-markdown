/**
 * A provider's `timeoutSec` as an abort, scheduled on the host's injected
 * clock (golden rule 5) and composed with the caller's own signal — so a
 * SimClock test can fire it, and the person's *Stop* still wins.
 */
import type { Clock } from '@ohhi/testkit'

export class HarnessTimeoutError extends Error {
  constructor(readonly seconds: number) {
    super(`the provider did not finish within ${seconds}s`)
    this.name = 'TimeoutError'
  }
}

/**
 * A signal that aborts when `signal` does or `seconds` pass on `clock`;
 * `done()` cancels the timer, `timedOut()` says which of the two it was.
 */
export function withTimeout(
  clock: Clock,
  seconds: number | undefined,
  signal: AbortSignal | undefined,
): { signal: AbortSignal | undefined; done: () => void; timedOut: () => boolean } {
  if (!seconds || seconds <= 0) return { signal, done: () => {}, timedOut: () => false }
  let fired = false
  const controller = new AbortController()
  const onAbort = (): void => controller.abort(signal?.reason)
  if (signal?.aborted) controller.abort(signal.reason)
  else signal?.addEventListener('abort', onAbort, { once: true })
  const cancel = clock.schedule(() => {
    fired = true
    controller.abort(new HarnessTimeoutError(seconds))
  }, seconds * 1000)
  return {
    signal: controller.signal,
    done: () => {
      cancel()
      signal?.removeEventListener('abort', onAbort)
    },
    timedOut: () => fired,
  }
}
