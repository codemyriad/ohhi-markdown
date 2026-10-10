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
 * resolve to the moved note. The post-move resolver answers that question
 * exactly as the editor will once the move has landed — so a bare
 * `[[Clusters]]` survives a move between folders (basename unchanged), a
 * path-prefixed `[[Pillars/Clusters]]` does not, and an ambiguous basename
 * that the move tips the other way is caught too. What is rewritten is the
 * target and nothing else: alias, anchor, the `!` of an embed, the quotes
 * round a frontmatter value all stay byte for byte (golden rule 2). A
 * frontmatter link is the same edit as a body one — the offsets index the
 * original text — never a YAML reserialization.
 */
import { basename, normalizeTarget, PathResolver } from './resolve.js'
import type { LinkRef, Page, PageOptions } from './types.js'

/** One byte edit: replace `[from, to)` — which must read `expect` — with `insert`. */
export interface LinkEdit {
  from: number
  to: number
  /**
   * The bytes the planner believes sit at `[from, to)`: the target as the
   * index parsed it. An applier that finds anything else must report the
   * note rather than guess — the note changed under the index.
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

/**
 * Plan the link rewrites a move of `from` to `to` needs — a note or a
 * folder: every ref whose resolved target is `from` or under it is
 * considered, and nothing else is.
 *
 * `refs` are the candidates (see `collectMoveRefs`); `vaultPaths` is every
 * FILE path in the vault before the move, text and binary alike, so an
 * embed of a moved attachment resolves the way the editor resolves it. Two
 * resolvers come from that list: the vault as it is, to place a ref the
 * index left unresolved (a binary's embed), and the vault as it will be, to
 * decide whether a written target still lands on the note and whether its
 * new bare name is unambiguous.
 *
 * The rewritten target keeps the shape it had: a bare name stays bare when
 * the new basename is unique in the vault, else becomes the path; a path
 * stays a path; a written `.md` is kept, an unwritten one is not added.
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
    const next = pathAfterMove(old, from, to)
    if (!next) continue
    const refPath = pathAfterMove(ref.path, from, to) ?? ref.path
    if (stillPointsAt(ref.target, next, refPath, after)) continue

    const insert = rewrittenTarget(ref.target, next, after)
    const start = ref.offset + (ref.embed ? 3 : 2)
    const edit: LinkEdit = { from: start, to: start + ref.target.length, expect: ref.target, insert }
    const note = byNote.get(ref.guid) ?? { path: refPath, guid: ref.guid, edits: [] }
    if (!note.edits.some((e) => e.from === edit.from)) note.edits.push(edit)
    byNote.set(ref.guid, note)
  }

  const out = [...byNote.values()].filter((n) => n.edits.length > 0)
  for (const note of out) note.edits.sort((a, b) => b.from - a.from)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Does the written target still name the note at `next`, read from `refPath`?
 * A bare name is asked of the post-move resolver — it survives a move
 * between folders and dies with a basename change or an ambiguity the move
 * tips the other way. A path-prefixed target is held to the path itself:
 * the resolver would still accept `[[Pillars/Clusters]]` for
 * `Archive/Pillars/Clusters.md` (its suffix rule), but a path that no longer
 * is the path is stale, and the next note to appear at the old one would
 * capture it. A link that carries the folder's path follows the folder.
 */
function stillPointsAt(written: string, next: string, refPath: string, after: PathResolver): boolean {
  const norm = normalizeTarget(written)
  if (!norm.includes('/')) return after.resolve(written, refPath) === next
  return norm.toLowerCase() === normalizeTarget(next).toLowerCase()
}

/** The new written target for `written`, now that the note is at `next`. */
function rewrittenTarget(written: string, next: string, after: PathResolver): string {
  const hadMd = /\.md$/i.test(written.trim())
  const bare = !normalizeTarget(written).includes('/')
  const name = basename(next)
  const unambiguous = after.candidates(name).length === 1
  const target = bare && unambiguous ? name : next.replace(/\.md$/i, '')
  return hadMd && !/\.md$/i.test(target) ? `${target}.md` : target
}

/**
 * Apply a note's edits to its text, or null when any edit's `expect` is not
 * what the text holds — the note changed since the index read it, and a
 * wrong byte here would corrupt a link somewhere else in the line. All or
 * nothing per note: half a note's links updated is worse to find than none.
 */
export function applyLinkEdits(text: string, edits: readonly LinkEdit[]): string | null {
  for (const e of edits) if (text.slice(e.from, e.to) !== e.expect) return null
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

/**
 * Every ref a move of `from` could break: the backlinks of each file at or
 * under it, plus the index's unresolved links that resolve — over the full
 * file list, binaries included — to one of those files. The second half is
 * how `![[diagram.png]]` follows its attachment: the index only resolves
 * links to text, so an attachment's embeds are unresolved there, but the
 * editor resolves them by the same rules over every file, and so does this.
 * Pages through everything; a move must not stop at the first fifty.
 */
export async function collectMoveRefs(
  index: MoveRefSource,
  vaultPaths: Iterable<string>,
  from: string
): Promise<LinkRef[]> {
  const paths = [...vaultPaths]
  const moving = new Set(paths.filter((p) => moves(p, from)))
  const seen = new Set<string>()
  const out: LinkRef[] = []
  const take = (ref: LinkRef): void => {
    const key = `${ref.guid}\u0000${ref.offset}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(ref)
  }
  for (const path of moving) {
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
