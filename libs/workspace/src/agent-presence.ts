/**
 * The agent as a peer in a shared note (writing-harness-shaping B10): while a
 * run works on an enrolled, relay-attached doc, the doc's awareness carries a
 * SECOND state beside the person's own —
 *
 *   { user: { name: '<name> (agent)', color }, type: 'agent', status,
 *     here: true, working: [{ anchor, head }], cursor: { anchor, head } | null }
 *
 * — so every peer's editor draws the agent's caret and name tag through
 * y-codemirror.next exactly as it draws a person's, the presence stack lists
 * it in a presence slot, and the editor's working highlight
 * (`@ohhi/editor`'s `working-highlight.ts`) shades the ranges it is on.
 *
 * How one device publishes two states. y-protocols keys awareness by client
 * id and a provider's `Awareness` has ONE local state (its doc's client id).
 * But the wire format is per client id, and the provider forwards every
 * awareness `update` it sees, whatever its origin (HocuspocusProvider
 * `awarenessUpdateHandler`; the relay tracks the ids each connection
 * announced and drops them when it closes). So the agent gets its own client
 * id — a scratch `Awareness` over a scratch Y.Doc, whose local state IS the
 * agent's — and each publish is that scratch state encoded and applied to
 * the doc's real awareness (`applyAwarenessUpdate`, origin
 * `AGENT_AWARENESS_ORIGIN`). To the doc's awareness the agent is one more
 * peer; to every other device, likewise. Public API only, no reach into
 * `awareness.states`.
 *
 * Because the agent's state is "remote" to the awareness that holds it,
 * y-protocols times it out after 30 s without an update — locally and on
 * every peer. A state that should stand is therefore re-published every
 * `AGENT_PRESENCE_RENEW_MS` (15 s, the interval y-protocols renews a local
 * state at).
 *
 * Rate (research `harness-in-doc-editing.md` §3): `set` calls are coalesced —
 * the first publishes at once, the rest at most every
 * `AGENT_PRESENCE_COALESCE_MS` (300 ms) with the newest state winning. `null`
 * clears at once. Every timer is the injected clock (golden rule 5).
 *
 * `working` ranges arrive as character offsets and are pinned with
 * `encodeRange` (anchors.ts) at the moment of the `set` call, so a range
 * follows every edit made between the call and the moment a peer draws it.
 */
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import type { EngineDoc } from '@ohhi/sync'
import type { Clock } from '@ohhi/vault'
import { encodeRange, ytextOf, type RelativePositionJSON } from './anchors.js'

/** Mirrors `@ohhi/harness`'s `AgentPresenceState` (libs/harness/src/types.ts) — workspace cannot depend on the harness. */
export interface AgentPresenceState {
  name: string
  status: 'thinking' | 'composing' | 'idle'
  path?: string
  working?: { from: number; to: number }[]
}

/** The seam `AgentHost.presence` names: one setter, `null` = gone. */
export interface AgentPresenceSink {
  set(state: AgentPresenceState | null): void
}

/** A range as relative positions: what y-codemirror.next calls a cursor. */
export interface AwarenessRange {
  anchor: RelativePositionJSON
  head: RelativePositionJSON
}

/** The agent's state on the wire. */
export interface AgentAwarenessState {
  user: { name: string; color: string }
  type: 'agent'
  status: AgentPresenceState['status']
  here: true
  working: AwarenessRange[]
  cursor: AwarenessRange | null
}

/** How the agent is named and coloured (the shell passes its i18n label and presence colour). */
export interface AgentPresenceStyle {
  label(name: string): string
  color(label: string): string
}

export const AGENT_PRESENCE_COALESCE_MS = 300
export const AGENT_PRESENCE_RENEW_MS = 15_000
/** The origin every agent-awareness update is applied with. */
export const AGENT_AWARENESS_ORIGIN = 'agent-presence'

export const DEFAULT_AGENT_STYLE: AgentPresenceStyle = {
  label: (name) => `${name} (agent)`,
  color: () => '#888888',
}

/** Is this awareness state an agent's (`type: 'agent'`)? */
export function isAgentAwareness(state: unknown): state is AgentAwarenessState {
  return !!state && typeof state === 'object' && (state as { type?: unknown }).type === 'agent'
}

/** The agent's presence on ONE doc's awareness. Owned by the `MountSession` holding the doc's connection. */
export class DocAgentPresence implements AgentPresenceSink {
  private readonly scratchDoc = new Y.Doc()
  private readonly scratch = new Awareness(this.scratchDoc)
  private pending: AgentAwarenessState | null = null
  private current: AgentAwarenessState | null = null
  private lastPublish = Number.NEGATIVE_INFINITY
  private cancelFlush: (() => void) | null = null
  private cancelRenew: (() => void) | null = null
  private disposed = false

  constructor(
    readonly awareness: Awareness,
    private readonly doc: Y.Doc | EngineDoc,
    private readonly clock: Clock,
    public style: AgentPresenceStyle = DEFAULT_AGENT_STYLE
  ) {
    // The scratch's own state starts as `{}`; nothing is published until `set`.
    this.scratch.setLocalState(null)
  }

  /** The agent's client id on this doc's awareness. */
  get clientId(): number {
    return this.scratch.clientID
  }

  /** The state peers currently see, or null. */
  get published(): AgentAwarenessState | null {
    return this.current
  }

  set(state: AgentPresenceState | null): void {
    if (this.disposed) return
    if (state === null) {
      this.cancelFlush?.()
      this.cancelFlush = null
      this.pending = null
      if (this.current) this.publish(null)
      return
    }
    this.pending = this.toWire(state)
    if (this.cancelFlush) return // a flush is due; it takes the newest
    const wait = this.lastPublish + AGENT_PRESENCE_COALESCE_MS - this.clock.now()
    if (wait <= 0) {
      this.flush()
      return
    }
    this.cancelFlush = this.clock.schedule(() => {
      this.cancelFlush = null
      this.flush()
    }, wait)
  }

  /** Clear the state (peers see the agent leave) and stop every timer. */
  dispose(): void {
    if (this.disposed) return
    this.set(null)
    this.disposed = true
    this.cancelRenew?.()
    this.cancelRenew = null
    this.scratch.destroy()
    this.scratchDoc.destroy()
  }

  private flush(): void {
    const next = this.pending
    this.pending = null
    if (next) this.publish(next)
  }

  private publish(state: AgentAwarenessState | null): void {
    this.scratch.setLocalState(state)
    this.current = state
    this.lastPublish = this.clock.now()
    try {
      const update = encodeAwarenessUpdate(this.scratch, [this.scratch.clientID])
      applyAwarenessUpdate(this.awareness, update, AGENT_AWARENESS_ORIGIN)
    } catch {
      // A destroyed awareness (its provider is gone) has no one to tell.
    }
    this.cancelRenew?.()
    this.cancelRenew = null
    if (state) {
      this.cancelRenew = this.clock.schedule(() => {
        this.cancelRenew = null
        if (this.current && !this.disposed) this.publish(this.current)
      }, AGENT_PRESENCE_RENEW_MS)
    }
  }

  private toWire(state: AgentPresenceState): AgentAwarenessState {
    const label = this.style.label(state.name)
    const ytext = ytextOf(this.doc)
    const working = (state.working ?? []).map(({ from, to }) => {
      const [anchor, head] = encodeRange(ytext, Math.min(from, to), Math.max(from, to))
      return { anchor, head }
    })
    // The caret sits at the end of the newest range — a name tag where the
    // agent is, the range itself drawn by the working highlight.
    const last = working.at(-1)
    return {
      user: { name: label, color: this.style.color(label) },
      type: 'agent',
      status: state.status,
      here: true,
      working,
      cursor: last ? { anchor: last.head, head: last.head } : null,
    }
  }
}

/**
 * A run's presence across notes: `state.path` (else the note it was last on,
 * else `fallbackPath`) picks the doc; moving to another note clears the
 * previous one first. `lookup` answers null for a note with no awareness (not
 * shared, not open) — the agent is then simply not shown there.
 */
export function routeAgentPresence(
  lookup: (path: string) => AgentPresenceSink | null,
  fallbackPath?: string
): AgentPresenceSink {
  let current: { path: string; sink: AgentPresenceSink } | null = null
  return {
    set(state) {
      if (state === null) {
        current?.sink.set(null)
        current = null
        return
      }
      const path = state.path ?? current?.path ?? fallbackPath
      if (!path) return
      if (!current || current.path !== path) {
        current?.sink.set(null)
        const sink = lookup(path)
        current = sink ? { path, sink } : null
      }
      current?.sink.set(state)
    },
  }
}
