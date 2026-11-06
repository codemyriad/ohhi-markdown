/**
 * The ETag walk behind `WebDavVaultAdapter.watch` (nextcloud-build decision
 * 10) and its `list()`.
 *
 * Nextcloud changes a folder's `getetag` whenever anything below it changes
 * (spike S16 Q2), so a walk lists the root at Depth 1 and descends ONLY into
 * the folders whose etag moved since the last walk; an idle vault costs one
 * PROPFIND. A folder's own etag is recorded from the SAME multistatus that
 * listed its children, never from its parent's listing — so a change that
 * lands between the two requests is seen again next walk rather than lost.
 *
 * Same-second writes. Nextcloud 35 moves a FOLDER's etag on every change, but
 * a FILE's etag stays put for a second write inside the same wall-clock
 * second (measured: `a` → `bbbbbb` at 13:44:10 kept `"341e…"`). So when a
 * re-listed folder shows a file with an unchanged etag whose
 * `getlastmodified` is at or after the server `Date` of the PREVIOUS listing
 * of that folder, the file may have been rewritten after we looked, inside
 * that second: it is reported again (`suspect`). The consumer re-reads and
 * re-hashes, so a false positive costs a GET; a false negative would cost an
 * edit.
 *
 * Races with a move. A walk's listings are not one snapshot: a folder renamed
 * between its parent's listing and its own answers 404, and a file moved
 * between two folders' listings shows up twice or nowhere. Either way the
 * walk is torn, and reading it would lose identity (the moved notes look new
 * and get fresh guids). So a sub-folder 404 or a file id listed twice throws
 * `WalkRaceError` — the caller keeps its previous table and the next walk
 * re-lists from the root — and a path that vanished without a partner is
 * HELD for one walk (`diffTables`' `held`): if its file id turns up next walk
 * it is a move, else it is reported gone then (nextcloud-build R1 #5).
 *
 * Pure over an injected `propfind`: no clock, no fetch, no state of its own.
 */
import { VaultUnavailableError, type WatchEvent } from '../types.js'
import type { DavEntry } from './propfind.js'

export interface FileRec {
  etag: string
  fileid: string
  size: number
  /** `getlastmodified`, epoch ms; `null` when the server sent none. */
  mtime: number | null
}

export interface DirRec {
  etag: string
  fileid: string
  /** The server `Date` of the response that listed this folder; `null` when absent. */
  listedAt: number | null
}

/** Everything one walk saw. `dirs` includes the root as `''`. */
export interface WalkTable {
  dirs: Map<string, DirRec>
  files: Map<string, FileRec>
  /** Files whose etag did not move but which may have changed inside one second. */
  suspect: Set<string>
}

/** One Depth-1 listing and the server's `Date` for it. */
export interface Listing {
  entries: DavEntry[]
  at: number | null
}

export interface WalkDeps {
  /** PROPFIND Depth 1 of a vault-relative collection; `null` on 404. */
  propfind(path: string): Promise<Listing | null>
  /** Whether an entry may be seen at all (ignored, reserved, foreign, temp). */
  visible(entry: DavEntry): boolean
}

/** The listings disagreed with each other (a move landed mid-walk); walk again. */
export class WalkRaceError extends Error {
  override readonly name = 'WalkRaceError'
  constructor(readonly path: string) {
    super(`webdav: the tree moved during the walk (${JSON.stringify(path)})`)
  }
}

const parentOf = (path: string): string => {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

/**
 * Walk the tree. With `prev`, a folder whose etag equals the one `prev`
 * recorded is not re-listed — its subtree is carried over from `prev`.
 * Without `prev`, every folder is listed (a fresh full walk).
 *
 * Any failure throws, and the caller keeps its previous table: an outage is
 * never read as a mass delete, and a torn walk (`WalkRaceError`) never as a
 * delete plus a create.
 */
export async function walkTree(deps: WalkDeps, prev: WalkTable | null): Promise<WalkTable> {
  const next: WalkTable = { dirs: new Map(), files: new Map(), suspect: new Set() }
  const unchanged = new Set<string>()
  const queue: string[] = ['']
  while (queue.length > 0) {
    const dir = queue.shift()!
    const listing = await deps.propfind(dir)
    if (listing === null) {
      if (dir === '') throw new VaultUnavailableError('/')
      // Removed or renamed between its parent's listing and ours: the next
      // walk re-lists the parent and sees where it went.
      throw new WalkRaceError(dir)
    }
    const { entries } = listing
    const self = entries.find((e) => e.path === dir)
    const lastListedAt = prev?.dirs.get(dir)?.listedAt ?? null
    next.dirs.set(dir, { etag: self?.etag ?? '', fileid: self?.fileid ?? '', listedAt: listing.at })
    for (const e of entries) {
      if (e.path === dir || e.path === '' || parentOf(e.path) !== dir) continue
      if (!deps.visible(e)) continue
      if (e.isDir) {
        const before = prev?.dirs.get(e.path)
        if (before && e.etag !== '' && before.etag === e.etag) unchanged.add(e.path)
        else queue.push(e.path)
      } else {
        next.files.set(e.path, { etag: e.etag, fileid: e.fileid, size: e.size, mtime: e.mtime })
        const before = prev?.files.get(e.path)
        if (
          before &&
          before.etag === e.etag &&
          lastListedAt !== null &&
          e.mtime !== null &&
          e.mtime >= lastListedAt
        ) {
          next.suspect.add(e.path)
        }
      }
    }
  }
  if (prev && unchanged.size > 0) {
    // Carry each unchanged folder's subtree over in one pass over `prev`.
    const underUnchanged = (path: string): boolean => {
      for (let p = path; p !== ''; p = parentOf(p)) if (unchanged.has(p)) return true
      return false
    }
    for (const [path, rec] of prev.dirs) if (path !== '' && underUnchanged(path)) next.dirs.set(path, rec)
    for (const [path, rec] of prev.files) if (underUnchanged(path)) next.files.set(path, rec)
  }
  // One file id at two paths: moved between two listings of this walk.
  for (const kind of ['dirs', 'files'] as const) {
    const seen = new Set<string>()
    for (const [path, rec] of next[kind]) {
      if (!rec.fileid) continue
      if (seen.has(rec.fileid)) throw new WalkRaceError(path)
      seen.add(rec.fileid)
    }
  }
  return next
}

/** Paths that vanished without a partner, held one walk: `<kind>:<fileid>` → path. */
export type HeldVanishes = ReadonlyMap<string, string>

/**
 * The change between two walks, or `null` when nothing moved. A path that
 * disappeared and a path that appeared with the SAME `oc:fileid` is a move:
 * it is reported in `moves` (and both paths stay in `paths`, the way a
 * filesystem watcher reports a rename).
 *
 * A path that disappeared with no partner is not reported yet: it goes into
 * the returned `held` and the NEXT diff (given that `held`) pairs it as a move
 * if its file id appeared, else reports it gone. A file moved between two
 * folders' listings costs one walk's delay, never an identity.
 */
export function diffTables(
  prev: WalkTable,
  next: WalkTable,
  heldBefore: HeldVanishes = new Map()
): { event: WatchEvent | null; held: Map<string, string> } {
  const paths = new Set<string>()
  const moves: { from: string; to: string }[] = []
  const held = new Map<string, string>()
  for (const kind of ['dirs', 'files'] as const) {
    const before = prev[kind] as Map<string, { etag: string; fileid: string }>
    const after = next[kind] as Map<string, { etag: string; fileid: string }>
    const gone = new Map<string, string>() // fileid → old path
    for (const [key, path] of heldBefore) {
      if (key.startsWith(`${kind}:`)) gone.set(key.slice(kind.length + 1), path)
    }
    const fromLastWalk = new Set(gone.values())
    for (const [path, rec] of before) {
      if (path === '') continue
      if (!after.has(path)) {
        if (rec.fileid) gone.set(rec.fileid, path)
        else paths.add(path) // no identity to pair: gone now
      }
    }
    for (const [path, rec] of after) {
      if (path === '') continue
      const old = before.get(path)
      if (!old) {
        paths.add(path)
        const from = rec.fileid ? gone.get(rec.fileid) : undefined
        if (from !== undefined) {
          gone.delete(rec.fileid)
          if (from !== path) {
            moves.push({ from, to: path })
            paths.add(from)
          }
        }
      } else if (kind === 'files' && (old.etag !== rec.etag || next.suspect.has(path))) {
        paths.add(path)
      }
    }
    for (const [fileid, path] of gone) {
      // Held one walk already: gone for real now. Fresh: hold it one walk.
      if (fromLastWalk.has(path)) paths.add(path)
      else held.set(`${kind}:${fileid}`, path)
    }
  }
  if (paths.size === 0) return { event: null, held }
  const event: WatchEvent = { paths: [...paths].sort() }
  if (moves.length > 0) event.moves = moves.sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0))
  return { event, held }
}
