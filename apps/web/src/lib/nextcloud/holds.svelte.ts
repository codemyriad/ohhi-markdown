/**
 * Held changes in a Nextcloud vault (nextcloud-build decision 7): the
 * headless custodian never confirms a mass change or resolves a divergence
 * on its own — it HOLDS them on the vault's status, and a person who can
 * write the folder answers. This reads `GET /api/vaults/:id/status` and
 * posts the answer.
 *
 * When it reads (changed 2026-10-11 — the blind 15 s poll found a hold up to
 * 15 s late): once when a vault opens; at once whenever the custodian's
 * awareness says its hold count moved (`noteHolds`, from
 * `CustodianState.holds`); and on the injected clock every 5 s ONLY while
 * there is something to watch — a hold on screen, or an enrolment in flight
 * (`custodian: 'enrolling'`, whose `files` the shell counts). Otherwise it
 * does not poll at all.
 *
 * A failed read keeps the last answer: a hold that was there is still there
 * until the server says otherwise (and the 5 s read goes on while it is).
 */
import type { Clock } from '@ohhi/vault'
import { ncErrorText, type NcApi, type NcHold, type NcHoldAction, type NcVaultStatus } from './api.js'

/** The re-read interval while a hold is on screen or an enrolment is in flight. */
export const HOLDS_POLL_MS = 5_000

/** Whether this status is worth re-reading on the clock: a hold to answer, or an enrolment to count. */
export function needsPoll(status: NcVaultStatus | null): boolean {
  return status !== null && (status.holds.length > 0 || status.custodian === 'enrolling')
}

export interface HoldsPoll {
  readonly vaultId: string | null
  readonly status: NcVaultStatus | null
  readonly holds: NcHold[]
  /** The hold an answer is in flight for, else null. */
  readonly busy: string | null
  /** The last answer's failure, in words; cleared by the next success. */
  readonly error: string | null
  start(vaultId: string): void
  stop(): void
  /** Read now (and re-arm the 5 s read when there is something to watch). */
  refresh(): Promise<void>
  /**
   * The custodian's announced hold count (`CustodianState.holds`; null while
   * no custodian is announced). A change reads the status at once.
   */
  noteHolds(count: number | null): void
  resolve(holdId: string, action: NcHoldAction): Promise<void>
}

export function createHoldsPoll(api: NcApi, clock: Clock, everyMs: number = HOLDS_POLL_MS): HoldsPoll {
  let vaultId = $state<string | null>(null)
  let status = $state.raw<NcVaultStatus | null>(null)
  let busy = $state<string | null>(null)
  let error = $state<string | null>(null)
  let cancelTimer: (() => void) | null = null
  /** Bumped by start/stop so a poll answering for a closed vault is dropped. */
  let gen = 0

  function arm(): void {
    cancelTimer?.()
    cancelTimer = vaultId !== null && needsPoll(status) ? clock.schedule(() => void refresh(), everyMs) : null
  }

  async function refresh(): Promise<void> {
    const id = vaultId
    if (id === null) return
    const mine = gen
    try {
      const next = await api.status(id)
      if (mine === gen) status = next
    } catch {
      // Keep the last answer; the next tick tries again.
    } finally {
      if (mine === gen) arm()
    }
  }

  return {
    get vaultId() {
      return vaultId
    },
    get status() {
      return status
    },
    get holds() {
      return status?.holds ?? []
    },
    get busy() {
      return busy
    },
    get error() {
      return error
    },
    start(id) {
      if (vaultId === id) return
      gen++
      vaultId = id
      status = null
      error = null
      void refresh()
    },
    stop() {
      gen++
      cancelTimer?.()
      cancelTimer = null
      vaultId = null
      status = null
      busy = null
      error = null
    },
    refresh,
    noteHolds(count) {
      // News only when it disagrees with what was last read: a hold appeared,
      // or the one on screen was answered (by someone else, or in Files).
      if (vaultId === null || count === null || count === (status?.holds.length ?? 0)) return
      void refresh()
    },
    async resolve(holdId, action) {
      const id = vaultId
      if (id === null || busy !== null) return
      const mine = gen
      busy = holdId
      try {
        const next = await api.resolveHold(id, holdId, action)
        if (mine === gen) {
          status = next
          error = null
        }
      } catch (err) {
        if (mine === gen) error = ncErrorText(err)
      } finally {
        if (mine === gen) busy = null
      }
    },
  }
}
