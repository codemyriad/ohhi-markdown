/**
 * Sessions on disk (writing-harness-shaping B6, Fork 3-A): one
 * `.ohhi/sessions/<id>.jsonl` per session, pi's shape — a header line
 * (`SessionHeader`) then one `SessionEntry` per line, each chained to the one
 * before it by `parentId` (the last entry is the leaf; a branch is a
 * different `parentId`; nothing in the app makes one yet).
 *
 * Pure over the app-file seam (`readAppFile` / `writeAppFile` / `listAppDir`),
 * so it is journaled for free (golden rule 1) and device-local by
 * construction (`.ohhi/` is never enrolled). Sessions are kilobytes, so an
 * append REWRITES the file atomically rather than appending in place: the
 * seam's atomic write is the durable primitive we have, and a half-written
 * line can then only come from someone else's editor — which `load` skips
 * and reports instead of failing.
 *
 * The list is DERIVED (golden rule 8): it scans headers, is cached per
 * session, and the cache is dropped for a session whenever this store writes
 * it or `invalidate` says another writer did.
 *
 * Run status changes are APPENDED, never rewritten: a run's current state is
 * its latest `run` entry for that `runId`. Rename rewrites the header (the
 * one in-place change, of a line only this app writes); archive is a
 * `custom` entry, so it is undoable by hand.
 */
import type { RunRecord, SessionEntry, SessionHeader } from '@ohhi/harness'
import type { Clock } from '@ohhi/vault'
import type { Workspace } from './workspace.svelte.js'

/** The app-file seam the store writes through. */
export type VaultAppFiles = Pick<Workspace, 'readAppFile' | 'writeAppFile' | 'listAppDir'>

export const SESSIONS_DIR = '.ohhi/sessions'

/** A session's file path. Ids are minted here, so they never need escaping. */
export function sessionPath(id: string): string {
  return `${SESSIONS_DIR}/${id}.jsonl`
}

/** What one entry carries before the store stamps it (id, parent, time). */
export type EntryBody = SessionEntry extends infer E
  ? E extends unknown
    ? Omit<E, 'id' | 'parentId' | 'at'>
    : never
  : never

/** One line `load` could not use, and why — reported, never fatal. */
export interface SessionProblem {
  line: number
  reason: 'json' | 'shape'
}

export interface LoadedSession {
  header: SessionHeader
  entries: SessionEntry[]
  /** The last entry's id: where the next append hangs. Null for a new session. */
  leaf: string | null
  problems: SessionProblem[]
}

/** One row of the derived list. */
export interface SessionSummary {
  id: string
  title?: string
  created: number
  /** The newest entry's time, or `created`. */
  lastAt: number
  /** The provider of the latest run, when there was one. */
  provider?: string
  lastRun?: RunRecord
  archived: boolean
}

export interface SessionStore {
  /** Write a new session's header. */
  create(opts?: { id?: string; title?: string }): Promise<SessionHeader>
  /** Append entries after the leaf (one atomic rewrite); returns them stamped. */
  append(id: string, bodies: EntryBody[]): Promise<SessionEntry[]>
  /** Null when there is no such session (or its header is unreadable). */
  load(id: string): Promise<LoadedSession | null>
  /** Every session, newest activity first; archived ones only when asked. */
  list(opts?: { archived?: boolean }): Promise<SessionSummary[]>
  rename(id: string, title: string): Promise<void>
  archive(id: string): Promise<void>
  /** Another writer touched these sessions (or all of them): forget the cache. */
  invalidate(id?: string): void
}

export interface SessionStoreOptions {
  clock: Clock
  /** The vault's id, written into each header (pi's `cwd`). */
  vault: string
  /** Injected for the tests; a time-sortable random id otherwise. */
  newId?: () => string
}

/** A time-sortable id: base-36 milliseconds + 6 random characters. */
export function mintId(now: number): string {
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  return `${now.toString(36)}-${rand}`
}

/** The last `run` entry per runId, in first-seen order. */
export function latestRuns(entries: readonly SessionEntry[]): RunRecord[] {
  const byId = new Map<string, RunRecord>()
  for (const e of entries) if (e.type === 'run') byId.set(e.run.runId, e.run)
  return [...byId.values()]
}

function isHeader(v: unknown): v is SessionHeader {
  const h = v as Partial<SessionHeader> | null
  return !!h && h.type === 'session' && typeof h.id === 'string' && typeof h.created === 'number'
}

function isEntry(v: unknown): v is SessionEntry {
  const e = v as Partial<SessionEntry> | null
  return (
    !!e &&
    typeof e.id === 'string' &&
    (e.parentId === null || typeof e.parentId === 'string') &&
    typeof e.at === 'number' &&
    typeof e.type === 'string'
  )
}

/** Parse a session file. Pure; a bad line is skipped and reported. */
export function parseSession(text: string): LoadedSession | null {
  const lines = text.split('\n')
  let header: SessionHeader | null = null
  const entries: SessionEntry[] = []
  const problems: SessionProblem[] = []
  lines.forEach((raw, i) => {
    const line = raw.trim()
    if (!line) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      problems.push({ line: i + 1, reason: 'json' })
      return
    }
    if (!header) {
      if (isHeader(value)) header = value
      else problems.push({ line: i + 1, reason: 'shape' })
      return
    }
    if (isEntry(value)) entries.push(value)
    else problems.push({ line: i + 1, reason: 'shape' })
  })
  if (!header) return null
  return { header, entries, leaf: entries.at(-1)?.id ?? null, problems }
}

function serialize(header: SessionHeader, entries: readonly SessionEntry[]): string {
  return [header, ...entries].map((v) => JSON.stringify(v)).join('\n') + '\n'
}

function summarize(s: LoadedSession): SessionSummary {
  const runs = latestRuns(s.entries)
  const lastRun = runs.at(-1)
  // The latest `archived` mark wins, so `data: false` un-archives.
  let archived = false
  for (const e of s.entries) if (e.type === 'custom' && e.name === 'archived') archived = e.data !== false
  return {
    id: s.header.id,
    ...(s.header.title ? { title: s.header.title } : {}),
    created: s.header.created,
    lastAt: s.entries.at(-1)?.at ?? s.header.created,
    ...(lastRun ? { provider: lastRun.provider, lastRun } : {}),
    archived,
  }
}

export function createSessionStore(files: VaultAppFiles, opts: SessionStoreOptions): SessionStore {
  const newId = opts.newId ?? (() => mintId(opts.clock.now()))
  /** Parsed sessions, by id — dropped on `invalidate`. */
  const cache = new Map<string, LoadedSession>()
  /** One write at a time per session: appends from a stream must not interleave. */
  const queues = new Map<string, Promise<unknown>>()

  const serial = <T>(id: string, run: () => Promise<T>): Promise<T> => {
    const prev = queues.get(id) ?? Promise.resolve()
    const next = prev.then(run, run)
    queues.set(id, next.catch(() => {}))
    return next
  }

  const load = async (id: string): Promise<LoadedSession | null> => {
    const hit = cache.get(id)
    if (hit) return hit
    const text = await files.readAppFile(sessionPath(id))
    if (text === null) return null
    const parsed = parseSession(text)
    if (parsed) cache.set(id, parsed)
    return parsed
  }

  const write = async (s: LoadedSession): Promise<void> => {
    await files.writeAppFile(sessionPath(s.header.id), serialize(s.header, s.entries))
    cache.set(s.header.id, s)
  }

  const append = (id: string, bodies: EntryBody[]): Promise<SessionEntry[]> =>
    serial(id, async () => {
      const s = await load(id)
      if (!s) throw new Error(`no such session: ${id}`)
      let parent = s.leaf
      const stamped = bodies.map((body) => {
        const entry = { ...body, id: newId(), parentId: parent, at: opts.clock.now() } as SessionEntry
        parent = entry.id
        return entry
      })
      await write({ ...s, entries: [...s.entries, ...stamped], leaf: parent })
      return stamped
    })

  return {
    async create(o = {}) {
      const header: SessionHeader = {
        type: 'session',
        version: 1,
        id: o.id ?? newId(),
        created: opts.clock.now(),
        vault: opts.vault,
        ...(o.title ? { title: o.title } : {}),
      }
      await serial(header.id, () => write({ header, entries: [], leaf: null, problems: [] }))
      return header
    },
    append,
    load,
    async list(o = {}) {
      const paths = await files.listAppDir(SESSIONS_DIR)
      const ids = paths
        .map((p) => p.slice(p.lastIndexOf('/') + 1))
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => name.slice(0, -'.jsonl'.length))
      const loaded = await Promise.all(ids.map((id) => load(id)))
      return loaded
        .filter((s): s is LoadedSession => s !== null)
        .map(summarize)
        .filter((s) => o.archived || !s.archived)
        .sort((a, b) => b.lastAt - a.lastAt || b.created - a.created)
    },
    rename: (id, title) =>
      serial(id, async () => {
        const s = await load(id)
        if (!s) throw new Error(`no such session: ${id}`)
        const header = { ...s.header }
        const trimmed = title.trim()
        if (trimmed) header.title = trimmed
        else delete header.title
        await write({ ...s, header })
      }),
    async archive(id) {
      await append(id, [{ type: 'custom', name: 'archived', data: true }])
    },
    invalidate(id) {
      if (id === undefined) cache.clear()
      else cache.delete(id)
    },
  }
}
