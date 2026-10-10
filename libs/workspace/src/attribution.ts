/**
 * Who sent a remote update (sharing Fork 2-A, spike S22 Q2) — decided AT
 * ARRIVAL, because the only map from an engine client id to a person is the
 * doc's awareness, and awareness is ephemeral: once the peer leaves, the name
 * is gone and nothing that survives a reload can recover it.
 *
 * Rules, in order:
 *  1. Every inserting client id is THIS replica's own → `me` (an echo of our
 *     own ops, e.g. a relay re-sync).
 *  2. Every remaining id announces the SAME name in the doc's awareness →
 *     `peer` with that name (and color). Names are self-declared, never ids:
 *     two devices of one person show one name, and that is the honest claim.
 *  3. The update is DELETE-ONLY (no inserting ids: a delete set names the
 *     deleted text's author, never the deleter — every Backspace a peer
 *     presses arrives like this) → the person who has the note OPEN (`here`
 *     in its awareness): the only one there, or, with several, the one whose
 *     edit to this note was attributed last (`recent`) if they are still
 *     there. This was the "someone" in the drawer (foundations-plan P6): each
 *     Backspace fell to rule 4, folded into a "via <relay>" line of its own,
 *     and that line sat on top of the peer's.
 *  4. Otherwise — the peer has left, the edit was made offline and arrived
 *     late, several peers' ops arrived merged, or a delete with nobody (or
 *     several, none of them `recent`) in the note → `relay`, named by the
 *     relay host: "via <relay>" is ordinary copy, never an error.
 *
 * Never `agent` HERE: this decides who sent a REMOTE update, and an outside
 * agent's write reaches the app as a disk ingest — telling it from Obsidian
 * or git needs the CLI's own journal to correlate (`plans/spike-one-log.md`
 * › "Flagged for after" › Agent attribution; TODO(spike S22)). The one
 * honest `agent` source is the in-app agent: its transactions carry an
 * `AgentOrigin` the app set itself, and `MountSession.noteDocChange` names
 * them without coming through here (writing-harness B7, spike S14). A peer's
 * copy of that same edit arrives as theirs, by these rules.
 */
import type { Actor } from './events.js'

/** An awareness state as providers set it (`providers.ts`: `user: {name, color}`). */
interface PeerState {
  user?: { name?: unknown; color?: unknown }
  /** The doc is open in one of their views (`MountSession.syncHere`). */
  here?: unknown
}

export interface AttributionInput {
  /** The update's inserting client ids (`SyncEngine.clientIdsOf`). */
  clientIds: readonly number[]
  /** This replica's client id on the doc (`SyncEngine.clientIdOf`). */
  self: number | null
  /** The doc's awareness states at arrival (clientID → state); null without a provider. */
  states: ReadonlyMap<number, unknown> | null
  /** The relay's host, for the fallback (`relayHost(url)`); absent when none is known. */
  relayHost?: string
  /**
   * The newest actor this note's changes were attributed to within the fold
   * window (`DOC_CHANGE_WINDOW_MS`), for rule 3's tie-break; absent when none.
   */
  recent?: Actor | null
}

/** `wss://relay.example:443/x` → `relay.example:443`; anything unparsable → the input. */
export function relayHost(url: string | null | undefined): string | undefined {
  if (!url) return undefined
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

/** The actor an arriving update is attributed to. Pure. */
export function attributeUpdate(input: AttributionInput): Actor {
  const others = input.clientIds.filter((id) => id !== input.self)
  if (input.clientIds.length > 0 && others.length === 0) return { kind: 'me' }
  const relay: Actor = { kind: 'relay', ...(input.relayHost ? { name: input.relayHost } : {}) }
  if (!input.states) return relay
  if (input.clientIds.length === 0) return deleter(input.states, input.self, input.recent) ?? relay
  if (others.length === 0) return relay
  let found: { name: string; color?: string } | null = null
  for (const id of others) {
    const user = (input.states.get(id) as PeerState | undefined)?.user
    const name = typeof user?.name === 'string' && user.name ? user.name : null
    if (!name) return relay
    if (found && found.name !== name) return relay
    found ??= { name, ...(typeof user?.color === 'string' ? { color: user.color } : {}) }
  }
  return found ? { kind: 'peer', ...found } : relay
}

/** A state's announced user, when it names one. */
function userOf(state: unknown): { name: string; color?: string } | null {
  const user = (state as PeerState | undefined)?.user
  if (typeof user?.name !== 'string' || !user.name) return null
  return { name: user.name, ...(typeof user.color === 'string' ? { color: user.color } : {}) }
}

/**
 * Rule 3: who deleted, for a delete-only update — the one person (by name)
 * with the note open, else `recent` if they are among those who have it
 * open, else nobody (null → the relay).
 */
function deleter(
  states: ReadonlyMap<number, unknown>,
  self: number | null,
  recent: Actor | null | undefined
): Actor | null {
  const here = new Map<string, { name: string; color?: string }>()
  for (const [id, state] of states) {
    if (id === self || (state as PeerState | undefined)?.here !== true) continue
    const user = userOf(state)
    if (user && !here.has(user.name)) here.set(user.name, user)
  }
  if (here.size === 1) return { kind: 'peer', ...[...here.values()][0]! }
  if (recent?.kind === 'peer' && recent.name && here.has(recent.name)) return { kind: 'peer', ...here.get(recent.name)! }
  return null
}
