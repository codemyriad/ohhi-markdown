/**
 * The Shared view's feed (sharing-shaping E2): everything the pure
 * `sharedSnapshot` needs that the workspace does not already hold as one
 * value — where each room's relay is, and each room's last green span —
 * plus the input builder that hands it the rest.
 *
 * The span is a tracker, not a record field: a sync record says whether a
 * doc is green NOW (golden rule 4), never since when. So the feed watches
 * each room's rollup and stamps the injected clock on every transition into
 * green (`since`) and out of it (`until`). Green is what `pillStatus` says it
 * is — the relay has RECEIVED every edit (receipt, not a durable ack) and
 * disk matches — so the card words it "in sync with the relay", never
 * "durable". Built once by the shell, so the span survives the view being
 * closed and opened again.
 */
import { untrack } from 'svelte'
import type { TranslationFunctions } from '@ohhi/i18n'
import type { Clock } from '@ohhi/vault'
import { relayHost, type InSyncSpan, type SharedSnapshotInput, type RelayTokenInput, type SharedPerson } from '@ohhi/workspace'
import { pillStatus, worstStatus, type PillStatus } from './pill-status.js'
import { mountHasRelay, mountTone, type MountLike } from './share-status.js'
import type { Workspace } from './workspace.svelte.js'

const under = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`)

/**
 * One room's rollup over its folder record and its docs (`null` = no relay to
 * be in sync with). The root room owns every doc outside a folder mount.
 */
export function roomRollup(
  ws: Pick<Workspace, 'room'> & { ui: Pick<Workspace['ui'], 'files' | 'records' | 'mounts' | 'linked'> },
  room: string
): PillStatus | null {
  const { files, records, mounts, linked } = ws.ui
  const mount = mounts.find((m) => m.room === room && m.path !== '')
  if (room === ws.room ? !linked : !mount || !mountHasRelay(mount as MountLike)) return null
  const statuses: PillStatus[] = []
  const folder = records[`//folder:${room}`]
  if (folder) statuses.push(pillStatus(folder))
  const roots = mounts.filter((m) => m.path !== '').map((m) => m.path)
  for (const f of files) {
    if (f.kind !== 'text') continue
    const mine = mount ? under(f.path, mount.path) : !roots.some((r) => under(f.path, r))
    if (!mine) continue
    const rec = records[f.guid]
    if (rec) statuses.push(pillStatus(rec))
  }
  return worstStatus(statuses)
}

export interface SharedFeed {
  /** Per room: its rollup's last green span on the injected clock. */
  readonly inSyncByRoom: Record<string, InSyncSpan>
}

/**
 * The in-sync tracker. `$effect`-driven, so call it during component init
 * (App.svelte does). A new workspace starts a fresh map.
 */
export function createSharedFeed(host: { workspace(): Workspace | null; clock: Clock }): SharedFeed {
  let inSyncByRoom = $state<Record<string, InSyncSpan>>({})
  let was: Record<string, PillStatus | null> = {}
  let seen: Workspace | null = null
  $effect(() => {
    const ws = host.workspace()
    if (ws !== seen) {
      seen = ws
      was = {}
      untrack(() => (inSyncByRoom = {}))
    }
    if (!ws) return
    const rooms = [ws.room, ...ws.ui.mounts.filter((m) => m.path !== '').map((m) => m.room)]
    const next: Record<string, PillStatus | null> = {}
    let stamped: Record<string, InSyncSpan> | null = null
    for (const room of rooms) {
      const status = roomRollup(ws, room)
      next[room] = status
      const green = status === 'green'
      const wasGreen = was[room] === 'green'
      if (green === wasGreen) continue
      stamped ??= untrack(() => ({ ...inSyncByRoom }))
      if (green) stamped[room] = { since: host.clock.now() }
      else if (stamped[room]) stamped[room] = { ...stamped[room], until: host.clock.now() }
    }
    was = next
    if (stamped) inSyncByRoom = stamped
  })
  return {
    get inSyncByRoom() {
      return inSyncByRoom
    },
  }
}

/** Everything `sharedSnapshot` reads, from the workspace plus what the view fetched. */
export function snapshotInput(
  ws: Workspace,
  extra: {
    tokensByRoom?: Record<string, RelayTokenInput[]>
    inSyncByRoom?: Record<string, InSyncSpan>
    presenceByPath?: Record<string, readonly SharedPerson[]>
  }
): SharedSnapshotInput {
  return {
    rootRoom: ws.room,
    rootLinked: ws.ui.linked,
    rootRelay: ws.ui.linked ? ws.rootRelayUrl() : null,
    self: ws.user.name,
    mounts: ws.ui.mounts.map((m) => ({
      path: m.path,
      room: m.room,
      provenance: m.provenance,
      status: m.status,
      foreign: m.foreign,
      relay: m.relay,
    })),
    files: ws.ui.files,
    records: ws.ui.records,
    presenceByRoom: ws.ui.presenceByRoom,
    ...(extra.presenceByPath ? { presenceByPath: extra.presenceByPath } : {}),
    ...(extra.tokensByRoom ? { tokensByRoom: extra.tokensByRoom } : {}),
    events: ws.ui.events,
    sessionStartedAt: ws.startedAt,
    ...(extra.inSyncByRoom ? { inSyncByRoom: extra.inSyncByRoom } : {}),
  }
}

/**
 * The folder a crumb names, as far as sharing goes (sharing E6): the line the
 * breadcrumb's popover shows — "Shared by you · relay.ohhi.md", "On your
 * devices · …", or local.
 */
export function folderShareFacts(
  dir: string,
  mounts: readonly { path: string; provenance: MountLike['provenance']; foreign: boolean; relay: string; status: MountLike['status'] }[],
  rootLinked: boolean,
  rootRelay: string | null
): { kind: 'local' } | { kind: 'shared'; tone: 'yours' | 'theirs' | 'devices'; host: string; status: string } {
  const m = mounts.find((mo) => mo.path !== '' && mo.provenance !== 'local' && under(dir, mo.path))
  if (m) {
    return { kind: 'shared', tone: mountTone(m.provenance, m.foreign), host: relayHost(m.relay) ?? '', status: m.status ?? 'active' }
  }
  if (rootLinked) return { kind: 'shared', tone: 'devices', host: relayHost(rootRelay) ?? '', status: 'active' }
  return { kind: 'local' }
}

/**
 * What the door says beside the pill (sharing Fork 3-A): the shared folders
 * and the other people online, when there are any — `''` when alone with
 * nothing shared, so the quiet shell stays quiet (R6).
 */
export function doorExtra(
  ui: { mounts: readonly { path: string; provenance: string }[]; presenceByRoom: Record<string, readonly string[]> },
  self: string,
  LL: TranslationFunctions
): string {
  const rooms = ui.mounts.filter((m) => m.path !== '' && m.provenance !== 'local').length
  const people = new Set(Object.values(ui.presenceByRoom).flat())
  people.delete(self)
  const parts: string[] = []
  if (rooms) parts.push(LL.web.shared.door.rooms({ count: rooms }))
  if (people.size) parts.push(LL.web.shared.door.people({ count: people.size }))
  return parts.join(' · ')
}
