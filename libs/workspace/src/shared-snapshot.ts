/**
 * The shared world as one plain value (sharing-shaping E2, R0): what the
 * Shared view renders, and what an `ohhi shared` op can wrap later. A pure
 * function over facts the host already holds — the mount table, the sync
 * records, awareness, the relay's token lists and the room logs — so every
 * card is `f(records)` and testable without a browser (golden rule 4).
 *
 * Honesty, per the shaping's Ground-truth table:
 *  - never a sharer's name: a room says "carved" (by you) or "joined" (with
 *    you), nothing more;
 *  - people are self-reported awareness names and the note their caret is
 *    IN — never "writing", never "verified", never "has joined";
 *  - links are links (label, read-only, created), never people;
 *  - the root-linked vault is not a shared folder: it appears only in
 *    `devices` (Chris's 2026-10-03 correction).
 */
import { relayHost } from './attribution.js'
import { CHANGE_KINDS, type AppEvent } from './events.js'
import type { SyncRecordFields } from './types.js'

/** One relay's connection, in words the card can say. */
export type RelayState = 'connected' | 'reconnecting' | 'offline' | 'refused'

export interface SharedPerson {
  name: string
  color?: string
}

export interface SharedSnapshot {
  relays: {
    host: string
    state: RelayState
    /** The relay's own words for a refusal. */
    reason?: string
    /** Rooms this vault holds on it (the linked root counts: it syncs there). */
    rooms: number
    /** Other people online across those rooms. */
    people: number
    /**
     * Every room on this relay is green NOW (golden rule 4: connected,
     * handshake done, nothing pending, disk matches — the relay has RECEIVED
     * every edit; receipt, not a durable ack) and has been since this time:
     * the latest of the rooms' transitions into green. Absent unless all are
     * green and each was seen turning green.
     */
    inSyncSince?: number
    /**
     * Not all green now: the last moment every room was green at once (the
     * earliest exit among the rooms that left, after the latest entry).
     * Absent when no such moment was seen.
     */
    lastInSyncAt?: number
  }[]
  rooms: {
    room: string
    /** The mount root, workspace-relative. */
    path: string
    /** `carved` = shared by you; `joined` = shared with you. Never a person. */
    provenance: 'carved' | 'joined'
    /** 'active' unless the mount is waiting for a key or mid-machine. */
    status: 'active' | 'needs-token' | 'adopting' | 'absorbing'
    host: string | null
    noteCount: number
    /** Carved rooms only, and only when the token list could be read. */
    links?: { label: string | null; readOnly: boolean; created?: string }[]
    /** Others online in the room (the stack), you excluded. */
    peers: SharedPerson[]
    /** The newest change by someone else, from the room's log. */
    lastChangeAt?: number
  }[]
  /** One row per person, one fact: the note they are in (or just the room). */
  people: { name: string; color?: string; room: string; path: string | null }[]
  /** The newest `peer.left` across the rooms: "Cynthia was last here at …". */
  lastSeen?: { name: string; at: number }
  devices: { label: string; thisDevice: boolean; onlineAt?: number }[]
}

export interface SharedMountInput {
  path: string
  room: string
  provenance: 'local' | 'carved' | 'joined' | 'adopted'
  status: 'active' | 'needs-token' | 'adopting' | 'absorbing'
  /** Someone else's share (`isForeignMount`) — decides `adopted`. */
  foreign: boolean
  /** The relay URL the room lives on, when known. */
  relay: string | null
}

export interface RelayTokenInput {
  label: string | null
  readOnly: boolean
  createdAt?: string
  kind?: 'folder' | 'device'
}

export interface SharedSnapshotInput {
  rootRoom: string
  /** The whole vault is on a relay — linked to your own devices. */
  rootLinked: boolean
  rootRelay: string | null
  /** This person's own awareness name: never listed among "people". */
  self: string
  mounts: readonly SharedMountInput[]
  files: readonly { path: string; kind: string }[]
  /** Keyed as the shell keys them: doc guids, and `//folder:<room>` per room. */
  records: Readonly<Record<string, SyncRecordFields>>
  presenceByRoom: Readonly<Record<string, readonly string[]>>
  /** Per note: who has their caret in it (per-document awareness), when the host has it. */
  presenceByPath?: Readonly<Record<string, readonly SharedPerson[]>>
  /** Relay token lists per room, as far as they could be read (operator secret). */
  tokensByRoom?: Readonly<Record<string, readonly RelayTokenInput[]>>
  /** Every room's log, any order. */
  events?: readonly AppEvent[]
  /**
   * When this session started: a `relay.state` logged before it is a previous
   * session's (the room logs survive reloads) and says nothing about now —
   * an old refusal must not be repeated on a fresh boot.
   */
  sessionStartedAt?: number
  /**
   * Per room: its rollup's last green span, from the host's tracker — `since`
   * the transition into green, `until` the transition out (absent while it is
   * still green). A room never seen green has no entry.
   */
  inSyncByRoom?: Readonly<Record<string, InSyncSpan>>
}

/** One room's last green span on the injected clock (`SharedSnapshotInput.inSyncByRoom`). */
export interface InSyncSpan {
  since: number
  until?: number
}

/**
 * A relay's rooms' spans → what its card may claim: `inSyncSince` when every
 * room is green now, else `lastInSyncAt` — the end of the last stretch in
 * which they were ALL green — when one is known. Never the latest of any one
 * room: that would say "in sync" for a relay whose other rooms are not.
 */
export function relayInSync(spans: readonly (InSyncSpan | undefined)[]): { inSyncSince?: number; lastInSyncAt?: number } {
  if (spans.length === 0 || spans.some((s) => s === undefined)) return {}
  const all = spans as readonly InSyncSpan[]
  const start = Math.max(...all.map((s) => s.since))
  const ended = all.filter((s) => s.until !== undefined).map((s) => s.until!)
  if (ended.length === 0) return { inSyncSince: start }
  const end = Math.min(...ended)
  return end >= start ? { lastInSyncAt: end } : {}
}

const folderKey = (room: string): string => `//folder:${room}`

const under = (path: string, root: string): boolean => root === '' || path === root || path.startsWith(`${root}/`)

/** The newest event per room of one kind, by `at`. */
function newestBy(events: readonly AppEvent[], pick: (e: AppEvent) => boolean): Map<string, AppEvent> {
  const out = new Map<string, AppEvent>()
  for (const e of events) {
    const room = e.scope.room
    if (room === undefined || !pick(e)) continue
    const was = out.get(room)
    if (!was || e.at > was.at) out.set(room, e)
  }
  return out
}

/**
 * One room's relay state. The CONNECTION is the folder record's (`f(records)`,
 * the same fact the pills read); the log only adds what records cannot say —
 * a refusal's reason, and whether a down connection has been down long enough
 * to call offline.
 */
function roomState(connected: boolean, last: AppEvent | undefined): { state: RelayState; reason?: string } {
  const p = last?.payload as { to?: RelayState; reason?: string } | undefined
  if (connected) return { state: 'connected' }
  if (p?.to === 'refused') return { state: 'refused', ...(p.reason ? { reason: p.reason } : {}) }
  if (p?.to === 'offline') return { state: 'offline' }
  return { state: 'reconnecting' }
}

const SEVERITY: Record<RelayState, number> = { connected: 0, reconnecting: 1, offline: 2, refused: 3 }

/** The shared world, as a plain value. Pure. */
export function sharedSnapshot(input: SharedSnapshotInput): SharedSnapshot {
  const events = input.events ?? []
  const since = input.sessionStartedAt ?? -Infinity
  const lastRelay = newestBy(events, (e) => e.kind === 'relay.state' && e.at >= since)
  const others = (names: readonly string[] | undefined): string[] =>
    [...new Set(names ?? [])].filter((n) => n !== input.self).sort()

  // ---- rooms: carved and joined mounts only (adopted resolves to one of them) ----
  const folderMounts = input.mounts.filter((m) => m.path !== '' && m.provenance !== 'local')
  const colorOf = new Map<string, string>()
  for (const list of Object.values(input.presenceByPath ?? {})) {
    for (const p of list) if (p.color && !colorOf.has(p.name)) colorOf.set(p.name, p.color)
  }
  const person = (name: string): SharedPerson => {
    const color = colorOf.get(name)
    return color ? { name, color } : { name }
  }
  const rooms: SharedSnapshot['rooms'] = folderMounts.map((m) => {
    const provenance: 'carved' | 'joined' =
      m.provenance === 'carved' || (m.provenance === 'adopted' && !m.foreign) ? 'carved' : 'joined'
    const tokens = input.tokensByRoom?.[m.room]
    const lastChange = events
      .filter((e) => e.scope.room === m.room && CHANGE_KINDS.has(e.kind) && e.actor.kind !== 'me')
      .reduce<number | undefined>((max, e) => (max === undefined || e.at > max ? e.at : max), undefined)
    return {
      room: m.room,
      path: m.path,
      provenance,
      status: m.status,
      host: relayHost(m.relay) ?? null,
      noteCount: input.files.filter((f) => f.kind === 'text' && under(f.path, m.path) && f.path !== m.path).length,
      ...(provenance === 'carved' && tokens
        ? {
            links: tokens
              .filter((t) => t.kind !== 'device')
              .map((t) => ({ label: t.label, readOnly: t.readOnly, ...(t.createdAt ? { created: t.createdAt } : {}) })),
          }
        : {}),
      peers: m.status === 'active' ? others(input.presenceByRoom[m.room]).map(person) : [],
      ...(lastChange !== undefined ? { lastChangeAt: lastChange } : {}),
    }
  })

  // ---- relays: every room with a relay to be in sync with, rolled up by host ----
  const live: { room: string; relay: string | null }[] = []
  if (input.rootLinked) live.push({ room: input.rootRoom, relay: input.rootRelay })
  for (const m of folderMounts) if (m.status === 'active') live.push({ room: m.room, relay: m.relay })
  const byHost = new Map<string, { rooms: string[] }>()
  for (const r of live) {
    const host = relayHost(r.relay) ?? ''
    const entry = byHost.get(host) ?? { rooms: [] }
    entry.rooms.push(r.room)
    byHost.set(host, entry)
  }
  const relays: SharedSnapshot['relays'] = [...byHost.entries()].map(([host, { rooms: ids }]) => {
    let worst: { state: RelayState; reason?: string } = { state: 'connected' }
    for (const room of ids) {
      const s = roomState(input.records[folderKey(room)]?.connected === true, lastRelay.get(room))
      if (SEVERITY[s.state] > SEVERITY[worst.state]) worst = s
    }
    const people = new Set(ids.flatMap((room) => others(input.presenceByRoom[room])))
    return {
      host,
      ...worst,
      rooms: ids.length,
      people: people.size,
      ...relayInSync(ids.map((room) => input.inSyncByRoom?.[room])),
    }
  })

  // ---- people: one fact each — the note their caret is in, else the room ----
  const roomOfPath = (path: string): string => {
    const m = folderMounts
      .filter((mo) => under(path, mo.path))
      .sort((a, b) => b.path.length - a.path.length)[0]
    return m ? m.room : input.rootRoom
  }
  const where = new Map<string, { room: string; path: string | null; color?: string }>()
  for (const [path, list] of Object.entries(input.presenceByPath ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    for (const p of list) {
      if (p.name === input.self || where.has(p.name)) continue
      const color = p.color ?? colorOf.get(p.name)
      where.set(p.name, { room: roomOfPath(path), path, ...(color ? { color } : {}) })
    }
  }
  const liveRooms = new Set(live.map((r) => r.room))
  for (const [room, names] of Object.entries(input.presenceByRoom).sort(([a], [b]) => a.localeCompare(b))) {
    if (!liveRooms.has(room)) continue
    for (const name of others(names)) if (!where.has(name)) where.set(name, { room, path: null, ...person(name) })
  }
  const people: SharedSnapshot['people'] = [...where.entries()]
    .map(([name, w]) => ({ name, ...(w.color ? { color: w.color } : {}), room: w.room, path: w.path }))
    .sort((a, b) => a.name.localeCompare(b.name))

  let lastSeen: SharedSnapshot['lastSeen']
  for (const e of events) {
    if (e.kind !== 'peer.left' || !e.actor.name || e.actor.name === input.self) continue
    if (where.has(e.actor.name)) continue
    if (!lastSeen || e.at > lastSeen.at) lastSeen = { name: e.actor.name, at: e.at }
  }

  // ---- devices: this one, then the device links minted for the root room ----
  const devices: SharedSnapshot['devices'] = [{ label: '', thisDevice: true }]
  for (const t of input.tokensByRoom?.[input.rootRoom] ?? []) {
    if (t.kind === 'device') devices.push({ label: t.label ?? '', thisDevice: false })
  }

  return { relays, rooms, people, ...(lastSeen ? { lastSeen } : {}), devices }
}

/** Nothing shared and nothing linked: the view shows its onboarding instead of cards. */
export function nothingShared(s: SharedSnapshot, rootLinked: boolean): boolean {
  return s.rooms.length === 0 && !rootLinked && s.devices.length <= 1
}
