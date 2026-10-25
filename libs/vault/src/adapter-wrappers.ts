/**
 * Generic VaultAdapter views for the workspace-of-mounts shape (spike S8 Q4):
 *   - scopedAdapter: a mount's own window — the subtree at `prefix` addressed
 *     as if it were the vault root (every platform gets subtree mounts from
 *     one wrapper; no per-adapter work).
 *   - ignoringAdapter: the root mount's window — everything EXCEPT the mount
 *     roots in `ignored`, which their own sessions manage. The set is live:
 *     carve/join mutate it and the wrapper reads it on every call, so a
 *     session restart picks the change up without rebuilding adapters.
 */
import type { FileStat, VaultAdapter, WatchEvent, WriteOptions } from './types.js'

/** View of `base` rooted at `prefix` (a directory path, no trailing '/'). */
export function scopedAdapter(base: VaultAdapter, prefix: string): VaultAdapter {
  const pre = `${prefix}/`
  const inside = (path: string): boolean => path.startsWith(pre)
  const toRel = (path: string): string => path.slice(pre.length)
  const toAbs = (path: string): string => pre + path
  return {
    list: async () =>
      (await base.list()).filter((s) => inside(s.path)).map((s): FileStat => ({ ...s, path: toRel(s.path) })),
    listDirs: async () => (await base.listDirs()).filter(inside).map(toRel),
    read: (path) => base.read(toAbs(path)),
    // `opts` is forwarded, never swallowed: a wrapper that drops `expectHash`
    // turns every compare-and-swap under it into a blind write (S11 F1).
    writeAtomic: (path, bytes, opts?: WriteOptions) => base.writeAtomic(toAbs(path), bytes, opts),
    rename: (from, to) => base.rename(toAbs(from), toAbs(to)),
    remove: (path) => base.remove(toAbs(path)),
    mkdir: (path) => base.mkdir(toAbs(path)),
    removeDir: (path) => base.removeDir(toAbs(path)),
    renameDir: (from, to) => base.renameDir(toAbs(from), toAbs(to)),
    // `onError` is forwarded too: a wrapper that drops it hides a dead watcher.
    watch: (cb, onError) =>
      base.watch((ev: WatchEvent) => {
        const paths = ev.paths.filter(inside).map(toRel)
        if (paths.length > 0) cb({ paths })
      }, onError),
  }
}

/**
 * View of `base` that hides everything under the mount roots in `ignored`
 * (workspace-relative dir paths). Pass the LIVE set the workspace owns.
 */
export function ignoringAdapter(base: VaultAdapter, ignored: ReadonlySet<string>): VaultAdapter {
  const hidden = (path: string): boolean => {
    for (const root of ignored) {
      if (path === root || path.startsWith(`${root}/`)) return true
    }
    return false
  }
  return {
    hides: hidden,
    list: async () => (await base.list()).filter((s) => !hidden(s.path)),
    listDirs: async () => (await base.listDirs()).filter((d) => !hidden(d)),
    read: (path) => base.read(path),
    writeAtomic: (path, bytes, opts?: WriteOptions) => base.writeAtomic(path, bytes, opts),
    rename: (from, to) => base.rename(from, to),
    remove: (path) => base.remove(path),
    mkdir: (path) => base.mkdir(path),
    removeDir: (path) => base.removeDir(path),
    renameDir: (from, to) => base.renameDir(from, to),
    watch: (cb, onError) =>
      base.watch((ev: WatchEvent) => {
        const paths = ev.paths.filter((p) => !hidden(p))
        if (paths.length > 0) cb({ paths })
      }, onError),
  }
}
