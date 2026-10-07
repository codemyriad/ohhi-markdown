/**
 * What the shell can honestly say about sharing for a path (chrome-shaping
 * Fork 2, shape C): which mount it is in, whose it is, where it syncs, who is
 * online there — and the header rollup scoped to what actually has a relay.
 * Pure, so the copy the rail shows is provable without a browser.
 */
import { pillStatus, worstStatus, type PillStatus, type SyncRecordSnapshot } from './pill-status.js'
import { sameRelay } from '@ohhi/workspace'
import type { MountUiStatus } from './workspace.svelte.js'

/**
 * The shell's one mount shape — `tree-model.ts` re-exports THIS type rather
 * than keeping its own narrower copy, so the tree menu and the rail can never
 * be handed different facts about the same folder. `MountInfo` satisfies it.
 */
export interface MountLike {
  path: string
  room: string
  provenance: 'local' | 'carved' | 'joined' | 'adopted'
  link: string | null
  /** Absent ⇒ 'active' (N1: 'needs-token' | 'adopting' | 'absorbing'). */
  status?: MountUiStatus
  /** Absent ⇒ not foreign. See `isForeignMount` (device-link N2). */
  foreign?: boolean
}

/**
 * Whose share this is, for the copy and the provenance tint.
 *
 * 'adopted' is a share that arrived through the parent room. With depth-1
 * nesting the parent is always the vault's own root mount, so an adopted
 * mount is EITHER a folder you carved on another of your devices (yours) OR a
 * foreign share you joined there (theirs) — the gap N1 recorded here. The
 * discriminator is `foreign`, computed once by `isForeignMount` and carried
 * on MountInfo.
 */
export type MountTone = 'yours' | 'theirs'

export function mountTone(
  provenance: MountLike['provenance'] | 'root',
  foreign = false
): MountTone {
  if (foreign) return 'theirs'
  return provenance === 'carved' || provenance === 'adopted' || provenance === 'root'
    ? 'yours'
    : 'theirs'
}

/** Two relay URLs naming the same relay — the ONE copy lives in libs/workspace (`resolve-relay.ts`). */
export { sameRelay }

/**
 * Is this mount SOMEONE ELSE'S share, rather than a folder of this vault?
 *
 * The rule, kept as simple as it can be while staying honest (device-link N2,
 * spike S10 Q7):
 *
 * - `joined` — this device pasted a link someone gave it. Foreign, always.
 * - `carved` — this device carved it out of this vault. Ours, always.
 * - `adopted` — it arrived as a `kind:'mount'` entry in the root map, and the
 *   entry carries the relay its room lives on. A room carved out of THIS
 *   vault is minted on this vault's relay (`doCarve`), and a share someone
 *   else made lives on theirs (`joinMount` announces the foreign relay
 *   deliberately, S10 Q7) — so the relay is the discriminator.
 * - `local` — not shared at all.
 *
 * The honest limit, stated rather than hidden: a foreign share that happens
 * to live on the SAME relay as this vault reads as yours. The exact answer is
 * the relay's ancestry edge (A4-A, `rooms(child,parent)`), which the client
 * cannot query today; when it can, this function is the one place to change.
 */
export function isForeignMount(
  m: { provenance: MountLike['provenance']; relay?: string },
  rootRelay: string
): boolean {
  if (m.provenance === 'joined') return true
  if (m.provenance !== 'adopted') return false
  return !!m.relay && !sameRelay(m.relay, rootRelay)
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

/**
 * The header rollup, fed only by docs that have a relay to be in sync WITH:
 * every doc in a LINKED vault, else the docs (and folder docs) under the
 * carved/joined/adopted mounts. `null` means nothing is shared — the header
 * says so in words rather than showing a pill for an absence.
 *
 * A mount with no relay yet (`needs-token`, `adopting`, `absorbing`) is
 * excluded whole — its docs AND its folder doc — even in a linked vault:
 * those records never connect, and letting them drag the rollup to offline
 * would report a missing key as a broken relay (spike S10 Q2, golden rule 4).
 */
export function scopedRollup(
  files: { path: string; kind: string; guid: string }[],
  records: Record<string, SyncRecordSnapshot>,
  mounts: MountLike[],
  rootLinked: boolean
): PillStatus | null {
  const shared = mounts.filter((m) => m.path !== '' && mountHasRelay(m))
  const quiet = mounts.filter((m) => m.path !== '' && !mountHasRelay(m))
  if (!rootLinked && shared.length === 0) return null
  const statuses: PillStatus[] = []
  for (const [key, rec] of Object.entries(records)) {
    if (key.startsWith('//folder:')) {
      const room = key.slice('//folder:'.length)
      if (quiet.some((m) => m.room === room)) continue
      if (rootLinked || shared.some((m) => m.room === room)) statuses.push(pillStatus(rec))
    }
  }
  for (const f of files) {
    if (f.kind !== 'text') continue
    if (quiet.some((m) => f.path === m.path || f.path.startsWith(`${m.path}/`))) continue
    const inShared = rootLinked || shared.some((m) => f.path.startsWith(`${m.path}/`))
    if (!inShared) continue
    const rec = records[f.guid]
    if (rec) statuses.push(pillStatus(rec))
  }
  return worstStatus(statuses)
}
