/**
 * The process's one real clock (golden rule 5; nextcloud-build decision 18):
 * everything under `src/` takes a `Clock` from `@ohhi/vault`, and main.ts —
 * the host — is where the real one is built and passed down.
 *
 * Structurally identical to `@ohhi/testkit`'s `RealClock`, kept here (as in
 * `apps/cli/src/clock.ts`) rather than making a test-only package a runtime
 * dependency of the shipped bundle. The two ambient calls below are this
 * file's whole job, hence their `clock-exempt` markers.
 */
import type { Clock } from '@ohhi/vault'

export class RealClock implements Clock {
  now(): number {
    return Date.now() // clock-exempt: the real clock itself
  }
  schedule(fn: () => void, ms: number): () => void {
    const id = setTimeout(fn, ms) // clock-exempt: the real clock itself
    return () => clearTimeout(id)
  }
}
