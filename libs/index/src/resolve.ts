/**
 * Wikilink target → vault path.
 *
 * Obsidian's rule, calibrated to the measured vault: of 943 link targets only
 * 6 carry a path prefix and only 4 basenames are duplicated vault-wide, so
 * basename-first resolution is correct ~99.7% of the time. Ambiguity is
 * broken by proximity to the linking note (Obsidian's "shortest path when
 * possible" behaves the same way in practice).
 *
 * Pure and synchronous so it is unit-testable without an index (parent R6).
 */

/** Strip a trailing `.md` and normalise separators. */
export function normalizeTarget(target: string): string {
  return target.trim().replace(/\\/g, '/').replace(/\.md$/i, '')
}

export function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return (slash === -1 ? path : path.slice(slash + 1)).replace(/\.md$/i, '')
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** How many leading path segments two paths share. */
function sharedPrefix(a: string, b: string): number {
  const as = a.split('/')
  const bs = b.split('/')
  let n = 0
  while (n < as.length && n < bs.length && as[n].toLowerCase() === bs[n].toLowerCase()) n++
  return n
}

/**
 * Lookup tables over the vault's text paths. Rebuilt whenever the file set
 * changes — cheap (one pass) and far cheaper than resolving against a linear
 * scan on every link.
 */
export class PathResolver {
  /** lowercased full path (no .md) → real path */
  private byPath = new Map<string, string>()
  /** lowercased basename → real paths, in insertion order */
  private byName = new Map<string, string[]>()

  constructor(paths: Iterable<string> = []) {
    this.reset(paths)
  }

  reset(paths: Iterable<string>): void {
    this.byPath.clear()
    this.byName.clear()
    for (const p of paths) {
      this.byPath.set(normalizeTarget(p).toLowerCase(), p)
      const name = basename(p).toLowerCase()
      const bucket = this.byName.get(name)
      if (bucket) bucket.push(p)
      else this.byName.set(name, [p])
    }
  }

  /**
   * Resolve `target` to a path, or null.
   *
   * Order: exact path (case-insensitive) → unique basename → ambiguous
   * basename broken by proximity to `fromPath`, then by shortest path, then
   * alphabetically so the answer is stable across boots.
   */
  resolve(target: string, fromPath?: string): string | null {
    const norm = normalizeTarget(target)
    if (!norm) return null

    const exact = this.byPath.get(norm.toLowerCase())
    if (exact) return exact

    const candidates = this.byName.get(basename(norm).toLowerCase())
    if (!candidates || candidates.length === 0) return null
    // A target with a path prefix must actually end with that prefix — a bare
    // basename match would silently link `a/Note` to `b/Note`.
    const prefixed = norm.includes('/')
      ? candidates.filter((p) => normalizeTarget(p).toLowerCase().endsWith(norm.toLowerCase()))
      : candidates
    if (prefixed.length === 0) return null
    if (prefixed.length === 1) return prefixed[0]

    const home = fromPath ? dirOf(fromPath) : ''
    return [...prefixed].sort((a, b) => {
      const pa = sharedPrefix(dirOf(a), home)
      const pb = sharedPrefix(dirOf(b), home)
      if (pa !== pb) return pb - pa
      const da = a.split('/').length
      const db = b.split('/').length
      if (da !== db) return da - db
      return a.localeCompare(b)
    })[0]
  }

  /** Every known path whose basename matches, for "did you mean" affordances. */
  candidates(target: string): string[] {
    return this.byName.get(basename(normalizeTarget(target)).toLowerCase()) ?? []
  }
}
