/**
 * Per-workspace back/forward history.
 *
 * `Mod+[` / `Mod+]` are two of Chris's 18 Obsidian rebinds, and click-through
 * without a way back is a trap rather than a feature.
 *
 * History holds PATHS, not guids, because it is a record of "where I was
 * looking", and a path is what the user recognises. Guids would break the
 * other way round: a cross-mount move mints a fresh one, while a rename is
 * something the shell can see and map (spike S9-Q4 — answered: per TAB,
 * paths, `rename` below). A path that vanished for any other reason is
 * dropped by `prune`.
 *
 * Pure and DOM-free so it is unit-testable (parent R6).
 */
const LIMIT = 100

export class NavHistory {
  private entries: string[] = []
  /** Index of the current entry; -1 when empty. */
  private at = -1

  /**
   * Record a navigation. Re-visiting the current path is a no-op; navigating
   * after going back TRUNCATES the forward branch, as every browser does.
   */
  push(path: string): void {
    if (this.entries[this.at] === path) return
    this.entries = this.entries.slice(0, this.at + 1)
    this.entries.push(path)
    if (this.entries.length > LIMIT) this.entries.shift()
    this.at = this.entries.length - 1
  }

  canGoBack(): boolean {
    return this.at > 0
  }

  canGoForward(): boolean {
    return this.at >= 0 && this.at < this.entries.length - 1
  }

  /** Step back and return the path to open, or null. */
  back(): string | null {
    if (!this.canGoBack()) return null
    this.at--
    return this.entries[this.at]
  }

  forward(): string | null {
    if (!this.canGoForward()) return null
    this.at++
    return this.entries[this.at]
  }

  /**
   * Repoint entries after a rename or move. Prefix-wise: renaming a FOLDER
   * moves every path under it, and the trail must survive that — it is the
   * same notes in the same order (spike S9-Q4). Positions are preserved, so
   * back/forward stays where it was.
   */
  rename(from: string, to: string): void {
    const prefix = `${from}/`
    this.entries = this.entries.map((p) =>
      p === from ? to : p.startsWith(prefix) ? `${to}/${p.slice(prefix.length)}` : p
    )
  }

  /** Drop entries for paths that no longer exist (deletes). */
  prune(live: ReadonlySet<string>): void {
    const current = this.entries[this.at]
    const kept = this.entries.filter((p) => live.has(p))
    this.entries = kept
    const found = current ? kept.indexOf(current) : -1
    this.at = found === -1 ? kept.length - 1 : found
  }

  /** Testing/devtools view. */
  snapshot(): { entries: string[]; at: number } {
    return { entries: [...this.entries], at: this.at }
  }
}
