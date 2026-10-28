/**
 * Notices over the one event log (spike S22, Stage 4a; chrome-shaping Fork 4
 * shape C before it). What the app tells a person comes in two kinds:
 *
 * - **Logged**: `workspace.notify({ level, code, params?, path?, room? })`
 *   appends a `notice` event to `ui.events` — a code and its params, never
 *   words. The words are chosen at render time (`event-text.ts`). Errors and
 *   warnings toast once; info never toasts. All of it stays readable in the
 *   Log view (and the errors and warnings in the drawer) after the toast has gone.
 * - **Flashed**: `workspace.flash({ level, text })` — feedback to a gesture the
 *   person just made, in the place they made it (a refused drop, a copy
 *   confirmation). It toasts and is not logged.
 *
 * Pure list operations; the workspace owns the reactive copies. What a person
 * cleared from the drawer is the one piece of state kept here (below).
 */
import { CHANGE_KINDS, type AppEvent, type EventLevel, type EventParam } from '@ohhi/workspace'
import { writable } from 'svelte/store'
import type { NoticeCode } from './event-text.js'

export type NoticeLevel = EventLevel

/** What `workspace.notify` takes: a code the app words at render time. */
export interface NoticeInput {
  level: NoticeLevel
  code: NoticeCode
  params?: Record<string, EventParam>
  /** The note or folder it concerns, when there is one. */
  path?: string
  /** The shared folder's room, when the call site has it in hand. */
  room?: string
  /** The mount root it concerns ('' for the vault root). */
  mount?: string
}

/** Transient gesture feedback: toasted, never logged. Text is already worded. */
export interface FlashInput {
  level: NoticeLevel
  text: string
  path?: string
}

export interface Flash extends FlashInput {
  id: string
}

/** Flashes kept in the queue the toast effect reads; they are not a history. */
export const FLASH_LIMIT = 20

let flashCounter = 0

/** Newest first, capped. Every flash is a new entry: a repeated gesture flashes again. */
export function appendFlash(list: Flash[], input: FlashInput): Flash[] {
  return [{ id: `f${++flashCounter}`, ...input }, ...list].slice(0, FLASH_LIMIT)
}

/**
 * A change someone else made (Stage 4c): a `CHANGE_KINDS` event not by me.
 * The ONE predicate behind the drawer's badge and its list (duplication
 * review #9), so the count and the rows it opens cannot disagree.
 */
export function isForeignChange(e: Pick<AppEvent, 'kind' | 'actor'>): boolean {
  return CHANGE_KINDS.has(e.kind) && e.actor.kind !== 'me'
}

// --- clearing the drawer -----------------------------------------------------

/**
 * What a person cleared from the notification drawer, per vault, on this
 * device: everything up to `at` (*Clear all*), one event up to the `at` it
 * had when dismissed (`events`, by id — a folded repeat keeps its id and
 * moves its `at`, so a warning that happens again comes back), and one note's
 * changes by others up to a time (`notes`, by path). Clearing hides a row
 * from the drawer only: the log is history and keeps every event, so the
 * Log view still lists it.
 */
export interface ClearedNotices {
  at: number
  events: Record<string, number>
  notes: Record<string, number>
}

export const NOTHING_CLEARED: ClearedNotices = { at: 0, events: {}, notes: {} }

/** Dismissals kept per kind; the oldest go first (a *Clear all* drops them all). */
export const CLEARED_LIMIT = 200

/** Has this event been cleared from the drawer? */
export function isCleared(e: Pick<AppEvent, 'id' | 'at' | 'kind' | 'actor' | 'scope'>, c: ClearedNotices): boolean {
  if (e.at <= c.at) return true
  const one = c.events[e.id]
  if (one !== undefined && e.at <= one) return true
  const path = e.scope.path
  if (path && isForeignChange(e)) {
    const note = c.notes[path]
    if (note !== undefined && e.at <= note) return true
  }
  return false
}

/** The events the drawer may still show. */
export function unclearedEvents<E extends Pick<AppEvent, 'id' | 'at' | 'kind' | 'actor' | 'scope'>>(
  events: readonly E[],
  c: ClearedNotices
): E[] {
  return events.filter((e) => !isCleared(e, c))
}

/**
 * *Clear all*: everything logged so far. The mark is the newest event's own
 * time, not the clock's — a peer's event can carry a time ahead of this
 * device's, and it is cleared too.
 */
export function clearAll(events: readonly Pick<AppEvent, 'at'>[], c: ClearedNotices): ClearedNotices {
  const at = events.reduce((max, e) => Math.max(max, e.at), c.at)
  return { at, events: {}, notes: {} }
}

const capped = (map: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(map)
  return entries.length <= CLEARED_LIMIT ? map : Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, CLEARED_LIMIT))
}

/** Dismiss one error or warning, as it stands now. */
export function dismissEvent(e: Pick<AppEvent, 'id' | 'at'>, c: ClearedNotices): ClearedNotices {
  return { ...c, events: capped({ ...c.events, [e.id]: Math.max(c.events[e.id] ?? -Infinity, e.at) }) }
}

/** Dismiss one note's changes by others, up to `at` (the group's newest). */
export function dismissNote(path: string, at: number, c: ClearedNotices): ClearedNotices {
  return { ...c, notes: capped({ ...c.notes, [path]: Math.max(c.notes[path] ?? -Infinity, at) }) }
}

/**
 * The device's record, per vault room, in localStorage beside the rest of
 * the shell's state (`recent.ts` keeps its own key the same way) — losing it
 * costs a drawer that shows its rows again, never an event.
 */
const CLEARED_KEY = 'editor:notices-cleared'

function readCleared(): Record<string, ClearedNotices> {
  try {
    const raw = globalThis.localStorage?.getItem(CLEARED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, ClearedNotices> = {}
    for (const [room, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<ClearedNotices> | null
      if (!v || typeof v.at !== 'number') continue
      out[room] = {
        at: v.at,
        events: v.events && typeof v.events === 'object' ? v.events : {},
        notes: v.notes && typeof v.notes === 'object' ? v.notes : {},
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeCleared(all: Record<string, ClearedNotices>): void {
  try {
    globalThis.localStorage?.setItem(CLEARED_KEY, JSON.stringify(all))
  } catch {
    // Private mode / disabled storage: a cleared drawer fills again on reload.
  }
}

/** Every vault's record; the drawer subscribes to it. */
export const clearedNotices = writable<Record<string, ClearedNotices>>(readCleared())

/** One vault's record. */
export function clearedFor(all: Record<string, ClearedNotices>, room: string): ClearedNotices {
  return all[room] ?? NOTHING_CLEARED
}

/** Change one vault's record and keep it. */
export function updateCleared(room: string, change: (c: ClearedNotices) => ClearedNotices): void {
  clearedNotices.update((all) => {
    const next = { ...all, [room]: change(clearedFor(all, room)) }
    writeCleared(next)
    return next
  })
}

/** *Clear all* in one vault — the drawer's button and the `app.clear-notifications` command. */
export function clearNotices(room: string, events: readonly Pick<AppEvent, 'at'>[]): void {
  updateCleared(room, (c) => clearAll(events, c))
}
