/**
 * Per-workspace back/forward history.
 *
 * `Mod+[` / `Mod+]` are two of Chris's 18 Obsidian rebinds, and click-through
 * without a way back is a trap rather than a feature.
 *
 * History holds PATHS, not guids, because it is a record of "where I was
 * looking", and a path is what the user recognises. A rename therefore leaves
 * a stale entry — handled by dropping entries that no longer exist rather than
 * by tracking identity (spike S9-Q4 revisits this when panes each own a
 * history; guids would break the other way, since a cross-mount move mints a
 * fresh one).
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

  /** Drop entries for paths that no longer exist (deletes, renames). */
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
