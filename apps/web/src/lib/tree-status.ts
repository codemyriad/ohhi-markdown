/**
 * What the tree shows about sync, per row (chrome-shaping Fork 3, shape B):
 * quiet when good, loud when not. Pure, so the policy is provable without a
 * browser — the pill itself stays `f(record)` (golden rule 4); this decides
 * only WHICH rows get one and what a mount root's rollup is.
 */
import { pillStatus, worstStatus, type PillStatus, type SyncRecordSnapshot } from './pill-status.js'

/** Is `path` inside a relay-attached mount (a carved/joined subtree, or a root-shared vault)? */
export function inRelayMount(path: string, mountPaths: string[], rootShared: boolean): boolean {
  if (rootShared) return true
  return mountPaths.some((root) => root !== '' && (path === root || path.startsWith(`${root}/`)))
}

/**
 * The pill a file row shows, or null for none.
 *
 * In a shared folder: everything but green — the folder's rollup already
 * vouches for green rows, and a yellow/red/offline row is louder for being
 * alone. Outside one: only red. A local file's record never connects, so
 * its "offline" is not a state, it is the absence of a relay; but a
 * divergence is real wherever it happens and must stay findable.
 */
export function rowStatus(status: PillStatus, inRelay: boolean): PillStatus | null {
  if (inRelay) return status === 'green' ? null : status
  return status === 'red' ? 'red' : null
}

/**
 * A mount root's rollup: worst of its docs AND its folder doc. The folder doc
 * is what keeps an empty shared folder honest — with no files there is still
 * a live (or dead) connection to report.
 */
export function mountRollup(
  files: { path: string; kind: string; guid: string }[],
  records: Record<string, SyncRecordSnapshot>,
  mountPath: string,
  room: string
): PillStatus {
  const statuses: PillStatus[] = []
  const folder = records[`//folder:${room}`]
  if (folder) statuses.push(pillStatus(folder))
  for (const f of files) {
    if (f.kind !== 'text') continue
    if (mountPath !== '' && !(f.path.startsWith(`${mountPath}/`))) continue
    const rec = records[f.guid]
    if (rec) statuses.push(pillStatus(rec))
  }
  return worstStatus(statuses)
}
