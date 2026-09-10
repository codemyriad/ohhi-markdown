/**
 * Node VaultAdapter for CLI tools and the nightly real-filesystem fuzz lane.
 * Atomic writes: temp file in the same directory + fsync + rename.
 * Import via '@editor/vault/node' (keeps the main entry browser-safe).
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
import { IGNORED_DIRS, type FileStat, type VaultAdapter, type WatchEvent } from './types.js'
import type { StoreIo } from './stores.js'
import type { StoreDir } from './store-dir.js'

/** Shared with every other adapter — see IGNORED_DIRS in types.ts. */
const IGNORED = IGNORED_DIRS

export class NodeVaultAdapter implements VaultAdapter {
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

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    const full = this.abs(path)
    await mkdir(dirname(full), { recursive: true })
    const tmp = `${full}.editor-tmp-${process.pid}-${Date.now()}` // clock-exempt: unique temp name, not timing logic
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(bytes)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fsRename(tmp, full)
  }

  async rename(from: string, to: string): Promise<void> {
    const dest = this.abs(to)
    await mkdir(dirname(dest), { recursive: true })
    await fsRename(this.abs(from), dest)
  }

  async remove(path: string): Promise<void> {
    await rm(this.abs(path), { force: true })
  }

  watch(cb: (ev: WatchEvent) => void): () => void {
    const watcher = watch(this.root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const path = filename.split(sep).join('/')
      if (path.split('/').some((seg) => IGNORED.has(seg))) return
      if (path.includes('.editor-tmp-')) return
      cb({ paths: [path] })
    })
    return () => watcher.close()
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
        const tmp = `${full}.editor-tmp-${process.pid}-${Date.now()}` // clock-exempt: unique temp name, not timing logic
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
        else if (!entry.name.includes('.editor-tmp-')) {
          out.push(relative(this.root, full).split(sep).join('/'))
        }
      }
    }
    await walk(this.root)
    const names = prefix ? out.filter((n) => n.startsWith(prefix)) : out
    return names.sort()
  }
}
