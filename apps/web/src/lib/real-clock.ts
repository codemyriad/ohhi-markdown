/**
 * Wall-clock Clock for the app shell. Inlined (not from @editor/testkit) so
 * production code never depends on the test kit; libs still get injected
 * clocks per golden rule 5.
 */
import type { Clock } from '@editor/vault'

export const realClock: Clock = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}
