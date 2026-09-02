/**
 * Most-recently-opened paths, per vault.
 *
 * This is quick-open's empty-query state, and it is doing more work than it
 * looks like: only 5% of the real vault (62 of 1,144 files) was touched in 90
 * days, so recency is the most predictive ranking signal available. Hitting
 * the switcher and finding the last ten files already listed is the common
 * case, not a fallback.
 *
 * Lives in localStorage beside the rest of the shell config, guarded the same
 * way — losing it costs nothing.
 */
const KEY = 'editor:recent'
const LIMIT = 30

type Store = Record<string, string[]>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // Private mode / disabled storage: recency degrades to "nothing remembered".
  }
}

/** Most recent first. */
export function recentPaths(room: string): string[] {
  return read()[room] ?? []
}

export function touchPath(room: string, path: string): void {
  const store = read()
  const list = [path, ...(store[room] ?? []).filter((p) => p !== path)].slice(0, LIMIT)
  store[room] = list
  write(store)
}

/** Keep the list honest after a rename or delete. */
export function forgetPath(room: string, path: string): void {
  const store = read()
  const list = store[room]
  if (!list) return
  store[room] = list.filter((p) => p !== path)
  write(store)
}
