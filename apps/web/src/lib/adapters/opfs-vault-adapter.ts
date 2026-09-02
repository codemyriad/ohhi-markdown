/**
 * OPFS-backed VaultAdapter for the web shell.
 *
 * Stores each vault under its own subdirectory beneath the Origin-Private File
 * System root (`vaults/<vaultId>/…`), so multiple vaults coexist in one origin.
 * Paths are vault-relative POSIX strings; nested paths create intermediate
 * directories on write. Same contract/semantics as MemVaultAdapter and
 * NodeVaultAdapter (see @editor/vault) — mirror them when in doubt.
 */
import type { FileStat, VaultAdapter, WatchEvent } from '@editor/vault'

/** Container dir (under the OPFS root) that holds one subdirectory per vault. */
const VAULTS_DIR = 'vaults'

/** True for the DOMException browsers raise when a handle/entry is missing. */
function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'NotFoundError'
}

/** Split a POSIX vault-relative path into parent dir segments + basename. */
function splitPath(path: string): { dirs: string[]; name: string } {
  const parts = path.split('/').filter((p) => p.length > 0)
  const name = parts.pop() ?? ''
  return { dirs: parts, name }
}

export class OpfsVaultAdapter implements VaultAdapter {
  constructor(private root: FileSystemDirectoryHandle) {}

  /** Resolve the directory handle for a chain of segments beneath the root. */
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
        // A missing intermediate directory (no create) means the path is absent.
        if (!create && isNotFound(err)) return null
        throw err
      }
    }
    return dir
  }

  /** Resolve the file handle for a path, creating parent dirs when asked. */
  private fileHandle(path: string, create: true): Promise<FileSystemFileHandle>
  private fileHandle(path: string, create: false): Promise<FileSystemFileHandle | null>
  private async fileHandle(
    path: string,
    create: boolean
  ): Promise<FileSystemFileHandle | null> {
    const { dirs, name } = splitPath(path)
    if (create) {
      const dir = await this.resolveDir(dirs, true)
      return dir.getFileHandle(name, { create: true })
    }
    const dir = await this.resolveDir(dirs, false)
    if (!dir) return null
    try {
      return await dir.getFileHandle(name)
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async list(): Promise<FileStat[]> {
    const out: FileStat[] = []
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      // `.values()` yields the base FileSystemHandle type, so `kind` does not
      // narrow the union — cast to the concrete handle per entry.
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.kind === 'directory') {
          await walk(entry as FileSystemDirectoryHandle, path)
        } else {
          const file = await (entry as FileSystemFileHandle).getFile()
          out.push({ path, size: file.size })
        }
      }
    }
    await walk(this.root, '')
    return out
  }

  async read(path: string): Promise<Uint8Array | null> {
    const fh = await this.fileHandle(path, false)
    if (!fh) return null
    try {
      const file = await fh.getFile()
      return new Uint8Array(await file.arrayBuffer())
    } catch (err) {
      if (isNotFound(err)) return null
      throw err
    }
  }

  async writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
    const fh = await this.fileHandle(path, true)
    const writable = await fh.createWritable()
    // write() rejects SharedArrayBuffer-backed views at the type level; our
    // bytes are always plain-ArrayBuffer-backed, so assert the concrete type.
    await writable.write(bytes as Uint8Array<ArrayBuffer>)
    // OPFS is single-writer for us (this adapter is the only writer to its
    // vault — no cross-process/external writers ever touch OPFS), so a
    // successful close() commits the whole file: effectively atomic for our
    // use. No temp-file + rename dance is needed as it is on a real FS.
    await writable.close()
  }

  async rename(from: string, to: string): Promise<void> {
    // OPFS has no native rename — copy the bytes across, then drop the source.
    const bytes = await this.read(from)
    if (bytes === null) throw new Error(`rename: missing ${from}`)
    await this.writeAtomic(to, bytes)
    await this.remove(from)
  }

  async remove(path: string): Promise<void> {
    const { dirs, name } = splitPath(path)
    const dir = await this.resolveDir(dirs, false)
    if (!dir) return // parent path already gone → nothing to remove
    try {
      await dir.removeEntry(name)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }

  watch(_cb: (ev: WatchEvent) => void): () => void {
    // OPFS emits no change notifications, and this adapter is the ONLY writer to
    // its vault — no external editors, agents, or sync processes ever touch the
    // OPFS bytes directly. So there is nothing to observe and the reconciler's
    // external-ingest path legitimately never fires for an OPFS-backed vault.
    // Return a no-op disposer to satisfy the interface.
    return () => {}
  }
}

/**
 * Resolve/create `vaults/<vaultId>` under the OPFS root and wrap it in an
 * adapter. Both the `vaults` container and the id directory are created if
 * absent, so calling this for a fresh vault id just works.
 */
export async function createOpfsVaultAdapter(vaultId: string): Promise<OpfsVaultAdapter> {
  const opfsRoot = await navigator.storage.getDirectory()
  const vaults = await opfsRoot.getDirectoryHandle(VAULTS_DIR, { create: true })
  const dir = await vaults.getDirectoryHandle(vaultId, { create: true })
  return new OpfsVaultAdapter(dir)
}

/**
 * List the vault ids present under `vaults/` (directories only). Returns `[]`
 * when the `vaults` container does not exist yet (no vault ever created).
 */
export async function listOpfsVaults(): Promise<string[]> {
  const opfsRoot = await navigator.storage.getDirectory()
  let vaults: FileSystemDirectoryHandle
  try {
    vaults = await opfsRoot.getDirectoryHandle(VAULTS_DIR)
  } catch (err) {
    if (isNotFound(err)) return []
    throw err
  }
  const ids: string[] = []
  for await (const entry of vaults.values()) {
    if (entry.kind === 'directory') ids.push(entry.name)
  }
  return ids
}
