/**
 * The agent's write budget (writing-harness-shaping B10, research
 * `harness-in-doc-editing.md` §3): every transaction the in-app agent applies
 * to a live doc — a proposal pinned, a suggestion applied in direct mode —
 * passes through a token bucket, so a model that "types" at thousands of
 * words a minute reaches the relay and the peers' editors at a rate a human
 * can watch, and never as one flood of frames.
 *
 * A classic bucket: `capacity` tokens, refilled continuously at `capacity`
 * per `windowMs` (default 10 per 100 ms). A burst of up to `capacity` ops
 * runs at once; beyond that, ops wait their turn in FIFO order. So in any
 * window of `windowMs` at most `2 × capacity` ops run (a full bucket plus one
 * window's refill), and over a long run the rate is `capacity / windowMs`.
 *
 * Time is the injected clock (golden rule 5): `SimClock` drives every test.
 * Nothing is ever dropped — a queued op runs late, never not at all — and an
 * op that throws rejects its own promise without stalling the queue.
 */
import type { Clock } from '@ohhi/vault'

export interface ThrottleOptions {
  /** Ops a full bucket holds (the burst). Default 10. */
  capacity?: number
  /** The time `capacity` tokens take to refill. Default 100 ms. */
  windowMs?: number
}

export const AGENT_OPS_PER_WINDOW = 10
export const AGENT_WINDOW_MS = 100

interface Task {
  cost: number
  run: () => void
}

export class AgentThrottle {
  readonly capacity: number
  readonly windowMs: number
  private tokens: number
  private last: number
  private readonly queue: Task[] = []
  private cancelWake: (() => void) | null = null
  private disposed = false

  constructor(
    private readonly clock: Clock,
    opts: ThrottleOptions = {}
  ) {
    this.capacity = opts.capacity ?? AGENT_OPS_PER_WINDOW
    this.windowMs = opts.windowMs ?? AGENT_WINDOW_MS
    this.tokens = this.capacity
    this.last = clock.now()
  }

  /** Ops waiting for a token. */
  get pending(): number {
    return this.queue.length
  }

  /**
   * Run `fn` when `cost` tokens are free (now, when the bucket has them and
   * nothing is queued ahead). Resolves with `fn`'s result, rejects with its
   * error. `cost` is the number of Y transactions `fn` applies.
   */
  run<T>(fn: () => T, cost = 1): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('agent throttle disposed'))
    const need = Math.max(0, Math.min(cost, this.capacity))
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        cost: need,
        run: () => {
          try {
            resolve(fn())
          } catch (err) {
            reject(err)
          }
        },
      })
      this.drain()
    })
  }

  /** Drop the queue (its promises never settle) and the wake-up. */
  dispose(): void {
    this.disposed = true
    this.queue.length = 0
    this.cancelWake?.()
    this.cancelWake = null
  }

  private refill(): void {
    const now = this.clock.now()
    const elapsed = now - this.last
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + (elapsed * this.capacity) / this.windowMs)
      this.last = now
    }
  }

  private drain(): void {
    if (this.cancelWake) return // a wake-up is already due; it drains in order
    this.refill()
    while (this.queue.length > 0) {
      const head = this.queue[0]!
      if (this.tokens + 1e-9 < head.cost) break
      this.tokens -= head.cost
      this.queue.shift()
      head.run()
    }
    if (this.queue.length === 0 || this.disposed) return
    const missing = this.queue[0]!.cost - this.tokens
    const wait = Math.max(1, Math.ceil((missing * this.windowMs) / this.capacity))
    this.cancelWake = this.clock.schedule(() => {
      this.cancelWake = null
      this.drain()
    }, wait)
  }
}
