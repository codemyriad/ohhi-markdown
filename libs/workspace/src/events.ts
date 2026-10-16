/**
 * One event log (spike S22, `spike-one-log` Q3): the vocabulary the
 * Log view, the drawer, the Shared view's Changes feed and the devtools
 * Timeline all read, as filters over one stream.
 *
 * Host-neutral on purpose — the web shell and a headless peer share it. An
 * event carries a **code + params, never rendered text**: the words are
 * produced at render time by the host's i18n (`describeEvent` in apps/web),
 * so a log written in one locale reads in another and nothing here bakes
 * English in.
 *
 * `EventLog` is a pure, capped ring stamped from an injected `Clock` (golden
 * rule 5). The app's own log is in memory only; each mount's per-room log is
 * persisted by `RoomEventLog` (`event-store.ts`, sharing E3 / Stage 4c),
 * droppable by construction (golden rule 8) — losing it costs history, never
 * data.
 */
import type { Clock, DivergenceReview, MountStatus } from '@ohhi/vault'
import type { AdoptNoticeKind } from './adopt.js'

export type EventLevel = 'error' | 'warn' | 'info'

/**
 * Who caused it, as honestly as the app can say. `disk` is Obsidian, git or
 * an OUTSIDE agent (the `ohhi` CLI, Claude Code) — indistinguishable at the
 * reconciler without the CLI's journal to correlate (later). `agent` is the
 * one honest source of that kind today: the IN-APP agent, whose transactions
 * the app makes itself under an `AgentOrigin` (`agent-origin.ts`), named by
 * the run (the skill, or "Agent"). Names are self-declared (awareness, or
 * the run), never ids.
 */
export type ActorKind = 'me' | 'peer' | 'relay' | 'disk' | 'agent' | 'app'
export interface Actor {
  kind: ActorKind
  name?: string
  color?: string
}

/** What the event concerns. All optional: an app-wide complaint has none. */
export interface EventScope {
  room?: string
  /** The mount root (workspace-relative) the event concerns; '' is the vault root. */
  mount?: string
  path?: string
}

/** A param value: plain data only, so an event serializes and renders anywhere. */
export type EventParam = string | number

export interface EventPayloads {
  /**
   * Coalesced remote/disk edits to one doc: one event per note per actor per
   * window (`DOC_CHANGE_WINDOW_MS`), `count` = updates folded in. `added` /
   * `removed` are characters inserted / items deleted, summed across the
   * fold — a display hint, absent when the writer could not count cheaply.
   */
  'doc.changed': { guid: string; added?: number; removed?: number }
  'file.created': Record<string, never>
  'file.deleted': Record<string, never>
  'file.moved': { from: string }
  'peer.joined': Record<string, never>
  'peer.left': Record<string, never>
  /**
   * One room's relay connection, edge-triggered (the pill stays the truth —
   * golden rule 4; this is the history). `reconnecting` = a connection was
   * lost and the provider is retrying; `offline` = no connection for
   * `RELAY_OFFLINE_MS` (or never, since boot); `refused` carries the relay's
   * reason.
   */
  'relay.state': { to: 'connected' | 'reconnecting' | 'offline' | 'refused'; reason?: string }
  'mount.changed': { what: AdoptNoticeKind | 'status'; from?: MountStatus; to?: MountStatus }
  'review.opened': { guid: string; reason: DivergenceReview['reason'] }
  'breaker.held': { count: number }
  /** The app's own complaints: a code the host maps to words, plus its arguments. */
  notice: { code: string; params?: Record<string, EventParam> }
}
export type EventKind = keyof EventPayloads

/** Every kind, in a fixed order (a filter UI lists them; a test walks them). */
export const EVENT_KINDS = [
  'doc.changed',
  'file.created',
  'file.deleted',
  'file.moved',
  'peer.joined',
  'peer.left',
  'relay.state',
  'mount.changed',
  'review.opened',
  'breaker.held',
  'notice',
] as const satisfies readonly EventKind[]

export interface AppEvent<K extends EventKind = EventKind> {
  /** `${room ?? 'app'}:${seq}` — seq per log, monotonic. Stable across coalescing. */
  id: string
  /** The injected clock, never the ambient one. A coalesced repeat moves it forward. */
  at: number
  kind: K
  level: EventLevel
  scope: EventScope
  actor: Actor
  /** > 1 when an immediate repeat was folded into this event. */
  count: number
  payload: EventPayloads[K]
}

/** What a writer hands `append`; the log stamps `id`, `at` and `count`. */
export type EventInput<K extends EventKind = EventKind> = {
  [P in K]: {
    kind: P
    level: EventLevel
    scope?: EventScope
    /** Defaults to `app`. */
    actor?: Actor
    payload: EventPayloads[P]
  }
}[K]

/** What the Shared feed and the drawer's "changes" half count. */
export const CHANGE_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'doc.changed',
  'file.created',
  'file.deleted',
  'file.moved',
])

/** S22 Q4: 500 events per log, oldest dropped first. */
export const EVENT_LOG_CAP = 500

/**
 * S22 Q4: `doc.changed` folds same note + same actor within this window —
 * the Changes feed's "one line per note per window" (sharing E3).
 */
export const DOC_CHANGE_WINDOW_MS = 2 * 60_000

export interface EventFilter {
  /** Only these levels (all when absent). */
  levels?: readonly EventLevel[]
  /** Only these kinds (all when absent). */
  kinds?: readonly EventKind[]
  /**
   * Each field given must match. `path` also matches anything under it, so a
   * folder's scope takes in the notes inside it.
   */
  scope?: EventScope
  /** Strictly after this time (the injected clock's epoch). */
  since?: number
}

/** Structural equality over plain data (payload params, scopes, actors). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

function inScope(scope: EventScope, want: EventScope): boolean {
  if (want.room !== undefined && scope.room !== want.room) return false
  if (want.mount !== undefined && scope.mount !== want.mount) return false
  if (want.path !== undefined) {
    const p = scope.path
    if (p === undefined) return false
    if (want.path !== '' && p !== want.path && !p.startsWith(`${want.path}/`)) return false
  }
  return true
}

/** The events that pass `f`, in the order given. Pure. */
export function filterEvents(events: readonly AppEvent[], f: EventFilter = {}): AppEvent[] {
  return events.filter(
    (e) =>
      (!f.levels || f.levels.includes(e.level)) &&
      (!f.kinds || f.kinds.includes(e.kind)) &&
      (!f.scope || inScope(e.scope, f.scope)) &&
      (f.since === undefined || e.at > f.since)
  )
}

/** How many events arrived (or were repeated) after `since`, optionally narrowed. Pure. */
export function countUnread(events: readonly AppEvent[], since: number, f: Omit<EventFilter, 'since'> = {}): number {
  return filterEvents(events, { ...f, since }).length
}

/**
 * Record `event` in a host's per-room map (id → event, kept OLDEST FIRST):
 * a re-report of the same id (a fold, `at` moved to now) moves to the end,
 * and the map is trimmed from the oldest end to `cap` — the session's ring
 * enforces its own cap, and the host's copy must not outgrow it.
 */
export function upsertEvent(byId: Map<string, AppEvent>, event: AppEvent, cap: number = EVENT_LOG_CAP): void {
  byId.delete(event.id)
  byId.set(event.id, event)
  for (const id of byId.keys()) {
    if (byId.size <= cap) break
    byId.delete(id)
  }
}

/**
 * Merge lists that are each OLDEST FIRST into one NEWEST-FIRST array — a
 * k-way merge, linear in the total, so publishing on every arriving event
 * never re-sorts the whole log.
 */
export function mergeNewestFirst(lists: readonly (readonly AppEvent[])[]): AppEvent[] {
  const idx = lists.map((l) => l.length - 1)
  const out: AppEvent[] = []
  for (;;) {
    let best = -1
    for (let k = 0; k < lists.length; k++) {
      const i = idx[k]!
      if (i < 0) continue
      if (best < 0 || lists[k]![i]!.at > lists[best]![idx[best]!]!.at) best = k
    }
    if (best < 0) return out
    out.push(lists[best]![idx[best]!]!)
    idx[best]!--
  }
}

export interface EventLogOptions {
  clock: Clock
  /** The id prefix: a per-room log uses its room; the app's own log, 'app'. */
  room?: string
  cap?: number
  /** `doc.changed` fold window; default `DOC_CHANGE_WINDOW_MS`, 0 disables. */
  docChangeWindowMs?: number
}

/**
 * A capped ring of `AppEvent`s. One writer path (`append`); readers take
 * `events()` (newest first, a fresh array — hand it to a reactive store) and
 * narrow with `filterEvents` / `countUnread`.
 */
export class EventLog {
  private readonly clock: Clock
  private readonly prefix: string
  private readonly cap: number
  private readonly docWindow: number
  /** Oldest first (ascending `at`): the ring's natural order. */
  private ring: AppEvent[] = []
  private seq = 0

  constructor(opts: EventLogOptions) {
    this.clock = opts.clock
    this.prefix = opts.room ?? 'app'
    this.cap = Math.max(1, opts.cap ?? EVENT_LOG_CAP)
    this.docWindow = Math.max(0, opts.docChangeWindowMs ?? DOC_CHANGE_WINDOW_MS)
  }

  /**
   * Replace the contents with previously stored events (a persisted per-room
   * log on load). Sorted oldest first, trimmed to the cap; ids keep counting
   * up from the highest `<prefix>:<seq>` seen, so a new event never reuses a
   * stored id.
   */
  restore(events: readonly AppEvent[]): void {
    const sorted = events.slice().sort((a, b) => a.at - b.at)
    this.ring = sorted.slice(Math.max(0, sorted.length - this.cap))
    for (const e of this.ring) {
      const tail = e.id.startsWith(`${this.prefix}:`) ? Number(e.id.slice(this.prefix.length + 1)) : NaN
      if (Number.isInteger(tail) && tail > this.seq) this.seq = tail
    }
  }

  /** Oldest first, as a fresh array (the persisted order). */
  oldestFirst(): AppEvent[] {
    return this.ring.slice()
  }

  /**
   * `doc.changed` window fold: the newest event for the same note (guid,
   * scope) by the same actor within the window absorbs this one — count up,
   * deltas summed, `at` moved to now — and moves to the head, so the ring
   * stays in `at` order. Older matches are left alone: past the window a
   * note gets a fresh line.
   */
  private foldDocChange(input: EventInput<'doc.changed'>, at: number, scope: EventScope, actor: Actor): AppEvent | null {
    if (this.docWindow <= 0) return null
    for (let i = this.ring.length - 1; i >= 0; i--) {
      const e = this.ring[i]!
      if (e.at < at - this.docWindow) return null
      if (e.kind !== 'doc.changed' || e.level !== input.level) continue
      const p = e.payload as EventPayloads['doc.changed']
      if (p.guid !== input.payload.guid || !same(e.scope, scope) || !same(e.actor, actor)) continue
      const sum = (x?: number, y?: number): number | undefined =>
        x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0)
      const added = sum(p.added, input.payload.added)
      const removed = sum(p.removed, input.payload.removed)
      const folded: AppEvent = {
        ...e,
        at,
        count: e.count + 1,
        payload: {
          guid: p.guid,
          ...(added !== undefined ? { added } : {}),
          ...(removed !== undefined ? { removed } : {}),
        },
      }
      this.ring.splice(i, 1)
      this.ring.push(folded)
      return folded
    }
    return null
  }

  /**
   * Record one event, stamped `clock.now()`. An immediate repeat — the
   * newest event has the same kind, level, scope, actor and payload (for a
   * notice: the same code and params) — is folded into it: `count` goes up,
   * `at` moves to now, the `id` stays. Returns the event as stored.
   */
  append<K extends EventKind>(input: EventInput<K>): AppEvent<K> {
    const at = this.clock.now()
    const scope = input.scope ?? {}
    const actor = input.actor ?? { kind: 'app' }
    if (input.kind === 'doc.changed') {
      const folded = this.foldDocChange(input as EventInput<'doc.changed'>, at, scope, actor)
      if (folded) return folded as AppEvent<K>
    }
    // A windowed `doc.changed` that found nothing to fold into starts a new line.
    const head = input.kind === 'doc.changed' && this.docWindow > 0 ? undefined : this.ring[this.ring.length - 1]
    if (
      head &&
      head.kind === input.kind &&
      head.level === input.level &&
      same(head.scope, scope) &&
      same(head.actor, actor) &&
      same(head.payload, input.payload)
    ) {
      const folded = { ...head, at, count: head.count + 1 }
      this.ring[this.ring.length - 1] = folded
      return folded as AppEvent<K>
    }
    const event = {
      id: `${this.prefix}:${++this.seq}`,
      at,
      kind: input.kind,
      level: input.level,
      scope: { ...scope },
      actor: { ...actor },
      count: 1,
      payload: input.payload,
    } as AppEvent<K>
    this.ring.push(event)
    if (this.ring.length > this.cap) this.ring.splice(0, this.ring.length - this.cap)
    return event
  }

  /** Newest first, as a fresh array. */
  events(): AppEvent[] {
    return this.ring.slice().reverse()
  }

  get size(): number {
    return this.ring.length
  }

  /** Forget everything (the "Clear" action). Ids keep counting up. */
  clear(): void {
    this.ring = []
  }
}

/**
 * The relay refused this mount's token. Raised through `MountEvents.onError`
 * so the host can tell it from any other failure by type, not by matching an
 * English message: it becomes a `relay.state` event with `to: 'refused'` and
 * the relay's `reason`, worded by the host's i18n. The `message` is a
 * developer-facing diagnostic (console, the join promise) — no user reads it
 * from the log.
 */
export class RelayRefusedError extends Error {
  readonly code = 'relay.refused' as const
  readonly reason: string
  constructor(reason: string, message: string) {
    super(message)
    this.name = 'RelayRefusedError'
    this.reason = reason
  }
}
