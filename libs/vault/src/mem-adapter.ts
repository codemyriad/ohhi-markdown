/**
 * In-memory VaultAdapter: deterministic, synchronous storage with manual or
 * automatic watch emission. Used by L1 fuzz tests and the web demo mode.
 */
import type { FileStat, VaultAdapter, WatchEvent } from './types.js'

export class MemVaultAdapter implements VaultAdapter {
  private files = new Map<string, Uint8Array>()
  /** Explicitly created directories; parents of files are implied (see listDirs). */
  private dirs = new Set<string>()
  private watchers = new Set<(ev: WatchEvent) => void>()
  /** When true (default), mutations emit watch events automatically. */
  autoEmit = true

  async list(): Promise<FileStat[]> {
    return [...this.files.entries()].map(([path, bytes]) => ({
      path,
      size: bytes.length,
    }))
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
    return [...out].sort()
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

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
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
    for (const cb of this.watchers) cb({ paths })
  }

  /** Manual emission when autoEmit is off (batch simulation). */
  emitBatch(paths: string[]): void {
    for (const cb of this.watchers) cb({ paths })
  }
}
