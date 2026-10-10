/**
 * The shell's one membership tracker (bases-shaping A7, Fork 3-B): which
 * open notes are rows of a collection, asked ONCE per note path however
 * many panes show it, coalesced on the shell's clock as the index changes
 * (golden rule 5: only the injected clock schedules). A pane `watch`es its
 * note and reads `isMember` reactively; the engine reads the same answer
 * synchronously through `ReadHost.inCollection` and is told to rebuild when
 * it flips.
 *
 * The last answer for a path is kept while anything watches it, until the
 * next one lands, so a note shown in a second pane draws its form at once
 * rather than flashing the strip first, and a rename carries the answer to
 * the new path (`renamed`) so the remounted view draws it too. When the
 * last watcher releases a path its answer goes: a note created later at
 * that path has not earned the old one's form. A note not watched is asked
 * at once and shows the strip until the index replies.
 */
import { isCollectionPath } from '@ohhi/collections'
import { untrack } from 'svelte'
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
  /**
   * `from` (a note, or a folder) is now at `to`: its answers, and those of
   * every note under it, move with it — the remount that follows watches the
   * new path, and should not flash the strip before its form.
   */
  renamed(from: string, to: string): void
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
        // Released (or renamed away) meanwhile: an answer nobody watches is not kept.
        if (asked.get(path) === run && watchers.has(path)) answers[path] = answer
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
      // Not answered: at once. Answered (another pane watches it, or a
      // rename carried it here): that answer stands, and the next coalesced
      // run refreshes it. Untracked: a pane calls this from an effect, which
      // must depend on its note's path alone — not on the answer it is about
      // to receive (the release drops it, so that would ask forever) nor on
      // the file list a run reads.
      untrack(() => {
        if (path in answers) invalidate()
        else run([path])
      })
      return () => {
        const left = (watchers.get(path) ?? 1) - 1
        if (left > 0) {
          watchers.set(path, left)
          return
        }
        watchers.delete(path)
        asked.delete(path)
        delete answers[path]
      }
    },
    invalidate,
    renamed(from, to) {
      for (const path of Object.keys(answers)) {
        const next = path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null
        if (next === null) continue
        answers[next] = answers[path]
        delete answers[path]
        asked.delete(path)
      }
    },
  }
}
