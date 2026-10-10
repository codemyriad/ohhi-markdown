/**
 * Two small questions to ask a relay before trusting it (first-run-shaping
 * D1/D2), pure apart from the `fetch` and timer they are handed:
 *
 *  - `probeRelay`: does it answer? `GET /healthz` on the relay's http(s)
 *    base. "Reachable" means exactly that a health check answered `ok` —
 *    never that a token or secret is good.
 *  - `verifySecret`: does the operator secret open its admin API? One listing
 *    call with the bearer, before any mint. It says "ok" or "doesn't match";
 *    it never claims more than that the relay accepted the secret just now.
 *
 * Both take an injected `fetch` and timer so tests drive them without a
 * relay or real time.
 */
import { adminBaseUrl, adminRequest } from './relay-admin.js'

/** Cancel a scheduled callback. */
type Cancel = () => void

export interface ProbeOptions {
  fetch?: typeof fetch
  /** How long to wait for an answer; default 3000 ms. */
  timeoutMs?: number
  /** The timer: `setTimeout` unless a test drives it. */
  schedule?: (fn: () => void, ms: number) => Cancel
}

export type ProbeResult = { ok: true } | { ok: false; reason: 'unreachable' | 'unhealthy' | 'timeout' }

export type SecretCheck = 'ok' | 'bad_secret' | 'no_admin' | 'unreachable'

export const PROBE_TIMEOUT_MS = 3000

const realSchedule = (fn: () => void, ms: number): Cancel => {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}

/** A signal that aborts after `timeoutMs`, and the cancel for its timer. */
function deadline(opts: ProbeOptions): { signal: AbortSignal; timedOut: () => boolean; done: Cancel } {
  const controller = new AbortController()
  let fired = false
  const cancel = (opts.schedule ?? realSchedule)(() => {
    fired = true
    controller.abort()
  }, opts.timeoutMs ?? PROBE_TIMEOUT_MS)
  return { signal: controller.signal, timedOut: () => fired, done: cancel }
}

/**
 * Ask the relay's health check whether it answers. 200 with `{ ok: true }` is
 * reachable; a 503 or `{ ok: false }` is a relay that answers but cannot
 * persist; no answer at all is unreachable; no answer in time is a timeout.
 */
export async function probeRelay(relayWsUrl: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const doFetch = opts.fetch ?? fetch
  const { signal, timedOut, done } = deadline(opts)
  try {
    let res: Response
    try {
      res = await doFetch(`${adminBaseUrl(relayWsUrl)}/healthz`, { method: 'GET', signal })
    } catch {
      return { ok: false, reason: timedOut() ? 'timeout' : 'unreachable' }
    }
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      if (timedOut()) return { ok: false, reason: 'timeout' }
      // An answer that is not the health JSON is not this relay's health check.
    }
    const ok = typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true
    return res.status === 200 && ok ? { ok: true } : { ok: false, reason: 'unhealthy' }
  } finally {
    done()
  }
}

/** The room the secret check lists: none has this id, so the answer is an empty list. */
const VERIFY_ROOM = 'ohhi-verify-secret'

/**
 * Check the operator secret against the relay's admin API by listing shares
 * (for a room that does not exist, so nothing is read back). 401 → the
 * secret does not match; the relay's own 404 "not found" → this relay has no
 * admin API (no `OPERATOR_SECRET`); no answer → unreachable. Any other
 * answer that is not a success is reported as unreachable too: the check
 * could not say the secret works.
 */
export async function verifySecret(relayWsUrl: string, secret: string, opts: ProbeOptions = {}): Promise<SecretCheck> {
  const { signal, done } = deadline(opts)
  try {
    let res: Response
    try {
      res = await adminRequest(relayWsUrl, secret, 'GET', `/shares?folder=${VERIFY_ROOM}`, {
        signal,
        ...(opts.fetch ? { fetch: opts.fetch } : {}),
      })
    } catch {
      return 'unreachable'
    }
    if (res.ok) return 'ok'
    if (res.status === 401) return 'bad_secret'
    if (res.status === 404) {
      const payload = (await res.json().catch(() => ({}))) as { error?: unknown }
      if (payload.error === 'not found') return 'no_admin'
    }
    return 'unreachable'
  } finally {
    done()
  }
}
