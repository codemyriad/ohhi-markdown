/**
 * `VaultBackend` — what an op is allowed to know about a vault (shaping A1).
 *
 * Ops never touch the filesystem, a clock or a journal directly; they are
 * given this. Today there is exactly one implementation, `createFilesBackend`
 * (files-direct: `NodeVaultAdapter` + `MemoryIndex` + a CLI-owned
 * `FileJournal`). When V3 lands agentd, an `AppBackend` over the running
 * workspace slots in behind the same interface and no op changes — which is
 * the whole reason the seam exists (shaping R3.1).
 *
 * Three laziness rules, each measured against the real vault (1,037 notes,
 * 3.0 MB; ~16 ms to read it all, ~250 ms to derive the index):
 *
 *  1. `files()` walks and classifies but does NOT derive. `ls` and `changes`
 *     stop here.
 *  2. `index()` derives on top of `files()`, once, cached. `search`, the link
 *     ops and `stats` need it; `read` does not, and a cold `ohhi read` that
 *     paid 250 ms to print 40 lines would be the opposite of context-frugal.
 *  3. Write ops re-read the target from disk rather than trusting either
 *     cache: reads must never be stale relative to disk (shaping R2), and a
 *     pre-image journaled from a cached copy would protect the wrong bytes.
 */
import { stat as fsStat, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import type { Clock } from '@ohhi/testkit'
import { MemoryIndex, type IndexDoc, type VaultIndex } from '@ohhi/index'
import { decodeFile, FileJournal, IGNORED_DIRS, looksBinary, type VaultAdapter } from '@ohhi/vault'
import { NodeStoreDir, NodeVaultAdapter } from '@ohhi/vault/node'
import { OpError } from './contract.js'
import type { VaultBackend, VaultFile } from './read.js'
import { vaultId } from './select-vault.js'

// The interface and the read helpers are browser-safe and live in `read.ts`;
// re-exported so a Node caller keeps one import.
export { openForRead, readNote, type VaultBackend, type VaultFile } from './read.js'

export interface FilesBackendOptions {
  /** Vault root. Resolved with `realpath` — symlinked roots get one identity. */
  root: string
  /** Where this tool keeps its own state: `<dataDir>/vaults/<id>/journal/…`. */
  dataDir: string
  clock: Clock
  /**
   * The app's per-mount store directories (`<appData>/stores/<room>`), read
   * ONLY — never written. `restore` lists their pre-images beside its own.
   */
  appStoreDirs?: string[]
}

interface Walk {
  files: Map<string, VaultFile>
  dirs: string[]
  docs: Map<string, IndexDoc>
  skippedBinary: number
}

/**
 * Files-direct backend: the canonical files ARE the source (shaping A, Fork 1).
 * No relay, no CRDT, no LCA — a running Editor ingests this tool's writes
 * through its own disk watcher (A11 / Spike S11).
 */
export async function createFilesBackend(opts: FilesBackendOptions): Promise<VaultBackend> {
  const root = await realpathDir(opts.root)
  const adapter = new NodeVaultAdapter(root)
  const now = (): number => opts.clock.now()
  // `FileJournal`'s own retention default (20 pre-images per path) is the
  // app's, and this tool keeps the same window on purpose.
  const journal = new FileJournal(new NodeStoreDir(join(opts.dataDir, 'vaults', vaultId(root))), { now })
  const appJournals = (opts.appStoreDirs ?? []).map(
    (dir) => new FileJournal(new NodeStoreDir(dir), { now })
  )

  let walked: Promise<Walk> | null = null
  let indexed: Promise<VaultIndex> | null = null
  let buildMs = 0

  const walk = (): Promise<Walk> => (walked ??= walkVault(adapter, root))

  const index = (): Promise<VaultIndex> =>
    (indexed ??= walk().then((w) => {
      const started = opts.clock.now()
      const memory = new MemoryIndex()
      memory.rebuild(w.docs.values())
      buildMs = Math.max(0, opts.clock.now() - started)
      return memory
    }))

  return {
    root,
    adapter,
    clock: opts.clock,
    journal,
    appJournals,
    index,
    docs: async () => (await walk()).docs,
    files: async () => (await walk()).files,
    dirs: async () => (await walk()).dirs,
    coverage: async () => {
      const w = await walk()
      return { docs: w.docs.size, skippedBinary: w.skippedBinary, ignored: [...IGNORED_DIRS].sort() }
    },
    exists: async (path) => {
      try {
        return (await fsStat(join(root, path))).isDirectory() ? 'dir' : 'file'
      } catch {
        return null
      }
    },
    buildMs: async () => {
      await index()
      return buildMs
    },
  }
}

async function realpathDir(root: string): Promise<string> {
  let resolved: string
  try {
    resolved = await realpath(root)
  } catch {
    throw new OpError('usage', `no such vault: ${root}`)
  }
  const stats = await fsStat(resolved)
  if (!stats.isDirectory()) throw new OpError('usage', `not a directory: ${root}`)
  return resolved
}

/**
 * One pass over the vault: list, stat, read, classify. The read is what makes
 * `skippedBinary` honest — an extension list alone calls a `.md` full of NULs
 * a note (`looksBinary` checks both, and it is the vault's own answer).
 */
async function walkVault(adapter: VaultAdapter, root: string): Promise<Walk> {
  const [stats, dirs] = await Promise.all([adapter.list(), adapter.listDirs()])
  const files = new Map<string, VaultFile>()
  const docs = new Map<string, IndexDoc>()
  let skippedBinary = 0
  // Chunked rather than one big Promise.all: a 1,000-note vault opened all at
  // once is an EMFILE waiting to happen, and serially it is three times slower.
  const CHUNK = 64
  for (let i = 0; i < stats.length; i += CHUNK) {
    const batch = await Promise.all(
      stats.slice(i, i + CHUNK).map(async (entry) => ({
        entry,
        bytes: await adapter.read(entry.path),
        mtime: await mtimeOf(join(root, entry.path)),
      }))
    )
    for (const { entry, bytes, mtime } of batch) {
      if (!bytes) continue
      const binary = looksBinary(entry.path, bytes)
      if (binary) skippedBinary++
      else docs.set(entry.path, { guid: entry.path, path: entry.path, text: decodeFile(bytes).text })
      files.set(entry.path, { path: entry.path, size: entry.size, mtime, kind: binary ? 'binary' : 'text' })
    }
  }
  return { files, dirs, docs, skippedBinary }
}

/** `FileStat` carries size but not mtime, and `changes`/`ls` both need it. */
async function mtimeOf(absolute: string): Promise<number | null> {
  try {
    return (await fsStat(absolute)).mtimeMs
  } catch {
    return null
  }
}
