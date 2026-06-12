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
  stat,
} from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { FileStat, VaultAdapter, WatchEvent } from './types.js'

const IGNORED = new Set(['.git', '.obsidian', '.editor-cache', 'node_modules'])

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

  async read(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.abs(path)))
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
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
