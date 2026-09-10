/**
 * What the shell can honestly say about sharing for a path (chrome-shaping
 * Fork 2, shape C): which mount it is in, whose it is, where it syncs, who is
 * online there — and the header rollup scoped to what actually has a relay.
 * Pure, so the copy the rail shows is provable without a browser.
 */
import { pillStatus, worstStatus, type PillStatus, type SyncRecordSnapshot } from './pill-status.js'
import type { MountUiStatus } from './workspace.svelte.js'

export interface MountLike {
  path: string
  room: string
  provenance: 'local' | 'carved' | 'joined' | 'adopted'
  link: string | null
  /** Absent ⇒ 'active' (N1: 'needs-token' | 'adopting' | 'absorbing'). */
  status?: MountUiStatus
}

/**
 * Whose share this is, for the copy and the provenance tint. 'adopted' is a
 * share that arrived through the parent room — with depth-1 nesting the
 * parent is always the vault's own root mount, so it is a folder shared from
 * one of *your* devices and reads like a carve.
 *
 * GAP (device-link N1): a foreign share joined on device A also arrives on
 * device B as `provenance:'adopted'` (spike S10 Q7), and today's contract
 * carries nothing that tells the two apart — no `foreign` flag on MountInfo,
 * no root-mount provenance in `WorkspaceUi`. When N2 lands `ui.linked` (or
 * MountInfo grows the flag), thread it in here and 'theirs' follows.
 */
export type MountTone = 'yours' | 'theirs'

export function mountTone(provenance: MountLike['provenance'] | 'root'): MountTone {
  return provenance === 'carved' || provenance === 'adopted' || provenance === 'root'
    ? 'yours'
    : 'theirs'
}

/**
 * Does this mount have a relay to be in sync WITH? Only an ACTIVE one does: a
 * `needs-token` mount is a fully functional LOCAL mount that knows where its
 * room lives, and an `adopting`/`absorbing` mount is mid-machine. Their
 * records are `{connected:false}` forever, which is not "offline" — offline
 * promises reconnection (spike S10 Q2, golden rule 4).
 */
export function mountHasRelay(m: { provenance: MountLike['provenance']; status?: MountUiStatus }): boolean {
  return m.provenance !== 'local' && (m.status ?? 'active') === 'active'
}

/** Mount roots whose records must not feed any pill or rollup. */
export function quietMountRoots(mounts: MountLike[]): string[] {
  return mounts.filter((m) => m.path !== '' && !mountHasRelay(m)).map((m) => m.path)
}

/** Is `path` inside a mount that has no relay yet (so: no pill, ever)? */
export function inQuietMount(path: string, mounts: MountLike[]): boolean {
  return quietMountRoots(mounts).some((root) => path === root || path.startsWith(`${root}/`))
}

export type ShareState =
  | { kind: 'local' }
  | {
      kind: 'shared'
      /** 'root' = the whole vault is shared (legacy joins / the memory contract). */
      provenance: 'carved' | 'joined' | 'adopted' | 'root'
      room: string
      /** The mount root ('' for a root share). */
      mountPath: string
      link: string | null
      /** The mount's lifecycle state; a root share is always 'active'. */
      status: MountUiStatus
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
    return {
      kind: 'shared',
      provenance: mount.provenance,
      room: mount.room,
      mountPath: mount.path,
      link: mount.link,
      status: mount.status ?? 'active',
    }
  }
  if (rootShared) {
    return { kind: 'shared', provenance: 'root', room: rootRoom, mountPath: '', link: rootLink, status: 'active' }
  }
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
 * carved/joined/adopted mounts. `null` means nothing is shared — the header
 * says so in words rather than showing a pill for an absence.
 *
 * A mount with no relay yet (`needs-token`, `adopting`, `absorbing`) is
 * excluded whole — its docs AND its folder doc — even in a root-shared vault:
 * those records never connect, and letting them drag the rollup to offline
 * would report a missing key as a broken relay (spike S10 Q2, golden rule 4).
 */
export function scopedRollup(
  files: { path: string; kind: string; guid: string }[],
  records: Record<string, SyncRecordSnapshot>,
  mounts: MountLike[],
  rootShared: boolean
): PillStatus | null {
  const shared = mounts.filter((m) => m.path !== '' && mountHasRelay(m))
  const quiet = mounts.filter((m) => m.path !== '' && !mountHasRelay(m))
  if (!rootShared && shared.length === 0) return null
  const statuses: PillStatus[] = []
  for (const [key, rec] of Object.entries(records)) {
    if (key.startsWith('//folder:')) {
      const room = key.slice('//folder:'.length)
      if (quiet.some((m) => m.room === room)) continue
      if (rootShared || shared.some((m) => m.room === room)) statuses.push(pillStatus(rec))
    }
  }
  for (const f of files) {
    if (f.kind !== 'text') continue
    if (quiet.some((m) => f.path === m.path || f.path.startsWith(`${m.path}/`))) continue
    const inShared = rootShared || shared.some((m) => f.path.startsWith(`${m.path}/`))
    if (!inShared) continue
    const rec = records[f.guid]
    if (rec) statuses.push(pillStatus(rec))
  }
  return worstStatus(statuses)
}
