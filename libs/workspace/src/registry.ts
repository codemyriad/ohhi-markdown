/**
 * MountRegistry: a workspace is a set of mounts — subtrees each bound to a
 * room (dogfood-shaping shape B). Files belong to exactly one mount; lookups
 * resolve a workspace path to the owning mount by longest-prefix match.
 *
 * V1 boots with exactly one root mount (path ''), so behavior matches the
 * single-vault shell; carve/join wiring (spike S8 Q1/Q4) adds more later.
 */
import type { MountSession } from './mount-session.js'
import type { FileRow } from './types.js'

export interface MountHandle {
  /** Workspace-relative mount root; '' is the root mount. */
  mountPath: string
  session: MountSession
}

export interface ResolvedPath extends MountHandle {
  /** The path relative to the mount root (what the session understands). */
  rel: string
}

export class MountRegistry {
  private mounts = new Map<string, MountSession>()

  add(mountPath: string, session: MountSession): void {
    if (this.mounts.has(mountPath)) throw new Error(`mount already registered at '${mountPath}'`)
    for (const existing of this.mounts.keys()) {
      if (nests(existing, mountPath)) {
        throw new Error(`mounts may not nest: '${mountPath}' vs existing '${existing}'`)
      }
    }
    this.mounts.set(mountPath, session)
  }

  remove(mountPath: string): void {
    this.mounts.delete(mountPath)
  }

  all(): MountHandle[] {
    return [...this.mounts.entries()].map(([mountPath, session]) => ({ mountPath, session }))
  }

  /** Longest-prefix owner of a workspace path, with the mount-relative rest. */
  resolve(path: string): ResolvedPath | null {
    let best: string | null = null
    for (const mountPath of this.mounts.keys()) {
      if (!owns(mountPath, path)) continue
      if (best === null || mountPath.length > best.length) best = mountPath
    }
    if (best === null) return null
    const session = this.mounts.get(best)!
    return { mountPath: best, session, rel: best === '' ? path : path.slice(best.length + 1) }
  }

  /** Merged rows across mounts, paths prefixed back into workspace space. */
  files(): FileRow[] {
    const rows: FileRow[] = []
    for (const [mountPath, session] of this.mounts) {
      for (const row of session.files()) {
        rows.push(mountPath === '' ? row : { ...row, path: `${mountPath}/${row.path}` })
      }
    }
    return rows.sort((a, b) => a.path.localeCompare(b.path))
  }

  dispose(): void {
    for (const session of this.mounts.values()) session.dispose()
    this.mounts.clear()
  }
}

/** Does the mount at `mountPath` own `path`? Root ('') owns everything. */
function owns(mountPath: string, path: string): boolean {
  return mountPath === '' || path === mountPath || path.startsWith(`${mountPath}/`)
}

/** Would two mount roots overlap (one inside the other)? Root nests nothing. */
function nests(a: string, b: string): boolean {
  if (a === '' || b === '') return false // root + subtree mounts coexist (root ignores mount roots)
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}
