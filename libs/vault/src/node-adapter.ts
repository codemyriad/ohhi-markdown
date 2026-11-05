/**
 * Node VaultAdapter for CLI tools and the nightly real-filesystem fuzz lane.
 * Atomic writes: temp file in the same directory + fsync + rename.
 * Import via '@ohhi/vault/node' (keeps the main entry browser-safe).
 */
import { watch } from 'node:fs'
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename as fsRename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import {
  IGNORED_DIRS,
  isTempName,
  TEMP_INFIX,
  WriteConflictError,
  type FileStat,
  type VaultAdapter,
  type WatchEvent,
  type WriteOptions,
} from './types.js'
import { hashBytes } from './hash.js'
import { AppDirListeners } from './app-dir.js'
import type { StoreIo } from './stores.js'
import type { StoreDir } from './store-dir.js'

/** Shared with every other adapter — see IGNORED_DIRS in types.ts. */
const IGNORED = IGNORED_DIRS

export class NodeVaultAdapter implements VaultAdapter {
  private appDirs = new AppDirListeners()

  constructor(private root: string) {}

  private abs(path: string): string {
    const full = join(this.root, path)
    if (relative(this.root, full).startsWith('..')) {
      throw new Error(`path escapes vault: ${path}`)
    }
    return full
  }

  async list(): Promise<FileStat[]> {
    const out: FileStat[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (IGNORED.has(entry.name)) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else {
          const s = await stat(full)
          out.push({ path: relative(this.root, full).split(sep).join('/'), size: s.size })
        }
      }
    }
    await walk(this.root)
    return out
  }

  async listDirs(): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (IGNORED.has(entry.name)) continue
        if (!entry.isDirectory()) continue
        const full = join(dir, entry.name)
        out.push(relative(this.root, full).split(sep).join('/'))
        await walk(full)
      }
    }
    await walk(this.root)
    return out.sort()
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this.abs(path), { recursive: true })
  }

  async removeDir(path: string): Promise<void> {
    try {
      await rmdir(this.abs(path)) // refuses non-empty (ENOTEMPTY) by design
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
  }

  async renameDir(from: string, to: string): Promise<void> {
    const dest = this.abs(to)
    await mkdir(dirname(dest), { recursive: true })
    await fsRename(this.abs(from), dest)
  }

  async read(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.abs(path)))
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      // EISDIR: the path is a directory — unreadable as a file, so null (the
      // watcher hands dir paths to the same quiesce reads as files).
      if (code === 'ENOENT' || code === 'EISDIR') return null
      throw err
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    const tmp = `${full}${TEMP_INFIX}${process.pid}-${Date.now()}` // clock-exempt: unique temp name, not timing logic
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    // Compare-and-swap (S11 F1): the destination is re-read and re-hashed HERE,
    // with the durable temp file already on disk, so the only remaining gap is
    // the rename syscall itself — as narrow as a userspace writer can make it.
    if (opts?.expectHash !== undefined) {
      const actual = await this.hashOf(path)
      if (actual !== opts.expectHash) {
        await rm(tmp, { force: true })
        throw new WriteConflictError(path, opts.expectHash, actual)
      }
    }
    await fsRename(tmp, full)
  }

  /** Content hash of what is at `path` right now; `''` when nothing is. */
  private async hashOf(path: string): Promise<string> {
    const current = await this.read(path)
    return current === null ? '' : hashBytes(current)
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = this.abs(to)
    await mkdir(dirname(dest), { recursive: true })
    await fsRename(this.abs(from), dest)
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { force: true })
  }

  watch(cb: (ev: WatchEvent) => void, onError?: (err: unknown) => void): () => void {
    let watcher: ReturnType<typeof watch>
    try {
      watcher = watch(this.root, { recursive: true }, (_event, filename) => {
        if (!filename) return
        // Ignored dirs and temp names never reach `cb`; a path under a
        // `watchAppDir` directory goes to that listener instead (S20 Q1).
        const paths = this.appDirs.route([filename.split(sep).join('/')])
        if (paths.length) cb({ paths })
      })
    } catch (err) {
      // No listener: the historical throw, so a caller that never asked still hears it.
      if (!onError) throw err
      onError(err)
      return () => {}
    }
    // A watcher that dies later (the root removed, a platform limit hit)
    // emits 'error'; reported, rather than thrown out of the event loop.
    if (onError) watcher.on('error', onError)
    return () => watcher.close()
  }

  async listAppDir(dir: string): Promise<string[]> {
    const rel = dir.replace(/\/+$/, '')
    let entries
    try {
      entries = await readdir(this.abs(rel), { withFileTypes: true })
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return []
      throw err
    }
    return entries
      .filter((e) => e.isFile() && !isTempName(e.name))
      .map((e) => `${rel}/${e.name}`)
      .sort()
  }

  async listAppDirs(dir: string): Promise<string[]> {
    const rel = dir.replace(/\/+$/, '')
    let entries
    try {
      entries = await readdir(this.abs(rel), { withFileTypes: true })
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return []
      throw err
    }
    return entries
      .filter((e) => e.isDirectory() && !isTempName(e.name))
      .map((e) => `${rel}/${e.name}`)
      .sort()
  }

  watchAppDir(dir: string, cb: (paths: string[]) => void): () => void {
    return this.appDirs.add(dir, cb)
  }
}

/**
 * Node StoreDir (spike S8 durable-store layout) for the headless peer and the
 * nightly real-filesystem lane. Same temp+fsync+rename write discipline as
 * NodeVaultAdapter above.
 */
export class NodeStoreDir implements StoreDir {
  constructor(private root: string) {}

  private abs(name: string): string {
    const full = join(this.root, name)
    if (relative(this.root, full).startsWith('..')) {
      throw new Error(`name escapes store dir: ${name}`)
    }
    return full
  }

  io(name: string): StoreIo {
    const full = this.abs(name)
    return {
      read: async () => {
        try {
          return new Uint8Array(await readFile(full))
        } catch (err: unknown) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw err
        }
      },
      writeAtomic: async (bytes) => {
        await mkdir(dirname(full), { recursive: true })
        const tmp = `${full}${TEMP_INFIX}${process.pid}-${Date.now()}` // clock-exempt: unique temp name, not timing logic
        const handle = await open(tmp, 'w')
        try {
          await handle.writeFile(bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        await fsRename(tmp, full)
      },
      binding: { dir: this, name },
    }
  }

  async remove(name: string): Promise<void> {
    await rm(this.abs(name), { force: true })
  }

  async list(prefix?: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
        throw err
      }
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (!isTempName(entry.name)) {
          out.push(relative(this.root, full).split(sep).join('/'))
        }
      }
    }
    await walk(this.root)
    const names = prefix ? out.filter((n) => n.startsWith(prefix)) : out
    return names.sort()
  }
}
