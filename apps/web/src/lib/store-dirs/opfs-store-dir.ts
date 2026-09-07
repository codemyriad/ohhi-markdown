/**
 * OPFS StoreDir: durable-store namespace under `stores/<sub>/` in the
 * Origin-Private File System (spike S8 layout; separate from the `vaults/`
 * content tree). Browser storage is best-effort durable — creation requests
 * `navigator.storage.persist()` once (denial is non-fatal; the relay remains
 * the browser's real backstop, spike S8 Risks).
 *
 * Handle traversal mirrors opfs-vault-adapter.ts (module-local there); a
 * successful `close()` commits the whole file — this store is the only
 * writer, so no temp+rename dance is needed (same rationale as the adapter).
 */
import type { StoreDir, StoreIo } from '@editor/vault'

const STORES_DIR = 'stores'

let persistRequested = false

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError'
}

function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter((p) => p.length > 0)
  const name = parts.pop() ?? ''
  return { dirs: parts, name }
}

export class OpfsStoreDir implements StoreDir {
  constructor(private root: FileSystemDirectoryHandle) {}

  private resolveDir(segments: string[], create: true): Promise<FileSystemDirectoryHandle>
  private resolveDir(segments: string[], create: false): Promise<FileSystemDirectoryHandle | null>
  private async resolveDir(
    segments: string[],
    create: boolean
  ): Promise<FileSystemDirectoryHandle | null> {
    let dir = this.root
    for (const seg of segments) {
      try {
        dir = await dir.getDirectoryHandle(seg, { create })
      } catch (err) {
        if (!create && isNotFound(err)) return null
        throw err
      }
    }
    return dir
  }

  io(name: string): StoreIo {
    const { dirs, name: base } = splitPath(name)
    return {
      read: async () => {
        const dir = await this.resolveDir(dirs, false)
        if (!dir) return null
        try {
          const fh = await dir.getFileHandle(base)
          const file = await fh.getFile()
          return new Uint8Array(await file.arrayBuffer())
        } catch (err) {
          if (isNotFound(err)) return null
          throw err
        }
      },
      writeAtomic: async (bytes) => {
        const dir = await this.resolveDir(dirs, true)
        const fh = await dir.getFileHandle(base, { create: true })
        const writable = await fh.createWritable()
        await writable.write(bytes as Uint8Array<ArrayBuffer>)
        await writable.close()
      },
    }
  }

  async remove(name: string): Promise<void> {
    const { dirs, name: base } = splitPath(name)
    const dir = await this.resolveDir(dirs, false)
    if (!dir) return
    try {
      await dir.removeEntry(base)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const out: string[] = []
    const walk = async (dir: FileSystemDirectoryHandle, rel: string): Promise<void> => {
      for await (const entry of dir.values()) {
        const path = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.kind === 'directory') await walk(entry as FileSystemDirectoryHandle, path)
        else out.push(path)
      }
    }
    await walk(this.root, '')
    const names = prefix ? out.filter((n) => n.startsWith(prefix)) : out
    return names.sort()
  }
}

/**
 * Resolve/create `stores/<sub>` under the OPFS root and wrap it in a
 * StoreDir. `sub` is the vault namespace (the root mount's room GUID).
 */
export async function createOpfsStoreDir(sub: string): Promise<OpfsStoreDir> {
  if (!persistRequested) {
    persistRequested = true
    void navigator.storage.persist?.().catch(() => {})
  }
  const opfsRoot = await navigator.storage.getDirectory()
  const stores = await opfsRoot.getDirectoryHandle(STORES_DIR, { create: true })
  const dir = await stores.getDirectoryHandle(sub, { create: true })
  return new OpfsStoreDir(dir)
}

/**
 * Delete the whole `stores/<sub>` namespace, directory included — the
 * forget-vault path (wipeStoreDir removes files; OPFS keeps empty directory
 * skeletons, so remove the dir itself). Missing namespace is a no-op.
 */
export async function destroyOpfsStoreDir(sub: string): Promise<void> {
  const opfsRoot = await navigator.storage.getDirectory()
  try {
    const stores = await opfsRoot.getDirectoryHandle(STORES_DIR)
    await stores.removeEntry(sub, { recursive: true })
  } catch (err) {
    if (isNotFound(err)) return
    throw err
  }
}
