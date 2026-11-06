/**
 * Headless means hold, never confirm (nextcloud-build decision 7).
 *
 * A custodian has nobody to click: a mass-change breaker and a divergence
 * review are HELD here, listed in the vault's status, and applied only when a
 * writable user acts through `POST /api/vaults/:id/holds/:holdId`. The bench
 * harness's auto-confirm is deliberately not copied — and because the
 * custodian always passes `onBreaker`, MountSession's own unhandled-breaker
 * auto-confirm never runs either.
 */
import type { DivergenceReview } from '@ohhi/vault'
import { HttpError } from './appapi.js'
import type { Hold } from './types.js'

const ACTIONS = ['confirm', 'discard', 'disk', 'doc'] as const

/** A user's answer to a hold — the wire names of `POST /api/vaults/:id/holds/:holdId {action}`. */
export type HoldAction = (typeof ACTIONS)[number]

export const HOLD_ACTIONS: ReadonlySet<string> = new Set(ACTIONS)

/** The session API a hold's action is applied through (MountSession's surface). */
export interface HoldTarget {
  confirmBreaker(): Promise<void>
  dismissBreaker(): void
  resolveReview(guid: string, mergedText: string): Promise<void>
  resolveVanished(guid: string, action: 'restore' | 'remove'): Promise<void>
}

/** A hold that cannot be answered; the route answers it as it is (a 409 as `{error: 'refused', reason}`). */
export class HoldError extends HttpError {
  constructor(status: 404 | 409 | 400, message: string) {
    super(status, message, message)
    this.name = 'HoldError'
  }
}

export class HoldBook {
  private breaker: Hold | null = null
  private readonly reviews = new Map<string, { hold: Hold; review: DivergenceReview }>()
  private seq = 0

  constructor(
    private readonly now: () => number,
    private readonly onChange: () => void = () => {}
  ) {}

  /**
   * The session held a mass-change batch. A trip while one is already held
   * joins it (nextcloud-build R1 #9): the session's held batch is the union of both,
   * so the hold a user answers lists every path that answer applies to.
   */
  addBreaker(paths: string[]): Hold {
    if (this.breaker) {
      const merged = [...new Set([...this.breaker.paths, ...paths])]
      this.breaker = { ...this.breaker, paths: merged }
    } else {
      this.breaker = { id: `breaker-${++this.seq}`, kind: 'breaker', paths: [...paths], since: this.now() }
    }
    this.onChange()
    return this.breaker
  }

  addReview(review: DivergenceReview): Hold {
    const hold: Hold = { id: `review-${review.guid}`, kind: 'review', paths: [review.path], since: this.now(), guid: review.guid }
    this.reviews.set(review.guid, { hold, review })
    this.onChange()
    return hold
  }

  clearReview(guid: string): void {
    if (this.reviews.delete(guid)) this.onChange()
  }

  list(): Hold[] {
    return [...(this.breaker ? [this.breaker] : []), ...[...this.reviews.values()].map((r) => r.hold)]
  }

  /**
   * Apply a user's decision. `confirm`/`discard` answer a breaker; `disk`/`doc`
   * answer a review with that side's text (a vanished file: `disk` accepts the
   * removal, `doc` restores it). Throws `HoldError` for an unknown hold or an
   * action that does not fit it.
   */
  async apply(holdId: string, action: HoldAction, target: HoldTarget | null): Promise<void> {
    if (!HOLD_ACTIONS.has(action)) throw new HoldError(400, 'unknown action')
    if (this.breaker && this.breaker.id === holdId) {
      if (action !== 'confirm' && action !== 'discard') throw new HoldError(400, 'a held batch takes confirm or discard')
      if (!target) throw new HoldError(409, 'the custodian is not running')
      this.breaker = null
      this.onChange()
      if (action === 'confirm') await target.confirmBreaker()
      else target.dismissBreaker()
      return
    }
    const entry = [...this.reviews.values()].find((r) => r.hold.id === holdId)
    if (!entry) throw new HoldError(404, 'no such hold')
    if (action !== 'disk' && action !== 'doc') throw new HoldError(400, 'a review takes disk or doc')
    if (!target) throw new HoldError(409, 'the custodian is not running')
    const { review } = entry
    if (review.reason === 'vanished') await target.resolveVanished(review.guid, action === 'disk' ? 'remove' : 'restore')
    else await target.resolveReview(review.guid, action === 'disk' ? review.theirs : review.mine)
    // The session's onReviewCleared normally does this; a resolve that cleared
    // nothing (already gone) must not leave a hold nobody can answer.
    this.clearReview(review.guid)
  }
}
