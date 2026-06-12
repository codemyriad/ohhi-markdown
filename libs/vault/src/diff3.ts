/**
 * Three-way merge regions for the divergence review UI.
 * Wraps node-diff3 so UI packages don't need their own diff dependency.
 */
import { diff3Merge } from 'node-diff3'
import type { DivergenceReview } from './types.js'

export type MergeHunk =
  | { kind: 'ok'; lines: string[] }
  | { kind: 'conflict'; mine: string[]; base: string[]; theirs: string[] }

export function computeMergeHunks(review: DivergenceReview): MergeHunk[] {
  const regions = diff3Merge(
    review.mine.split('\n'),
    review.base.split('\n'),
    review.theirs.split('\n'),
    { excludeFalseConflicts: true }
  )
  return regions.map((r) =>
    'ok' in r && r.ok
      ? { kind: 'ok' as const, lines: r.ok }
      : {
          kind: 'conflict' as const,
          mine: r.conflict?.a ?? [],
          base: r.conflict?.o ?? [],
          theirs: r.conflict?.b ?? [],
        }
  )
}

/** Auto-merge when diff3 finds no real conflicts; null when review is needed. */
export function tryCleanMerge(review: DivergenceReview): string | null {
  const hunks = computeMergeHunks(review)
  if (hunks.some((h) => h.kind === 'conflict')) return null
  return hunks.flatMap((h) => (h.kind === 'ok' ? h.lines : [])).join('\n')
}
