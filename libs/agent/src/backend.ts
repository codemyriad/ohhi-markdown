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
import type { Clock } from '@editor/testkit'
import { MemoryIndex, type IndexDoc, type VaultIndex } from '@editor/index'
import {
  decodeFile,
  FileJournal,
  hashBytes,
  IGNORED_DIRS,
  looksBinary,
  type PreImageJournal,
  type VaultAdapter,
} from '@editor/vault'
import { NodeStoreDir, NodeVaultAdapter } from '@editor/vault/node'
import { OpError, type Coverage } from './contract.js'
import { vaultId } from './select-vault.js'

/** One file as the walk saw it. `kind` is the contract's, minus `dir`. */
export interface VaultFile {
  path: string
  size: number
  /** Epoch ms, or null when the platform would not say. */
  mtime: number | null
  kind: 'text' | 'binary'
}

export interface VaultBackend {
  /** Absolute, realpath'd. */
  readonly root: string
  readonly adapter: VaultAdapter
  readonly clock: Clock
  /** This tool's own journal — every write it makes is journaled here first. */
  readonly journal: PreImageJournal
  /** The app's journals, when the caller pointed at them: `restore`'s union. */
  readonly appJournals: readonly PreImageJournal[]
  /** Built once per process, cached. */
  index(): Promise<VaultIndex>
  /** path -> {guid, path, text} for every TEXT file. `guid` IS the path here. */
  docs(): Promise<ReadonlyMap<string, IndexDoc>>
  /** Every file, text and binary, with size/mtime. */
  files(): Promise<ReadonlyMap<string, VaultFile>>
  /** Every directory, deep, ignored ones excluded. */
  dirs(): Promise<readonly string[]>
  coverage(): Promise<Coverage>
  /**
   * What is at a vault path RIGHT NOW, ignored directories included.
   *
   * `files()`/`dirs()` cannot answer for `.trash/` — it is in `IGNORED_DIRS`,
   * so the adapter never lists it — and `rm` has to know whether the name it
   * is about to move onto is already taken.
   */
  exists(path: string): Promise<'file' | 'dir' | null>
  /** Milliseconds the index build took in this process (0 until it is built). */
  buildMs(): Promise<number>
}

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
  /** Pre-images kept per path in this tool's journal. Matches the app's 20. */
  retentionPerPath?: number
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
  const journal = new FileJournal(new NodeStoreDir(join(opts.dataDir, 'vaults', vaultId(root))), {
    now,
    retentionPerPath: opts.retentionPerPath ?? 20,
  })
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

/** Read a note's current bytes, decoded. Always from disk — never a cache. */
export async function readNote(
  backend: VaultBackend,
  path: string
): Promise<{ bytes: Uint8Array; text: string; eol: 'lf' | 'crlf' | 'raw'; bom: boolean; hash: string } | null> {
  const bytes = await backend.adapter.read(path)
  if (!bytes) return null
  const decoded = decodeFile(bytes)
  return { bytes, text: decoded.text, eol: decoded.eol, bom: decoded.bom, hash: hashBytes(bytes) }
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
