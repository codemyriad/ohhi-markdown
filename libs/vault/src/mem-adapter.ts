/**
 * In-memory VaultAdapter: deterministic, synchronous storage with manual or
 * automatic watch emission. Used by L1 fuzz tests and the web demo mode.
 */
import type { FileStat, VaultAdapter, WatchEvent } from './types.js'

export class MemVaultAdapter implements VaultAdapter {
  private files = new Map<string, Uint8Array>()
  private watchers = new Set<(ev: WatchEvent) => void>()
  /** When true (default), mutations emit watch events automatically. */
  autoEmit = true

  async list(): Promise<FileStat[]> {
    return [...this.files.entries()].map(([path, bytes]) => ({
      path,
      size: bytes.length,
    }))
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
