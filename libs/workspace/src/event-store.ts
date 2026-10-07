/**
 * The per-room, persisted event log (sharing E3, spike S22 Q4; foundations
 * Stage 4c): `<room>/events.json` in the vault's StoreDir, beside the room's
 * doc blobs and LCA records — device-local, because it records what arrived
 * at THIS device and who it came from at the moment it arrived (awareness is
 * ephemeral, so attribution cannot be derived later from anything that
 * survives a reload).
 *
 * Droppable by construction (golden rule 8): a missing, unparsable or
 * version-mismatched file reads as an empty log, `rebuild()` is "clear", and
 * nothing reads it to decide a write. Losing it costs the Changes feed's
 * history and nothing else. One writer path (`append`), debounced on the
 * injected scheduler (golden rule 5 — no ambient timers), flushed on
 * shutdown.
 *
 * Bounded three ways, oldest dropped first: `EVENT_LOG_CAP` events,
 * `EVENT_LOG_MAX_BYTES` serialized, `EVENT_LOG_MAX_AGE_MS` old (age is pruned
 * on load and on every append). The whole-file rewrite is therefore bounded
 * too — the journal's 1,029-rewrite lesson (`file-journal.ts`) is why the
 * write is debounced rather than per event.
 */
import type { Clock, StoreIo } from '@ohhi/vault'
import {
  EVENT_KINDS,
  EVENT_LOG_CAP,
  EventLog,
  type AppEvent,
  type EventInput,
  type EventKind,
} from './events.js'

export const EVENTS_SCHEMA_VERSION = 1
/** S22 Q4: 256 KB per room, serialized. */
export const EVENT_LOG_MAX_BYTES = 256 * 1024
/** S22 Q4: 30 days. */
export const EVENT_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60_000
/** S22 Q4: writes coalesce for 5 s on the injected scheduler. */
export const EVENT_WRITE_DEBOUNCE_MS = 5_000

/** The file's shape. Anything else reads as empty. */
export interface EventsFile {
  schemaVersion: typeof EVENTS_SCHEMA_VERSION
  events: AppEvent[]
}

export interface RoomEventLogOptions {
  clock: Clock
  room: string
  /** `<room>/events.json`. Absent → in memory only (tests, a headless peer). */
  io?: StoreIo
  cap?: number
  maxBytes?: number
  maxAgeMs?: number
  debounceMs?: number
  docChangeWindowMs?: number
}

const KINDS = new Set<string>(EVENT_KINDS)
const enc = new TextEncoder()
const dec = new TextDecoder()

/** Shape check for one stored event: enough that a reader can never crash on it. */
function isEvent(v: unknown): v is AppEvent {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    typeof e.id === 'string' &&
    typeof e.at === 'number' &&
    Number.isFinite(e.at) &&
    typeof e.kind === 'string' &&
    KINDS.has(e.kind as EventKind) &&
    (e.level === 'error' || e.level === 'warn' || e.level === 'info') &&
    !!e.scope &&
    typeof e.scope === 'object' &&
    !!e.actor &&
    typeof e.actor === 'object' &&
    typeof (e.actor as { kind?: unknown }).kind === 'string' &&
    typeof e.count === 'number' &&
    !!e.payload &&
    typeof e.payload === 'object'
  )
}

/**
 * Parse a stored file. Missing, corrupt, or another schema version → `[]`
 * (droppable: the feed starts over, nothing else notices). Individual
 * malformed rows are skipped rather than failing the file.
 */
export function parseEventsFile(bytes: Uint8Array | null): AppEvent[] {
  if (!bytes) return []
  try {
    const raw = JSON.parse(dec.decode(bytes)) as Partial<EventsFile> | null
    if (!raw || raw.schemaVersion !== EVENTS_SCHEMA_VERSION || !Array.isArray(raw.events)) return []
    return raw.events.filter(isEvent)
  } catch {
    return []
  }
}

/**
 * Drop oldest-first until the serialized file fits `maxBytes`. Sizes are
 * measured per event once, so the trim is linear, not a re-serialize loop.
 */
function fitBytes(oldestFirst: AppEvent[], maxBytes: number): AppEvent[] {
  const envelope = enc.encode(JSON.stringify({ schemaVersion: EVENTS_SCHEMA_VERSION, events: [] })).length
  const sizes = oldestFirst.map((e) => enc.encode(JSON.stringify(e)).length + 1) // + the comma
  let total = envelope + sizes.reduce((a, b) => a + b, 0)
  let start = 0
  while (start < oldestFirst.length && total > maxBytes) total -= sizes[start++]!
  return start === 0 ? oldestFirst : oldestFirst.slice(start)
}

/**
 * A room's `EventLog`, kept on disk. Reads go to the in-memory ring; the file
 * is written at most once per debounce window, and on `flush()`.
 */
export class RoomEventLog {
  readonly room: string
  private readonly clock: Clock
  private readonly io: StoreIo | null
  private readonly log: EventLog
  private readonly maxBytes: number
  private readonly maxAgeMs: number
  private readonly debounceMs: number
  private cancelWrite: (() => void) | null = null
  private dirty = false
  private writing: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(opts: RoomEventLogOptions) {
    this.room = opts.room
    this.clock = opts.clock
    this.io = opts.io ?? null
    this.maxBytes = opts.maxBytes ?? EVENT_LOG_MAX_BYTES
    this.maxAgeMs = opts.maxAgeMs ?? EVENT_LOG_MAX_AGE_MS
    this.debounceMs = opts.debounceMs ?? EVENT_WRITE_DEBOUNCE_MS
    this.log = new EventLog({
      clock: opts.clock,
      room: opts.room,
      cap: opts.cap ?? EVENT_LOG_CAP,
      ...(opts.docChangeWindowMs !== undefined ? { docChangeWindowMs: opts.docChangeWindowMs } : {}),
    })
  }

  /**
   * Read the stored log (once, on mount open). Never throws: a read failure
   * is a lost feed, not a broken mount. Anything appended before the load
   * finished is kept, after the stored history.
   */
  async load(): Promise<void> {
    if (!this.io) return
    let stored: AppEvent[] = []
    try {
      stored = parseEventsFile(await this.io.read())
    } catch {
      stored = []
    }
    const live = this.log.oldestFirst()
    const liveIds = new Set(live.map((e) => e.id))
    this.log.restore([...stored.filter((e) => !liveIds.has(e.id)), ...live])
    if (this.pruneAge() || this.fitBytes()) this.markDirty()
  }

  /** Record one event (stamped on the injected clock), prune, schedule the write. */
  append<K extends EventKind>(input: EventInput<K>): AppEvent<K> {
    const event = this.log.append(input)
    this.pruneAge()
    this.markDirty()
    return event
  }

  /** Newest first. */
  events(): AppEvent[] {
    return this.log.events()
  }

  get size(): number {
    return this.log.size
  }

  /** Drop the history (rule 8's rebuild: an empty log). Written at once. */
  async rebuild(): Promise<void> {
    this.log.clear()
    this.dirty = true
    await this.flush()
  }

  /** Write now if anything changed since the last write. */
  async flush(): Promise<void> {
    this.cancelWrite?.()
    this.cancelWrite = null
    // Serialize writes: a flush that lands while a debounced write is still
    // running must not race it to the rename.
    this.writing = this.writing.then(() => this.write())
    await this.writing
  }

  /** Stop the debounce timer (teardown); call `flush()` first to keep the tail. */
  dispose(): void {
    this.disposed = true
    this.cancelWrite?.()
    this.cancelWrite = null
  }

  /**
   * Drop events older than the age cap; returns whether anything went. Cheap
   * on the hot path: the ring is in `at` order, so only a stale OLDEST event
   * costs a pass.
   */
  private pruneAge(): boolean {
    const all = this.log.oldestFirst()
    const minAt = this.clock.now() - this.maxAgeMs
    if (all.length === 0 || all[0]!.at >= minAt) return false
    this.log.restore(all.filter((e) => e.at >= minAt))
    return true
  }

  /**
   * Enforce the byte cap. Measured at load and at write time, not per
   * append: a peer typing fires an append per keystroke, and sizing 500
   * events on each would cost more than the edit.
   */
  private fitBytes(): boolean {
    const all = this.log.oldestFirst()
    const fitted = fitBytes(all, this.maxBytes)
    if (fitted.length === all.length) return false
    this.log.restore(fitted)
    return true
  }

  private markDirty(): void {
    this.dirty = true
    if (!this.io || this.disposed || this.cancelWrite) return
    this.cancelWrite = this.clock.schedule(() => {
      this.cancelWrite = null
      this.writing = this.writing.then(() => this.write())
    }, this.debounceMs)
  }

  private async write(): Promise<void> {
    if (!this.io || !this.dirty) return
    this.dirty = false
    this.pruneAge()
    this.fitBytes()
    const file: EventsFile = { schemaVersion: EVENTS_SCHEMA_VERSION, events: this.log.oldestFirst() }
    try {
      await this.io.writeAtomic(enc.encode(JSON.stringify(file)))
    } catch {
      // Droppable (rule 8): a failed write costs feed history, never data, and
      // must never surface as a sync error. The next append retries.
      this.dirty = true
    }
  }
}
