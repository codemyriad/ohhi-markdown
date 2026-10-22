/**
 * A repeating task on the injected clock (golden rule 5): run `task` every
 * `ms`. A task that returns a promise re-arms only once it settles, so a slow
 * pass never overlaps the next; a synchronous one re-arms at once. A failure
 * goes to `onError` and the loop carries on. The token sweep, the access
 * re-check, the free-disk watermark and the marker heartbeat all run on this.
 */
import type { Clock } from '@ohhi/vault'

export function every(clock: Clock, ms: number, task: () => unknown, onError?: (err: unknown) => void): () => void {
  let cancel: (() => void) | null = null
  let stopped = false
  const arm = (): void => {
    if (stopped) return
    cancel = clock.schedule(run, ms)
  }
  const run = (): void => {
    let result: unknown
    try {
      result = task()
    } catch (err) {
      onError?.(err)
      arm()
      return
    }
    if (!(result instanceof Promise)) {
      arm()
      return
    }
    void result.catch((err: unknown) => onError?.(err)).finally(arm)
  }
  arm()
  return () => {
    stopped = true
    cancel?.()
    cancel = null
  }
}
