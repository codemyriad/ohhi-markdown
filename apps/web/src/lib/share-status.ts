/**
 * What the shell can honestly say about sharing for a path (chrome-shaping
 * Fork 2, shape C): which mount it is in, whose it is, where it syncs, who is
 * online there — and the header rollup scoped to what actually has a relay.
 * Pure, so the copy the rail shows is provable without a browser.
 */
import { pillStatus, worstStatus, type PillStatus, type SyncRecordSnapshot } from './pill-status.js'

export interface MountLike {
  path: string
  room: string
  provenance: 'local' | 'carved' | 'joined'
  link: string | null
}

export type ShareState =
  | { kind: 'local' }
  | {
      kind: 'shared'
      /** 'root' = the whole vault is shared (legacy joins / the memory contract). */
      provenance: 'carved' | 'joined' | 'root'
      room: string
      /** The mount root ('' for a root share). */
      mountPath: string
      link: string | null
    }

/** The share state of `path` ('' = the vault itself). */
export function shareStateFor(
  path: string,
  mounts: MountLike[],
  rootShared: boolean,
  rootRoom: string,
  rootLink: string | null = null
): ShareState {
  const mount = mounts.find(
    (m) => m.path !== '' && (path === m.path || path.startsWith(`${m.path}/`))
  )
  if (mount && mount.provenance !== 'local') {
    return { kind: 'shared', provenance: mount.provenance, room: mount.room, mountPath: mount.path, link: mount.link }
  }
  if (rootShared) return { kind: 'shared', provenance: 'root', room: rootRoom, mountPath: '', link: rootLink }
  return { kind: 'local' }
}

/** Hostname of a relay URL, for copy like "Shared by you · relay.example.com". */
export function relayHost(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Names online in one room (the local user included — they are online there too). */
export function onlineIn(presenceByRoom: Record<string, string[]>, room: string): string[] {
  return presenceByRoom[room] ?? []
}

/**
 * The header rollup, fed only by docs that have a relay to be in sync WITH:
 * every doc in a root-shared vault, else the docs (and folder docs) under the
 * carved/joined mounts. `null` means nothing is shared — the header says so
 * in words rather than showing a pill for an absence.
 */
export function scopedRollup(
  files: { path: string; kind: string; guid: string }[],
  records: Record<string, SyncRecordSnapshot>,
  mounts: MountLike[],
  rootShared: boolean
): PillStatus | null {
  const shared = mounts.filter((m) => m.path !== '' && m.provenance !== 'local')
  if (!rootShared && shared.length === 0) return null
  const statuses: PillStatus[] = []
  for (const [key, rec] of Object.entries(records)) {
    if (key.startsWith('//folder:')) {
      const room = key.slice('//folder:'.length)
      if (rootShared || shared.some((m) => m.room === room)) statuses.push(pillStatus(rec))
    }
  }
  for (const f of files) {
    if (f.kind !== 'text') continue
    const inShared = rootShared || shared.some((m) => f.path.startsWith(`${m.path}/`))
    if (!inShared) continue
    const rec = records[f.guid]
    if (rec) statuses.push(pillStatus(rec))
  }
  return worstStatus(statuses)
}
