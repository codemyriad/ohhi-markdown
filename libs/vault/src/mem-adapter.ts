/**
 * In-memory VaultAdapter: deterministic, synchronous storage with manual or
 * automatic watch emission. Used by L1 fuzz tests and the web demo mode.
 */
import {
  IGNORED_DIRS,
  WriteConflictError,
  type FileStat,
  type VaultAdapter,
  type WatchEvent,
  type WriteOptions,
} from './types.js'
import { hashBytes } from './hash.js'
import { AppDirListeners } from './app-dir.js'

/** Does any segment of `path` name an ignored directory? */
function ignored(path: string): boolean {
  return path.split('/').some((seg) => IGNORED_DIRS.has(seg))
}

export class MemVaultAdapter implements VaultAdapter {
  private files = new Map<string, Uint8Array>()
  /** Explicitly created directories; parents of files are implied (see listDirs). */
  private dirs = new Set<string>()
  private watchers = new Set<(ev: WatchEvent) => void>()
  private appDirs = new AppDirListeners()
  /** When true (default), mutations emit watch events automatically. */
  autoEmit = true

  async list(): Promise<FileStat[]> {
    return [...this.files.entries()]
      .filter(([path]) => !ignored(path))
      .map(([path, bytes]) => ({ path, size: bytes.length }))
  }

  async listDirs(): Promise<string[]> {
    // Real filesystems can't distinguish "explicit" dirs, so neither do we:
    // report explicit dirs plus every parent implied by a file or dir path.
    const out = new Set<string>(this.dirs)
    const addParents = (path: string): void => {
      const segs = path.split('/')
      for (let i = 1; i < segs.length; i++) out.add(segs.slice(0, i).join('/'))
    }
    for (const path of this.files.keys()) addParents(path)
    for (const dir of this.dirs) addParents(dir)
    return [...out].filter((d) => !ignored(d)).sort()
  }

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path)
    this.emit([path])
  }

  async removeDir(path: string): Promise<void> {
    const prefix = `${path}/`
    for (const p of this.files.keys()) {
      if (p.startsWith(prefix)) throw new Error(`removeDir: not empty ${path}`)
    }
    for (const d of this.dirs) {
      if (d.startsWith(prefix)) throw new Error(`removeDir: not empty ${path}`)
    }
    this.dirs.delete(path)
    this.emit([path])
  }

  async renameDir(from: string, to: string): Promise<void> {
    const prefix = `${from}/`
    const touched: string[] = []
    for (const [p, bytes] of [...this.files.entries()]) {
      if (p === from || p.startsWith(prefix)) {
        const np = to + p.slice(from.length)
        this.files.delete(p)
        this.files.set(np, bytes)
        touched.push(p, np)
      }
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(prefix)) {
        this.dirs.delete(d)
        this.dirs.add(to + d.slice(from.length))
      }
    }
    this.dirs.add(to)
    touched.push(from, to)
    this.emit(touched)
  }

  async read(path: string): Promise<Uint8Array | null> {
    const bytes = this.files.get(path)
    return bytes ? bytes.slice() : null
  }

  async writeAtomic(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    // Compare-and-swap (S11 F1) before the map is touched: in memory the swap
    // IS the rename, so this is the same "as late as possible" point the Node
    // adapter checks at, and a test that writes from inside a writeAtomic
    // wrapper exercises exactly the ordering the real adapter races against.
    if (opts?.expectHash !== undefined) {
      const current = this.files.get(path)
      const actual = current === undefined ? '' : hashBytes(current)
      if (actual !== opts.expectHash) throw new WriteConflictError(path, opts.expectHash, actual)
    }
    this.files.set(path, bytes.slice())
    this.emit([path])
  }

  async rename(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from)
    if (bytes === undefined) throw new Error(`rename: missing ${from}`)
    this.files.delete(from)
    this.files.set(to, bytes)
    this.emit([from, to])
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path)
    this.emit([path])
  }

  watch(cb: (ev: WatchEvent) => void): () => void {
    this.watchers.add(cb)
    return () => this.watchers.delete(cb)
  }

  async listAppDir(dir: string): Promise<string[]> {
    const prefix = `${dir.replace(/\/+$/, '')}/`
    return [...this.files.keys()]
      .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .sort()
  }

  async listAppDirs(dir: string): Promise<string[]> {
    const prefix = `${dir.replace(/\/+$/, '')}/`
    const out = new Set<string>()
    // A folder exists when it was made, or when something lives under it.
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (!p.startsWith(prefix)) continue
      const child = p.slice(prefix.length).split('/')[0]!
      const isDir = this.dirs.has(p) || p.slice(prefix.length).includes('/')
      if (child && isDir) out.add(`${prefix}${child}`)
    }
    return [...out].sort()
  }

  watchAppDir(dir: string, cb: (paths: string[]) => void): () => void {
    return this.appDirs.add(dir, cb)
  }

  /** Test hook: external writer that bypasses nothing — same as writeAtomic. */
  externalWrite(path: string, bytes: Uint8Array): void {
    this.files.set(path, bytes.slice())
    this.emit([path])
  }

  snapshotTexts(): Record<string, string> {
    const dec = new TextDecoder()
    return Object.fromEntries(
      [...this.files.entries()].map(([p, b]) => [p, dec.decode(b)])
    )
  }

  private emit(paths: string[]): void {
    if (!this.autoEmit) return
    this.deliver(paths)
  }

  /** Manual emission when autoEmit is off (batch simulation). */
  emitBatch(paths: string[]): void {
    this.deliver(paths)
  }

  /**
   * Same filter as the real adapters' watchers: a path under an ignored
   * directory never reaches `watch`; under a watched app dir it goes to that
   * listener instead (`watchAppDir`).
   */
  private deliver(paths: string[]): void {
    const vault = this.appDirs.route(paths)
    if (vault.length === 0) return
    for (const cb of this.watchers) cb({ paths: vault })
  }
}
