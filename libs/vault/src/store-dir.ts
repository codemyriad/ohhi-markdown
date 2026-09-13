/**
 * StoreDir: a named collection of StoreIo files — the durable-store namespace
 * for one vault (spike S8 layout: `mounts.json`, `<room>/lca/<guid>.json`,
 * `<room>/docs/<guid>.bin`, `<room>/journal/…`). Names are '/'-separated
 * relative paths. Implementations: MemStoreDir (tests), NodeStoreDir
 * ('@ohhi/vault/node'), TauriStoreDir / OpfsStoreDir (apps/web).
 *
 * `io(name)` MUST return an io carrying `binding: { dir: this, name }` —
 * stores that address sibling files (the per-record LCA store) recover their
 * namespace from it. A WRAPPER StoreDir that rebuilds the io object must
 * forward a binding naming ITSELF, or writes it means to count/fail will be
 * routed past it (see `StoreIo.binding` in stores.ts).
 */
import type { StoreIo } from './stores.js'

export interface StoreDir {
  /** StoreIo bound to one named file in this store. */
  io(name: string): StoreIo
  /** Remove one named file; missing names are a no-op. */
  remove(name: string): Promise<void>
  /**
   * Names currently present, filtered by raw string prefix (callers pass a
   * trailing '/' to mean "under this directory", e.g. `${room}/`).
   */
  list(prefix?: string): Promise<string[]>
}

/**
 * View of a StoreDir under a fixed prefix — the per-mount namespace inside a
 * vault's store dir (spike S8 layout: pass `${room}/` so consumers address
 * `lca.json`, `docs/<guid>.bin`, … without knowing their room). Every write
 * still goes through `base` — and through whatever wrapper `base` is.
 */
export function scopedStoreDir(base: StoreDir, prefix: string): StoreDir {
  const scoped: StoreDir = {
    io: (name) => {
      const io = base.io(prefix + name)
      // Binding names the VIEW, not the base: a store that reaches for sibling
      // files gets prefix-relative names back and still writes through `base`
      // (and through any wrapper `base` happens to be).
      return {
        read: () => io.read(),
        writeAtomic: (bytes) => io.writeAtomic(bytes),
        binding: { dir: scoped, name },
      }
    },
    remove: (name) => base.remove(prefix + name),
    list: async (p?: string) =>
      (await base.list(prefix + (p ?? ''))).map((n) => n.slice(prefix.length)),
  }
  return scoped
}

/**
 * Delete every file under a namespace (`prefix` with a trailing '/', or the
 * entire dir with no prefix). The store namespace is derived state over
 * canonical disk files, so wiping it is always safe — a reopen re-enrolls
 * fresh. A missing namespace is a no-op. Returns the number of files removed.
 */
export async function wipeStoreDir(dir: StoreDir, prefix = ''): Promise<number> {
  const names = await dir.list(prefix)
  for (const name of names) await dir.remove(name)
  return names.length
}

export class MemStoreDir implements StoreDir {
  private files = new Map<string, Uint8Array>()

  io(name: string): StoreIo {
    return {
      read: async () => {
        const bytes = this.files.get(name)
        return bytes ? bytes.slice() : null
      },
      writeAtomic: async (bytes) => {
        this.files.set(name, bytes.slice())
      },
      binding: { dir: this, name },
    }
  }

  async remove(name: string): Promise<void> {
    this.files.delete(name)
  }

  async list(prefix?: string): Promise<string[]> {
    const names = [...this.files.keys()]
    return (prefix ? names.filter((n) => n.startsWith(prefix)) : names).sort()
  }
}
