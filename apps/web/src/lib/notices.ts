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
 * Pure list operations; the workspace owns the reactive copies.
 */
import { CHANGE_KINDS, type AppEvent, type EventLevel, type EventParam } from '@ohhi/workspace'
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
