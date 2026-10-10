/**
 * Fake resource roots for tests (quiet-shell F8): a vault's `.ohhi/` app
 * files over a map (recording every write, firing the change feed like the
 * workspace does), and a user root over a map of layouts.
 */
import type { ResourceRoot, VaultAppFiles } from './resources.svelte.js'

export function fakeVault(files: Record<string, unknown> = {}) {
  const disk = new Map(Object.entries(files).map(([p, v]) => [p, typeof v === 'string' ? v : JSON.stringify(v)]))
  const writes: string[] = []
  const feeds = new Set<{ prefix: string; cb: (paths: string[]) => void }>()
  const vault: VaultAppFiles = {
    readAppFile: async (path) => disk.get(path) ?? null,
    listAppDir: async (dir) => [...disk.keys()].filter((p) => p.startsWith(`${dir}/`)).sort(),
    writeAppFile: async (path, text) => {
      writes.push(path)
      disk.set(path, text)
    },
    deleteAppFile: async (path) => {
      writes.push(`-${path}`)
      disk.delete(path)
    },
    onAppFileChange: (prefix, cb) => {
      const entry = { prefix, cb }
      feeds.add(entry)
      return () => feeds.delete(entry)
    },
  }
  /** What the workspace's watcher would report: these paths changed on disk. */
  const touch = (...paths: string[]): void => {
    for (const { prefix, cb } of [...feeds]) {
      const mine = paths.filter((p) => p.startsWith(prefix))
      if (mine.length > 0) cb(mine)
    }
  }
  return { vault, disk, writes, touch, feeds }
}

/** `~/.config/ohhi/layouts/` over a map of file name → content. */
export function fakeUserRoot(files: Record<string, unknown>): ResourceRoot {
  return {
    id: 'user',
    base: '~/.config/ohhi',
    location: (kind) => `~/.config/ohhi/${kind}`,
    list: async (kind) => Object.keys(files).filter((f) => kind === 'layouts' && f.endsWith('.json')),
    read: async (kind, file) => (kind === 'layouts' && file in files ? JSON.stringify(files[file]) : null),
  }
}
