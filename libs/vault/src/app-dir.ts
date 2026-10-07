/**
 * The routing half of `VaultAdapter.watchAppDir` (spike-resource-root Q1),
 * shared by every adapter that implements it: listeners per ignored app
 * directory, and the split of a raw watcher batch into "for the vault" and
 * "for an app-dir listener". A path under an ignored directory NEVER goes to
 * the vault side, listener or not — that is IGNORED_DIRS' guarantee.
 */
import { IGNORED_DIRS, isTempName } from './types.js'

export class AppDirListeners {
  private readonly subs = new Map<string, Set<(paths: string[]) => void>>()

  /** Subscribe to changes under `dir` (a top-level ignored directory, e.g. `.ohhi`). */
  add(dir: string, cb: (paths: string[]) => void): () => void {
    const key = dir.replace(/^\/+|\/+$/g, '')
    if (!IGNORED_DIRS.has(key.split('/')[0] ?? '')) {
      throw new Error(`watchAppDir is for an ignored app directory, not '${dir}'`)
    }
    let set = this.subs.get(key)
    if (!set) this.subs.set(key, (set = new Set()))
    set.add(cb)
    return () => {
      set.delete(cb)
      if (set.size === 0) this.subs.delete(key)
    }
  }

  /**
   * Split one batch of vault-relative paths: returns what the VAULT may see
   * (no ignored segment, no temp name) and hands every path under a
   * subscribed app directory to its listeners. Temp names (`.ohhi-tmp-`)
   * are dropped on both sides; the rename that ends a save is the event.
   */
  route(paths: readonly string[]): string[] {
    const vault: string[] = []
    const byDir = new Map<string, string[]>()
    for (const path of paths) {
      if (isTempName(path)) continue
      if (!path.split('/').some((seg) => IGNORED_DIRS.has(seg))) {
        vault.push(path)
        continue
      }
      for (const dir of this.subs.keys()) {
        if (path === dir || path.startsWith(`${dir}/`)) {
          const list = byDir.get(dir) ?? []
          list.push(path)
          byDir.set(dir, list)
        }
      }
    }
    for (const [dir, list] of byDir) {
      for (const cb of [...(this.subs.get(dir) ?? [])]) cb(list)
    }
    return vault
  }
}
