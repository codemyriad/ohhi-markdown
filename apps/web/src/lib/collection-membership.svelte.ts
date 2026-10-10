/**
 * The shell's one membership tracker (bases-shaping A7, Fork 3-B): which
 * open notes are rows of a collection, asked ONCE per note path however
 * many panes show it, coalesced on the shell's clock as the index changes
 * (golden rule 5: only the injected clock schedules). A pane `watch`es its
 * note and reads `isMember` reactively; the engine reads the same answer
 * synchronously through `ReadHost.inCollection` and is told to rebuild when
 * it flips.
 *
 * The last answer for a path is kept until the next one lands, so a note
 * reopened — or shown in a second pane — draws its form at once rather
 * than flashing the strip first; a note never asked about is asked at
 * once and shows the strip until the index replies.
 */
import { isCollectionPath } from '@ohhi/collections'
import type { VaultIndex } from '@ohhi/index'
import type { Clock } from '@ohhi/vault'
import { collectionQueries, inAnyCollection, type CompiledCollection } from './collection-membership.js'

export interface CollectionMembership {
  /** The last answer for `path` — false until the first lands. Reactive. */
  isMember(path: string): boolean
  /** Keep `path`'s answer current while watched; the release stops that. */
  watch(path: string): () => void
  /** The index changed: re-ask for every watched note, coalesced on the clock. */
  invalidate(): void
}

export interface MembershipDeps {
  index(): VaultIndex
  clock: Clock
  /** Every file path the vault holds; the `.base` files among them are the collections. */
  paths(): readonly string[]
  /** A collection file's live text, or null when the vault has not got it. */
  textOf(path: string): string | null
}

/** How long typing anywhere may go on before the watched notes are re-asked. */
export const MEMBERSHIP_COALESCE_MS = 120

export function createMembership(deps: MembershipDeps): CollectionMembership {
  const answers = $state<Record<string, boolean>>({})
  const watchers = new Map<string, number>()
  /** Each `.base` compiled once per text (`collectionQueries` prunes what is gone). */
  const cache = new Map<string, CompiledCollection>()
  let pending: (() => void) | null = null
  /** Per path, the run whose answer counts: a later ask supersedes one still in flight. */
  const asked = new Map<string, number>()
  let runs = 0

  function run(paths: readonly string[]): void {
    if (paths.length === 0) return
    const run = ++runs
    const queries = collectionQueries(deps.paths().filter(isCollectionPath), deps.textOf, cache)
    const now = deps.clock.now()
    // The reader's zone, read per run so `today()` is their calendar day even after a zone change. A zone is not a clock. clock-exempt
    const tzOffsetMinutes = -new Date().getTimezoneOffset() // clock-exempt
    const index = deps.index()
    for (const path of paths) {
      asked.set(path, run)
      void inAnyCollection(index, queries, path, now, tzOffsetMinutes).then((answer) => {
        if (asked.get(path) === run) answers[path] = answer
      })
    }
  }

  function flush(): void {
    pending = null
    run([...watchers.keys()])
  }

  function invalidate(): void {
    if (watchers.size === 0) return
    pending?.()
    pending = deps.clock.schedule(flush, MEMBERSHIP_COALESCE_MS)
  }

  return {
    isMember: (path) => answers[path] ?? false,
    watch(path) {
      watchers.set(path, (watchers.get(path) ?? 0) + 1)
      // Never asked: at once. Asked before: its last answer stands, and the
      // next coalesced run refreshes it.
      if (path in answers) invalidate()
      else run([path])
      return () => {
        const left = (watchers.get(path) ?? 1) - 1
        if (left <= 0) watchers.delete(path)
        else watchers.set(path, left)
      }
    },
    invalidate,
  }
}
