/**
 * Renames follow (collections DB6, bases-shaping A5.1): the planner that
 * says which `[[wikilinks]]` a move breaks, and the byte edit that mends
 * each one. Pure — it reads `LinkRef`s the index already holds and a path
 * list, and answers edits; it never touches text, a disk or a doc. The app
 * applies the edits to live docs (one `'local'` transaction per note) and
 * the CLI through its one journaled write path, so the two agree because
 * they share this, not because they were written alike.
 *
 * The rule: a link is rewritten only when its WRITTEN target would no longer
 * resolve to the note it resolved to before. The post-move resolver answers
 * that exactly as the editor will once the move has landed — so a bare
 * `[[Clusters]]` survives a move between folders (basename unchanged), a
 * path that is no longer the path does not, an ambiguous basename the move
 * tips the other way is caught, and so is a bare link to some OTHER note
 * that the moved one's new name would capture. What is rewritten is the
 * target and nothing else: alias, anchor, the `!` of an embed, the quotes
 * round a frontmatter value all stay byte for byte (golden rule 2). A
 * frontmatter link is the same edit as a body one — the offsets index the
 * original text — never a YAML reserialization.
 *
 * A case-only rename (`Clusters.md` → `clusters.md`) rewrites nothing: the
 * resolver reads names and paths without case, so every link still lands.
 */
import { basename, normalizeTarget, PathResolver } from './resolve.js'
import type { LinkRef, Page, PageOptions } from './types.js'

/** One byte edit: replace `[from, to)` with `insert`, once `expect` has been checked. */
export interface LinkEdit {
  from: number
  to: number
  /**
   * The bytes the planner believes start at `from`: the target as the index
   * parsed it PLUS the one byte that ends it — `]`, `|` or `#` — so it is one
   * byte longer than the edit, and `[[a]]` recorded by the index can never
   * pass for `[[ab]]` on disk. An applier that finds anything else must
   * report the note rather than guess — the note changed under the index.
   */
  expect: string
  insert: string
}

/** The edits for one referencing note, in DESCENDING offset order so they apply cleanly. */
export interface LinkRewrite {
  /** The referencing note's path ONCE THE MOVE IS DONE (it may itself be under a moved folder). */
  path: string
  guid: string
  edits: LinkEdit[]
}

/** Is `path` the moved entry itself, or anywhere beneath it? */
const moves = (path: string, from: string): boolean => path === from || path.startsWith(`${from}/`)

/** Where `path` ends up when `from` moves to `to`, or null when it does not move. */
export function pathAfterMove(path: string, from: string, to: string): string | null {
  return moves(path, from) ? `${to}${path.slice(from.length)}` : null
}

/** The vault's path set once `from` has moved to `to`. */
export function pathsAfterMove(paths: Iterable<string>, from: string, to: string): string[] {
  const out: string[] = []
  for (const p of paths) out.push(pathAfterMove(p, from, to) ?? p)
  return out
}

/** The bytes a link's target can end on. The planner names one; the applier checks it. */
const TERMINATORS = new Set([']', '|', '#'])

/**
 * Plan the link rewrites a move of `from` to `to` needs — a note or a
 * folder: every ref is re-asked against the vault as it will be, and only
 * one whose written target would land somewhere else is touched.
 *
 * `refs` are the candidates (see `collectMoveRefs`); `vaultPaths` is every
 * FILE path in the vault before the move, text and binary alike, so an
 * embed of a moved attachment resolves the way the editor resolves it. Two
 * resolvers come from that list: the vault as it is, to place a ref the
 * index left unresolved (a binary's embed), and the vault as it will be, to
 * decide whether a written target still lands on its note and what shape
 * the rewritten one takes.
 *
 * The rewritten target keeps the shape it had: a bare name stays bare when
 * the new basename is unique in the vault, else becomes the path; a
 * partial path (`CS/Clusters`) stays a partial path of the same depth when
 * that still names the note alone, else becomes the full path; a written
 * `.md` is kept, an unwritten one is not added.
 */
export function planLinkRewrites(
  refs: readonly LinkRef[],
  from: string,
  to: string,
  vaultPaths: Iterable<string>
): LinkRewrite[] {
  const paths = [...vaultPaths]
  const before = new PathResolver(paths)
  const after = new PathResolver(pathsAfterMove(paths, from, to))
  const byNote = new Map<string, LinkRewrite>()

  for (const ref of refs) {
    // `[[#heading]]` is a same-note anchor: nothing to follow.
    if (!ref.target) continue
    const old = ref.resolved ?? before.resolve(ref.target, ref.path)
    if (!old) continue
    // Where the note this link reached will be — moved, or where it was.
    const next = pathAfterMove(old, from, to) ?? old
    const refPath = pathAfterMove(ref.path, from, to) ?? ref.path
    if (stillPointsAt(ref.target, old, next, refPath, after)) continue

    const insert = rewrittenTarget(ref.target, old, next, refPath, after)
    const start = ref.offset + (ref.embed ? 3 : 2)
    const terminator = ref.anchor !== null ? '#' : ref.alias !== null ? '|' : ']'
    const edit: LinkEdit = { from: start, to: start + ref.target.length, expect: ref.target + terminator, insert }
    const note = byNote.get(ref.guid) ?? { path: refPath, guid: ref.guid, edits: [] }
    if (!note.edits.some((e) => e.from === edit.from)) note.edits.push(edit)
    byNote.set(ref.guid, note)
  }

  const out = [...byNote.values()].filter((n) => n.edits.length > 0)
  for (const note of out) note.edits.sort((a, b) => b.from - a.from)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/** Every path a partial-path target could mean under the resolver's own rule: the path ends with it. */
function suffixMatches(resolver: PathResolver, norm: string): string[] {
  const needle = norm.toLowerCase()
  return resolver.candidates(norm).filter((p) => normalizeTarget(p).toLowerCase().endsWith(needle))
}

/** Was the written target the note's full path (`Areas/CS/Clusters`), as opposed to a bare name or a partial one? */
const isExactPath = (written: string, path: string): boolean =>
  normalizeTarget(written).toLowerCase() === normalizeTarget(path).toLowerCase()

/**
 * Does the written target still name the note that was at `old` and will be
 * at `next`, read from `refPath`? A bare name is asked of the post-move
 * resolver — it survives a move between folders and dies with a basename
 * change, an ambiguity the move tips the other way, or a new neighbour
 * that captures it. The full path, written exactly, is held to the path:
 * when the note moves it follows, even though the resolver would still
 * accept `Areas/CS/Clusters` for `Archive/Areas/CS/Clusters.md` by its
 * suffix rule — a path that is no longer the path is stale, and the next
 * note to appear at the old one would capture it. A partial path
 * (`CS/Clusters`), which was a suffix already, is kept while it still
 * names the note AND nothing else: a suffix two notes end with is a
 * proximity coin-toss, and one that no longer ends the path is dead.
 */
function stillPointsAt(written: string, old: string, next: string, refPath: string, after: PathResolver): boolean {
  if (!normalizeTarget(written).includes('/')) return after.resolve(written, refPath) === next
  if (isExactPath(written, next)) return true
  if (isExactPath(written, old)) return false
  return suffixMatches(after, normalizeTarget(written)).length === 1 && after.resolve(written, refPath) === next
}

/** The new written target for `written`, now that its note has gone from `old` to `next`. */
function rewrittenTarget(written: string, old: string, next: string, refPath: string, after: PathResolver): string {
  const hadMd = /\.md$/i.test(written.trim())
  const norm = normalizeTarget(written)
  const full = normalizeTarget(next)
  let target = full
  if (!norm.includes('/')) {
    const name = basename(next)
    if (after.candidates(name).length === 1) target = name
  } else if (!isExactPath(written, old)) {
    // A partial path keeps the depth the author wrote, when that alone names the note.
    const depth = norm.split('/').length
    const segments = full.split('/')
    if (depth < segments.length) {
      const suffix = segments.slice(-depth).join('/')
      if (suffixMatches(after, suffix).length === 1 && after.resolve(suffix, refPath) === next) target = suffix
    }
  }
  return hadMd && !/\.md$/i.test(target) ? `${target}.md` : target
}

/**
 * Apply a note's edits to its text, or null when any edit's `expect` is not
 * what the text holds — the note changed since the index read it, and a
 * wrong byte here would corrupt a link somewhere else in the line. All or
 * nothing per note: half a note's links updated is worse to find than none.
 */
export function applyLinkEdits(text: string, edits: readonly LinkEdit[]): string | null {
  for (const e of edits) {
    if (!TERMINATORS.has(e.expect.slice(-1))) return null
    if (text.slice(e.from, e.from + e.expect.length) !== e.expect) return null
  }
  let out = text
  // Descending order, so an earlier edit never shifts a later offset.
  for (const e of [...edits].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, e.from) + e.insert + out.slice(e.to)
  }
  return out
}

/** The slice of the index a move needs: who links to a path, and which links resolve to nothing. */
export type MoveRefSource = {
  backlinks(target: string, opts?: PageOptions): Promise<Page<LinkRef>>
  unresolved(opts?: PageOptions): Promise<Page<LinkRef>>
}

/** Only a markdown note is rewritten: a `.canvas` or `.txt` that links has an owner that is not a text patcher. */
const isNote = (path: string): boolean => /\.md$/i.test(path)

/**
 * Every ref a move of `from` to `to` could break: the backlinks of each
 * file at or under `from`; the backlinks of every file that shares a
 * basename with one of those files' NEW names, because the moved note can
 * capture a bare link meant for its namesake (or lose one to it); and the
 * index's unresolved links that resolve — over the full file list, binaries
 * included — to one of the moving files, which is how `![[diagram.png]]`
 * follows its attachment: the index only resolves links to text, so an
 * attachment's embeds are unresolved there, but the editor resolves them by
 * the same rules over every file, and so does this. Refs from anything that
 * is not a markdown note are dropped: the app and the CLI then agree on
 * what gets edited. Pages through everything; a move must not stop at the
 * first fifty.
 */
export async function collectMoveRefs(
  index: MoveRefSource,
  vaultPaths: Iterable<string>,
  from: string,
  to: string
): Promise<LinkRef[]> {
  const paths = [...vaultPaths]
  const moving = new Set(paths.filter((p) => moves(p, from)))
  const newNames = new Set([...moving].map((p) => basename(pathAfterMove(p, from, to) ?? p).toLowerCase()))
  const namesakes = paths.filter((p) => !moving.has(p) && newNames.has(basename(p).toLowerCase()))
  const seen = new Set<string>()
  const out: LinkRef[] = []
  const take = (ref: LinkRef): void => {
    if (!isNote(ref.path)) return
    const key = `${ref.guid}\u0000${ref.offset}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(ref)
  }
  for (const path of [...moving, ...namesakes]) {
    for (const ref of await allPages((opts) => index.backlinks(path, opts))) take(ref)
  }
  const resolver = new PathResolver(paths)
  for (const ref of await allPages((opts) => index.unresolved(opts))) {
    const target = resolver.resolve(ref.target, ref.path)
    if (target && moving.has(target)) take(ref)
  }
  return out
}

/** Every item of a cursored query, page after page. */
async function allPages<T>(page: (opts: PageOptions) => Promise<Page<T>>): Promise<T[]> {
  const items: T[] = []
  let cursor: string | undefined
  do {
    const result = await page({ limit: 1000, ...(cursor === undefined ? {} : { cursor }) })
    items.push(...result.items)
    cursor = result.nextCursor ?? undefined
  } while (cursor !== undefined)
  return items
}
