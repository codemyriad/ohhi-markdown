/**
 * Presence in place (sharing E1, Fork 4-A): who is in which note, as the
 * tree, the tabs, the readouts and the people stack draw it. Pure, over
 * `ui.presenceByPath`, so the cap, the order and "nothing when alone" (R6)
 * are proven without a DOM.
 *
 * Honesty (R5): a peer is the NAME their client announces — self-reported,
 * never verified — and a colour SLOT in the presence band
 * (`--ed-presence-N`), never a hex and never a sync colour.
 */
import * as Y from 'yjs'
import type { DocPeer } from '@ohhi/workspace'
import { colorSlot } from './params.js'

/** One peer in one note. `color` is a presence slot, 1..8 — `var(--ed-presence-${color})`. */
export interface Peer {
  name: string
  color: number
  clientId: number
}

/** Everyone in a note, by vault path. A path with nobody in it is absent, never `[]`. */
export type PresenceByPath = Readonly<Record<string, readonly Peer[]>>

/** How many initials a stack shows before it says "+N". */
export const STACK_CAP = 3

/** A slot for a name: the same one their caret is drawn in (`colorFor`). */
export function slotFor(name: string): number {
  return colorSlot(name) + 1
}

/**
 * A name (and, where it travelled, its slot) from a snapshot → a `Peer` for
 * `PresenceStack`. The slot is the one the caret was drawn in when the
 * snapshot carried it, else `slotFor(name)` — the same function that drew it.
 */
export function asPeer(p: { name: string; color?: string | number }): Peer {
  const slot = Number(p.color)
  return { name: p.name, color: Number.isInteger(slot) && slot >= 1 ? slot : slotFor(p.name), clientId: 0 }
}

/** The session's report → peers, ordered by name then client id (stable on screen). */
export function peersOf(docPeers: readonly DocPeer[]): Peer[] {
  return docPeers
    .map((p) => ({ name: p.name, color: slotFor(p.name), clientId: p.clientId }))
    .sort(byName)
}

function byName(a: Peer, b: Peer): number {
  return a.name.localeCompare(b.name) || a.clientId - b.clientId
}

/** guid-keyed reports + the tree's rows → `{ path: Peer[] }`, dropping empty notes and unknown guids. */
export function byPath(
  byGuid: ReadonlyMap<string, readonly DocPeer[]>,
  files: readonly { path: string; guid: string }[]
): Record<string, Peer[]> {
  const out: Record<string, Peer[]> = {}
  if (byGuid.size === 0) return out
  for (const f of files) {
    const peers = byGuid.get(f.guid)
    if (peers && peers.length > 0) out[f.path] = peersOf(peers)
  }
  return out
}

/** Who is in one note; `[]` when nobody (or no path). */
export function presenceFor(presence: PresenceByPath, path: string | null | undefined): readonly Peer[] {
  return (path && presence[path]) || []
}

/**
 * One person per NAME, first client wins: the same person on a laptop and a
 * phone is one initial, not two (names are all the system has — R5).
 */
export function uniquePeers(peers: Iterable<Peer>): Peer[] {
  const seen = new Map<string, Peer>()
  for (const p of peers) if (!seen.has(p.name)) seen.set(p.name, p)
  return [...seen.values()].sort(byName)
}

export interface Stack {
  /** At most `STACK_CAP`, ordered by name. */
  shown: Peer[]
  /** How many more there are ("+N"); 0 for none. */
  more: number
  /** Everyone, for the label. */
  all: Peer[]
}

/** Cap a list of people at three + a count. */
export function capped(peers: Iterable<Peer>, cap = STACK_CAP): Stack {
  const all = uniquePeers(peers)
  return { shown: all.slice(0, cap), more: Math.max(0, all.length - cap), all }
}

/** Is `path` inside the mount at `mountPath` ('' = the whole vault)? */
function inMount(path: string, mountPath: string): boolean {
  return mountPath === '' || path.startsWith(`${mountPath}/`)
}

/** A mount root's stack: unique people across every note under it, capped. */
export function stackFor(presence: PresenceByPath, mount: { path: string }): Stack {
  const peers: Peer[] = []
  for (const [path, list] of Object.entries(presence)) if (inMount(path, mount.path)) peers.push(...list)
  return capped(peers)
}

/** Everyone in any note, capped — the toolbar's people stack. */
export function everyone(presence: PresenceByPath): Stack {
  return capped(Object.values(presence).flat())
}

/**
 * Initials for a self-reported name: the first letter of the first two
 * words ("Cynthia Lee" → "CL"), else the first letter ("sam" → "S"). Letters
 * by code point, so an emoji or an accent is never split in half.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = (w: string): string => Array.from(w)[0] ?? ''
  const letters = words.length > 1 ? first(words[0]!) + first(words[words.length - 1]!) : first(words[0]!)
  return letters.toLocaleUpperCase()
}

export interface PersonWhere {
  peer: Peer
  path: string
}

export interface RoomPeople {
  /** The mount's room ('' for the vault root). */
  room: string
  /** The mount's path ('' for the vault root). */
  mountPath: string
  people: PersonWhere[]
}

/**
 * The popover's list: who is here, grouped by shared folder (the deepest
 * mount containing the note), each person with the note they are in. A
 * person in two notes is listed twice — they really are in both views.
 */
export function peopleByRoom(
  presence: PresenceByPath,
  mounts: readonly { path: string; room: string }[],
  rootRoom: string
): RoomPeople[] {
  const deepestFirst = [...mounts].filter((m) => m.path !== '').sort((a, b) => b.path.length - a.path.length)
  const groups = new Map<string, RoomPeople>()
  for (const path of Object.keys(presence).sort()) {
    const mount = deepestFirst.find((m) => inMount(path, m.path))
    const key = mount ? mount.room : rootRoom
    let group = groups.get(key)
    if (!group) {
      group = { room: key, mountPath: mount ? mount.path : '', people: [] }
      groups.set(key, group)
    }
    for (const peer of presence[path]!) group.people.push({ peer, path })
  }
  for (const g of groups.values()) g.people.sort((a, b) => byName(a.peer, b.peer) || a.path.localeCompare(b.path))
  return [...groups.values()].sort((a, b) => a.mountPath.localeCompare(b.mountPath))
}

/** The note's name as a person reads it: last segment, no `.md`. */
export function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

/** The text key every note's Y.Text lives under (`yjs-engine.ts`, `binding.ts`). */
const TEXT_KEY = 'content'

/**
 * A peer's caret as a character offset in `ydoc`, from their awareness
 * `cursor` (a Yjs relative position, JSON) — resolved at the moment of the
 * jump, so edits since they moved are accounted for. Null when they have no
 * caret (their view is not focused) or it does not resolve.
 */
export function caretOffset(
  states: ReadonlyMap<number, Record<string, unknown>> | null | undefined,
  ydoc: Y.Doc,
  clientId: number
): number | null {
  const cursor = states?.get(clientId)?.cursor as { head?: unknown } | null | undefined
  if (!cursor || cursor.head == null) return null
  try {
    const rel = Y.createRelativePositionFromJSON(cursor.head)
    const abs = Y.createAbsolutePositionFromRelativePosition(rel, ydoc)
    if (!abs || abs.type !== ydoc.getText(TEXT_KEY)) return null
    return abs.index
  } catch {
    return null
  }
}

/** "with …" as data: the words are chosen at render time (`presence.with_*`). */
export type WithNames =
  | { kind: 'one'; a: string }
  | { kind: 'two'; a: string; b: string }
  | { kind: 'many'; a: string; count: number }

/** Who you are with in a note, by unique name; null when nobody (R6). */
export function withNames(peers: readonly Peer[]): WithNames | null {
  const names = uniquePeers(peers).map((p) => p.name)
  if (names.length === 0) return null
  if (names.length === 1) return { kind: 'one', a: names[0]! }
  if (names.length === 2) return { kind: 'two', a: names[0]!, b: names[1]! }
  return { kind: 'many', a: names[0]!, count: names.length - 1 }
}

/**
 * The people online in the rooms you are in (`ui.presenceByRoom`, the folder
 * awareness — which counts you too), one per name, you excluded: the sync
 * icon's avatars (foundations-plan P5). `[]` when alone (R6).
 */
export function onlinePeers(byRoom: Readonly<Record<string, readonly string[]>>, self: string): Peer[] {
  const names = new Set(Object.values(byRoom).flat())
  names.delete(self)
  return [...names].map((name) => asPeer({ name })).sort(byName)
}

/** One person in the sync popover: the note they are in, or `null` — online in the room, in no note. */
export interface PersonWhereMaybe {
  peer: Peer
  path: string | null
}

export interface RoomWhere {
  room: string
  mountPath: string
  people: PersonWhereMaybe[]
}

/**
 * Who is editing where (P5's hover list): `peopleByRoom` — everyone in a
 * note, grouped by the deepest shared folder holding it — plus, per room,
 * whoever is online there but in no note, after them. You are never listed.
 */
export function whoIsWhere(
  presence: PresenceByPath,
  byRoom: Readonly<Record<string, readonly string[]>>,
  mounts: readonly { path: string; room: string }[],
  rootRoom: string,
  self: string
): RoomWhere[] {
  const groups: RoomWhere[] = peopleByRoom(presence, mounts, rootRoom).map((g) => ({ ...g, people: [...g.people] }))
  const mountPathOf = (room: string): string | null =>
    room === rootRoom ? '' : (mounts.find((m) => m.room === room && m.path !== '')?.path ?? null)
  for (const room of Object.keys(byRoom).sort()) {
    const mountPath = mountPathOf(room)
    if (mountPath === null) continue
    let group = groups.find((g) => g.room === room)
    const editing = new Set(group?.people.map((p) => p.peer.name) ?? [])
    const idle = uniquePeers((byRoom[room] ?? []).filter((n) => n !== self && !editing.has(n)).map((name) => asPeer({ name })))
    if (idle.length === 0) continue
    if (!group) {
      group = { room, mountPath, people: [] }
      groups.push(group)
    }
    for (const peer of idle) group.people.push({ peer, path: null })
  }
  return groups.sort((a, b) => a.mountPath.localeCompare(b.mountPath))
}
