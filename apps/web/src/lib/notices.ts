/**
 * The session notice log (chrome-shaping Fork 4, shape C): every error and
 * warning the workspace raises, kept for the session so it can be read after
 * the toast is gone. Pure list operations; the shim owns the reactive copy.
 */

export type NoticeLevel = 'error' | 'warn' | 'info'

export interface Notice {
  id: string
  /** Epoch ms. */
  at: number
  level: NoticeLevel
  text: string
  /** The note or folder it concerns, when there is one. */
  path?: string
}

export interface NoticeInput {
  level: NoticeLevel
  text: string
  path?: string
}

/** Kept per session; older entries fall off the end. */
export const NOTICE_LIMIT = 200

let counter = 0

/** Newest first; a repeat of the newest notice bumps its time rather than stacking. */
export function appendNotice(list: Notice[], input: NoticeInput, now: number): Notice[] {
  const head = list[0]
  if (head && head.level === input.level && head.text === input.text && head.path === input.path) {
    return [{ ...head, at: now }, ...list.slice(1)]
  }
  const notice: Notice = { id: `n${++counter}-${now}`, at: now, ...input }
  return [notice, ...list].slice(0, NOTICE_LIMIT)
}

/** Notices newer than the moment the log was last looked at. */
export function unreadCount(list: Notice[], seenAt: number): number {
  let n = 0
  for (const notice of list) {
    if (notice.at > seenAt) n++
    else break // newest first, so the rest are older
  }
  return n
}

export function formatTime(at: number): string {
  const d = new Date(at)
  const two = (x: number): string => String(x).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
}
