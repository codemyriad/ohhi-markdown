/**
 * The link popover's logic (editor-usability E1), pure: which notes the `[[`
 * popover offers and in what order, what a pick writes, and where the caret
 * lands. No CM6 here — `wikilink-view.ts` turns these answers into a
 * completion source, so every rule is provable in a unit test.
 *
 * Scope (fork A2): in a note inside a shared folder (a mount) the share's own
 * notes come first, and every other note sits below a divider — linking to it
 * works for you, but a collaborator's copy of the share does not hold it. A
 * note in the private root sees one ungrouped list.
 */

import { PathResolver } from '@ohhi/index'

/** A shared folder, as the shell knows it: its workspace path and display name. */
export interface LinkMount {
  /** Workspace-relative mount root, never `''` (the root mount is not a share). */
  path: string
  name: string
}

/**
 * Which group a note lands in: `scope` = the context note's own share,
 * `other` = outside it (only you can open it), `all` = no share in play.
 */
export type LinkGroup = 'scope' | 'other' | 'all'

export interface LinkNote {
  path: string
  /** The mount this note lives in, or null for the private root. */
  mount: string | null
  group: LinkGroup
}

export interface RankedNote extends LinkNote {
  /** Basename without `.md` — the row's label. */
  name: string
  /** The folder the note lives in (vault-relative), `''` at the root. */
  folder: string
  /** 0 name prefix · 1 word start · 2 name substring · 3 path match. */
  tier: number
  /** The matched span of `name`, for the bold-in-primary highlight. */
  match: [number, number] | null
}

/** The default cap per group: the popover is a picker, not a file list. */
export const LINK_LIMIT = 50

const stripMd = (path: string): string => path.replace(/\.md$/i, '')

export function noteName(path: string): string {
  const bare = stripMd(path)
  return bare.slice(bare.lastIndexOf('/') + 1)
}

export function noteFolder(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

const inside = (path: string, root: string): boolean => path.startsWith(`${root}/`)

/** The (innermost) share holding `path`, or null for the private root. */
export function mountOf<M extends { path: string }>(path: string | null | undefined, mounts: readonly M[]): M | null {
  if (!path) return null
  let best: M | null = null
  for (const m of mounts) {
    if (!m.path || !inside(path, m.path)) continue
    if (!best || m.path.length > best.path.length) best = m
  }
  return best
}

/** What a share is called where the app names it: its folder's last segment. */
export function shareName(mountPath: string): string {
  return mountPath.slice(mountPath.lastIndexOf('/') + 1)
}

/**
 * Split the vault's notes into the context note's share and everything else.
 * The context note itself is left out: a note rarely links to itself, and its
 * own headings are reachable with `[[#`.
 */
export function scopeNotes(
  paths: readonly string[],
  contextPath: string | null | undefined,
  mounts: readonly LinkMount[]
): { mount: LinkMount | null; notes: LinkNote[] } {
  const mount = mountOf(contextPath, mounts)
  const notes: LinkNote[] = []
  for (const path of paths) {
    if (path === contextPath) continue
    const own = mountOf(path, mounts)?.path ?? null
    const group: LinkGroup = !mount ? 'all' : own === mount.path ? 'scope' : 'other'
    notes.push({ path, mount: own, group })
  }
  return { mount, notes }
}

/** Where a word starts in a note name: after a space, a dash, an underscore or a dot. */
function wordStart(name: string, query: string): number {
  for (let i = 1; i < name.length; i++) {
    if (/[\s\-_.()]/.test(name[i - 1] ?? '') && name.startsWith(query, i)) return i
  }
  return -1
}

function matchNote(note: LinkNote, query: string): RankedNote | null {
  const name = noteName(note.path)
  const folder = noteFolder(note.path)
  const base = { ...note, name, folder }
  if (!query) return { ...base, tier: 0, match: null }
  const lower = name.toLowerCase()
  if (lower.startsWith(query)) return { ...base, tier: 0, match: [0, query.length] }
  const word = wordStart(lower, query)
  if (word !== -1) return { ...base, tier: 1, match: [word, word + query.length] }
  const sub = lower.indexOf(query)
  if (sub !== -1) return { ...base, tier: 2, match: [sub, sub + query.length] }
  if (stripMd(note.path).toLowerCase().includes(query)) return { ...base, tier: 3, match: null }
  return null
}

const GROUP_ORDER: Record<LinkGroup, number> = { scope: 0, all: 0, other: 1 }

/**
 * Rank notes for a `[[query`: the share first (A2), then the match tier —
 * name prefix, a word start in the name, anywhere in the name, the folder
 * path — then recently opened notes, then alphabetical. An empty query is
 * "recent notes in scope first". Capped at `limit` per group, so a big share
 * can never push the rest of the vault off the list entirely.
 */
export function rankNotes(
  query: string,
  notes: readonly LinkNote[],
  recents: readonly string[] = [],
  limit = LINK_LIMIT
): RankedNote[] {
  const q = query.trim().toLowerCase()
  const recency = new Map<string, number>()
  recents.forEach((path, i) => {
    if (!recency.has(path)) recency.set(path, i)
  })
  const rankOf = (path: string): number => recency.get(path) ?? Number.POSITIVE_INFINITY

  const ranked: RankedNote[] = []
  for (const note of notes) {
    const hit = matchNote(note, q)
    if (hit) ranked.push(hit)
  }
  ranked.sort(
    (a, b) =>
      GROUP_ORDER[a.group] - GROUP_ORDER[b.group] ||
      a.tier - b.tier ||
      rankOf(a.path) - rankOf(b.path) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      a.path.localeCompare(b.path)
  )
  const taken = new Map<LinkGroup, number>()
  return ranked.filter((note) => {
    const n = taken.get(note.group) ?? 0
    taken.set(note.group, n + 1)
    return n < limit
  })
}

/** Does `query` already name a note exactly (by name or by path)? Then there is nothing to create. */
export function exactMatch(query: string, paths: readonly string[]): boolean {
  const q = stripMd(query.trim()).toLowerCase()
  if (!q) return true
  return paths.some((path) => {
    const bare = stripMd(path).toLowerCase()
    return bare === q || noteName(path).toLowerCase() === q || bare.endsWith(`/${q}`)
  })
}

/**
 * The folder a "Create" row would make the note in — the same rule the
 * shell's create-from-link uses: beside the current note, or at the vault
 * root when the target names a path of its own.
 */
export function createFolder(query: string, contextPath: string | null | undefined): string {
  if (query.includes('/')) return ''
  return contextPath ? noteFolder(contextPath) : ''
}

/**
 * What to write inside `[[…]]` for a picked note: the shortest trailing path
 * that names it uniquely among `allPaths` — the bare name when that is
 * unique, which is almost always.
 *
 * `root` caps how long the answer may get. For a note in the context note's
 * share it is the share's root, so the link is written relative to the share
 * and resolves the same in a collaborator's vault, where the share sits under
 * some other folder (a vault path would not resolve there at all). `''` is
 * the vault root. `typedPath` (the person typed a `/`) asks for the whole
 * root-relative path, as before.
 *
 * A share-relative answer is checked against the vault's own resolver
 * (`PathResolver`, the rule the index and a click use, over the FULL path set
 * `allPaths`, from `fromPath`), whose first rule is that an exact vault path
 * wins: `sub/Plan` written for `Team/sub/Plan.md` would open a root
 * `sub/Plan.md` instead. A target the resolver sends to a different note by
 * exact path grows until it does not, and falls back to the whole vault path,
 * which always lands. (An ambiguous basename the resolver can only break by
 * proximity is left share-relative: that is the collaborator's resolution to
 * make, in a vault where the share sits elsewhere.)
 */
export function linkTarget(
  path: string,
  allPaths: readonly string[],
  root = '',
  typedPath = false,
  fromPath?: string | null
): string {
  const bare = stripMd(path)
  const rel = root && inside(bare, root) ? bare.slice(root.length + 1) : bare
  let resolver: PathResolver | null = null
  /** False when `target` is an exact vault path of some OTHER note (exact paths win). */
  const lands = (target: string): boolean => {
    if (!target.includes('/') || target === bare) return true
    resolver ??= new PathResolver(allPaths)
    const hit = resolver.resolve(target, fromPath ?? undefined)
    const exactOther = hit !== null && stripMd(hit).toLowerCase() === target.toLowerCase()
    return !exactOther || stripMd(hit).toLowerCase() === bare.toLowerCase()
  }
  if (typedPath) return lands(rel) ? rel : bare
  const segments = rel.split('/')
  const name = (segments[segments.length - 1] ?? '').toLowerCase()
  const sameName = allPaths.map((p) => stripMd(p).toLowerCase()).filter((p) => p === name || p.endsWith(`/${name}`))
  for (let k = 1; k <= segments.length; k++) {
    const suffix = segments.slice(-k).join('/')
    const lower = suffix.toLowerCase()
    const hits = sameName.filter((p) => p === lower || p.endsWith(`/${lower}`))
    if (hits.length <= 1 && lands(suffix)) return suffix
  }
  return lands(rel) ? rel : bare
}

/**
 * Obsidian's heading-anchor rule: the characters that would end or split a
 * link (`# | ^ [ ]`) become spaces, and runs of space collapse.
 */
export function headingAnchor(text: string): string {
  return text.replace(/[#|^[\]]/g, ' ').replace(/\s+/g, ' ').trim()
}

export interface LinkHeading {
  level: number
  text: string
}

/** Headings matching `query`: prefix matches first, then the rest, each in document order. */
export function rankHeadings(
  query: string,
  headings: readonly LinkHeading[],
  limit = LINK_LIMIT
): (LinkHeading & { anchor: string; match: [number, number] | null })[] {
  const q = query.trim().toLowerCase()
  const rows = headings
    .map((h, i) => {
      const anchor = headingAnchor(h.text)
      const at = q ? anchor.toLowerCase().indexOf(q) : 0
      return { ...h, anchor, i, at }
    })
    .filter((h) => h.anchor && h.at !== -1)
  rows.sort((a, b) => Number(a.at !== 0) - Number(b.at !== 0) || a.i - b.i)
  return rows.slice(0, limit).map(({ level, text, anchor, at }) => ({
    level,
    text,
    anchor,
    match: q ? ([at, at + q.length] as [number, number]) : null,
  }))
}

/**
 * Where an open `[[` is, relative to the caret on one line, and what has been
 * typed: the target, and a heading query when a `#` follows it. Null when the
 * caret is not inside an unterminated link (already closed, or past a `|`
 * where the person is typing an alias, which is theirs).
 */
export interface LinkQuery {
  /** Offset just after `[[`. */
  open: number
  /** The target typed so far (before any `#`). */
  target: string
  /** Set when the caret is past a `#`: what has been typed after it, and where it starts. */
  heading: { from: number; query: string } | null
}

export function linkQueryAt(line: string, caret: number): LinkQuery | null {
  const before = line.slice(0, caret)
  const at = before.lastIndexOf('[[')
  if (at === -1) return null
  const open = at + 2
  const typed = before.slice(open)
  if (typed.includes(']') || typed.includes('|')) return null
  const hash = typed.indexOf('#')
  if (hash === -1) return { open, target: typed.trim(), heading: null }
  return {
    open,
    target: typed.slice(0, hash).trim(),
    heading: { from: open + hash + 1, query: typed.slice(hash + 1) },
  }
}

/** One edit plus where the caret ends — what a pick dispatches. */
export interface LinkEdit {
  from: number
  to: number
  insert: string
  /** The caret after the edit, in post-edit offsets. */
  cursor: number
}

/**
 * Write a pick into the line and close the link.
 *
 * `from` is where the segment being completed starts (just after `[[` for a
 * target, just after `#` for a heading); the segment runs from there past the
 * caret to the next `#`/`|`/`]` (a target) or `|`/`]` (a heading), so editing
 * the middle of an existing target replaces all of it.
 *
 * - Nothing after it: write `text]]`, caret after the brackets.
 * - `]]` already there (typed, or auto-closed): step over it, never `]]]]`.
 * - A typed `#heading` or `|alias` suffix: keep it, add no brackets, and put
 *   the caret after the link's closing `]]`. With no `]]` on the line there
 *   is no telling where the person meant the suffix to end, so nothing is
 *   guessed: the caret stays after the target.
 * - A lone `]`: complete it to `]]`.
 *
 * Offsets are relative to `line`; the caller adds the line's start.
 */
export function linkEdit(
  line: string,
  from: number,
  caret: number,
  text: string,
  kind: 'target' | 'heading' = 'target'
): LinkEdit {
  const stops = kind === 'target' ? /[#|\]]/ : /[|\]]/
  const rest = line.slice(caret)
  const stop = rest.search(stops)
  const segEnd = caret + (stop === -1 ? rest.length : stop)
  const after = line.slice(segEnd)
  const end = from + text.length

  if (after.startsWith(']]')) return { from, to: segEnd, insert: text, cursor: end + 2 }
  if (after.startsWith('#') || after.startsWith('|')) {
    const close = after.indexOf(']]')
    // A `[[` before that `]]` means the brackets belong to the NEXT link.
    const closed = close !== -1 && !after.slice(0, close).includes('[[')
    return { from, to: segEnd, insert: text, cursor: closed ? end + close + 2 : end }
  }
  if (after.startsWith(']')) return { from, to: segEnd + 1, insert: `${text}]]`, cursor: end + 2 }
  return { from, to: segEnd, insert: `${text}]]`, cursor: end + 2 }
}
