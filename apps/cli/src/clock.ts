/**
 * Golden rule 5: Editor-owned sync/vault/index code takes an injected clock.
 * The CLI is the host, so the CLI is where the real one is constructed.
 *
 * Structurally identical to `@ohhi/testkit`'s `RealClock`; duplicated here
 * (three lines) rather than making a test-only package a runtime dependency
 * of the shipped bundle.
 */
export class RealClock {
  now(): number {
    return Date.now()
  }
  schedule(fn: () => void, ms: number): () => void {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  }
}
