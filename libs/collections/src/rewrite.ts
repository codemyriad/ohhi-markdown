/**
 * Renames follow into collections (collections DB6, the integration review):
 * a `.base` names its rows by folder and by link — `file.inFolder("Competitors")`
 * is what "New collection" writes, `file.hasLink("Clusters")` is the pillar
 * view — so a rename the wikilink planner follows would otherwise leave the
 * collection matching nothing: its tab and every embed empty, and every
 * row-note's form gone with it.
 *
 * This is that planner for `.base` text. Pure, like `@ohhi/index`'s: it reads
 * a collection's text and a path list and answers byte edits in the index's
 * own `LinkEdit` shape, so the app applies them on the live doc and the CLI
 * through its journaled write exactly as it applies a link rewrite, and the
 * same applier (`applyLinkEdits`) checks every `expect` first.
 *
 * What is rewritten, and nothing else (golden rule 2):
 *  - `file.inFolder("…")` naming the moved folder or a folder under it — the
 *    prefix is rewritten; slashes the author wrote around it are kept. Exact
 *    case, as the filter compares.
 *  - `file.hasLink("…")` whose target resolved to a note the move breaks it
 *    for — decided by `retargetLink`, the wikilink planner's own rule, so a
 *    bare name survives a move between folders and a path does not.
 * Only statements in a `filters` tree (the file's, or a view's) are read,
 * through the filter compiler's tokenizer, so a comment, a display name or a
 * string that merely contains the words is never touched. A string written
 * with an escape in it, a block scalar, or a new name the statement's quoting
 * cannot hold byte for byte is left as it is — a stale filter is visible in
 * the tab; a corrupted file is not.
 */
import { isMap, isScalar, isSeq, parseDocument, type Node } from 'yaml'
import { PathResolver, pathAfterMove, pathsAfterMove, retargetLink, type LinkEdit } from '@ohhi/index'
import { fileCallStrings, type FileCallString } from './filter.js'

export interface CollectionRewriteOptions {
  /** Every file path in the vault BEFORE the move — what `file.hasLink` resolves over. */
  vaultPaths: Iterable<string>
}

/** One collection's edits, at its path once the move is done (it may itself have moved). */
export interface CollectionRewrite {
  path: string
  edits: LinkEdit[]
}

/** The vault before and after the move, built only when a `hasLink` needs them. */
interface Resolvers {
  before(): PathResolver
  after(): PathResolver
}

function resolvers(vaultPaths: Iterable<string>, from: string, to: string): Resolvers {
  const paths = [...vaultPaths]
  let before: PathResolver | null = null
  let after: PathResolver | null = null
  return {
    before: () => (before ??= new PathResolver(paths)),
    after: () => (after ??= new PathResolver(pathsAfterMove(paths, from, to))),
  }
}

/**
 * The edits a move of `from` to `to` (a note or a folder) needs in one
 * collection's text, in DESCENDING offset order. Empty when nothing in it
 * names what moves, or when the text is not YAML at all.
 */
export function planCollectionRewrites(
  baseText: string,
  from: string,
  to: string,
  opts: CollectionRewriteOptions
): LinkEdit[] {
  return planWith(baseText, from, to, resolvers(opts.vaultPaths, from, to))
}

/**
 * Every collection a move touches: `bases` are the vault's `.base` files
 * with their text as it is BEFORE the move; each answer carries the path the
 * file will be at once the move is done.
 */
export function planCollectionMoves(
  bases: Iterable<{ path: string; text: string }>,
  from: string,
  to: string,
  vaultPaths: Iterable<string>
): CollectionRewrite[] {
  const shared = resolvers(vaultPaths, from, to)
  const out: CollectionRewrite[] = []
  for (const base of bases) {
    const edits = planWith(base.text, from, to, shared)
    if (edits.length) out.push({ path: pathAfterMove(base.path, from, to) ?? base.path, edits })
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

function planWith(text: string, from: string, to: string, r: Resolvers): LinkEdit[] {
  let doc
  try {
    doc = parseDocument(text, { uniqueKeys: false })
  } catch {
    return []
  }
  if (doc.errors.length || !isMap(doc.contents)) return []
  const statements: Node[] = []
  collect(doc.contents.get('filters', true), statements)
  const views = doc.contents.get('views', true)
  if (isSeq(views)) for (const view of views.items) if (isMap(view)) collect(view.get('filters', true), statements)

  const edits: LinkEdit[] = []
  for (const node of statements) {
    if (!isScalar(node) || typeof node.value !== 'string' || !node.range) continue
    const style = node.type ?? 'PLAIN'
    if (style !== 'PLAIN' && style !== 'QUOTE_DOUBLE' && style !== 'QUOTE_SINGLE') continue
    // The statement's source: a quoted scalar's bytes between its quotes.
    const quoted = style !== 'PLAIN'
    const start = node.range[0] + (quoted ? 1 : 0)
    const end = node.range[1] - (quoted ? 1 : 0)
    for (const call of fileCallStrings(text.slice(start, end))) {
      if (!call.verbatim) continue
      const insert = rewritten(call, from, to, r)
      if (insert === null || insert === call.value || !holds(insert, call.quote, style)) continue
      edits.push({ from: start + call.from, to: start + call.to, expect: call.value + call.quote, insert })
    }
  }
  return edits.sort((a, b) => b.from - a.from)
}

/** The statements of a filter tree: a string, or an `and`/`or`/`not` block over more. */
function collect(node: unknown, out: Node[]): void {
  if (isScalar(node)) out.push(node)
  else if (isSeq(node)) for (const item of node.items) collect(item, out)
  else if (isMap(node)) {
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? pair.key.value : pair.key
      if (key === 'and' || key === 'or' || key === 'not') collect(pair.value, out)
    }
  }
}

/** The argument's new value, or null when the move leaves it naming what it named. */
function rewritten(call: FileCallString, from: string, to: string, r: Resolvers): string | null {
  if (call.fn === 'inFolder') {
    const lead = /^\/*/.exec(call.value)?.[0] ?? ''
    const trail = /\/*$/.exec(call.value.slice(lead.length))?.[0] ?? ''
    const folder = call.value.slice(lead.length, call.value.length - trail.length)
    if (!folder) return null
    const next = pathAfterMove(folder, from, to)
    return next === null ? null : `${lead}${next}${trail}`
  }
  // `hasLink` resolves the way the index's filter does: from no note in particular.
  const old = r.before().resolve(call.value)
  if (!old) return null
  return retargetLink(call.value, old, from, to, r.after())
}

/**
 * Can the new value sit where the old one did, byte for byte, without
 * changing what the statement or the YAML around it means? Not when it holds
 * the string's own quote or a backslash, the YAML scalar's quote, or — in a
 * plain scalar — what YAML would read as a key or a comment.
 */
function holds(value: string, quote: string, style: string): boolean {
  if (value.includes(quote) || value.includes('\\') || /[\r\n]/.test(value)) return false
  if (style === 'QUOTE_SINGLE' && value.includes("'")) return false
  if (style === 'QUOTE_DOUBLE' && value.includes('"')) return false
  if (style === 'PLAIN' && (value.includes(': ') || value.includes(' #'))) return false
  return true
}
