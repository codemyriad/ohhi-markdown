/**
 * The relay facts a received link is shown with (first-run C2/C3): whose
 * relay it is, and whether it answers from here. Shared by the join page and
 * the *Add a shared folder* dialog so the two never word or decide it
 * differently.
 *
 * Honesty (R5): "reachable" means `probeRelay`'s health check answered — it
 * never says the link's token is good.
 */
import { relayHost } from '@ohhi/workspace'
import { DEFAULT_RELAY, DEFAULT_RELAY_CONFIGURED } from './config.js'
import { probeRelay, type ProbeResult } from './relay-probe.js'

/**
 * What a surface shows: still asking, the health check answered `ok`, the
 * relay answered but says it is not healthy, or nothing answered in time.
 * `unhealthy` is not `down`: the relay WAS reached, so "join the tailnet" is
 * the wrong advice for it.
 */
export type RelayCheck = 'pending' | 'ok' | 'unhealthy' | 'down'

/** A probe a surface can be handed (tests pass a fake); `signal` aborts it. */
export type Probe = (relayWsUrl: string, signal: AbortSignal) => Promise<ProbeResult>

/**
 * `probeRelay` with a caller's abort: closing the dialog or leaving the page
 * cancels the request instead of letting it run to its own timeout.
 */
export const defaultProbe: Probe = (relayWsUrl, signal) =>
  probeRelay(relayWsUrl, {
    fetch: (input, init) => {
      const inner = init?.signal
      const controller = new AbortController()
      const abort = (): void => controller.abort()
      if (signal.aborted || inner?.aborted) controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      inner?.addEventListener('abort', abort, { once: true })
      return fetch(input, { ...init, signal: controller.signal })
    },
  })

/**
 * Probe `relay` and report once, unless cancelled first. Returns the cancel:
 * after it, the answer (if one still arrives) is dropped and the request is
 * aborted.
 */
export function checkRelay(
  relay: string,
  probe: Probe,
  onResult: (check: Exclude<RelayCheck, 'pending'>) => void
): () => void {
  const controller = new AbortController()
  let live = true
  probe(relay, controller.signal).then(
    (r) => {
      if (live) onResult(r.ok ? 'ok' : r.reason === 'unhealthy' ? 'unhealthy' : 'down')
    },
    () => {
      if (live) onResult('down')
    }
  )
  return () => {
    live = false
    controller.abort()
  }
}

/**
 * The host of the relay this build was GIVEN (`VITE_DEFAULT_RELAY`, from
 * `TEAM_HOST`), or null when it runs on the local-dev fallback — a build with
 * no relay has no "team's relay" to recognise.
 */
export function teamRelayHost(configured: boolean = DEFAULT_RELAY_CONFIGURED, relay: string = DEFAULT_RELAY): string | null {
  return configured ? (relayHost(relay) ?? null) : null
}
