/**
 * Enrollment: bring a folder under management. Seeder path mints GUIDs and
 * seeds docs ONCE (one-time insertion guard = non-empty folder map);
 * joiner path binds relay state to a clean local folder (single-seeder rule,
 * V1 — Spike S1 will replace this with a real join state machine).
 */
import type { EngineDoc, SyncEngine } from '@ohhi/sync'
import { decodeFile } from './eol.js'
import { hashBytes } from './hash.js'
import type { LcaStore, VaultAdapter } from './types.js'

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'ico', 'pdf', 'zip', 'gz',
  'mp3', 'mp4', 'mov', 'webm', 'woff', 'woff2', 'ttf', 'xlsx', 'docx', 'pptx',
])

/** Hash recorded for files that have never existed on disk yet. */
export const NEVER_ON_DISK = ''

export function looksBinary(path: string, bytes: Uint8Array): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (BINARY_EXTENSIONS.has(ext)) return true
  const probe = bytes.subarray(0, 8192)
  return probe.includes(0)
}

/** Suffixes other tools give the files they are still writing or keep beside one. */
const SCRATCH_SUFFIXES = ['.swp', '.swx', '.tmp', '.part', '.partial', '.crdownload']

/**
 * A name another tool uses for a file it is still writing, or keeps beside
 * the real one: an editor's swap file (`.note.md.swp`), a sync client's or
 * browser's partial download (`.syncthing.note.md.tmp`, `note.md.part`,
 * `x.crdownload`), a backup (`note.md~`), Finder's `.DS_Store`. Live
 * enrol-on-create skips these: a note that appears while the app runs is
 * enrolled from the watcher, and enrolling a scratch file would sync it to
 * every peer. A dot-prefixed basename counts as scratch, a dot-prefixed
 * folder above it does not. The boot scan does not apply this rule.
 */
export function isScratchName(path: string): boolean {
  const base = path.slice(path.lastIndexOf('/') + 1)
  if (base.startsWith('.') || base.endsWith('~')) return true
  const lower = base.toLowerCase()
  return SCRATCH_SUFFIXES.some((s) => lower.endsWith(s))
}

export interface EnrollResult {
  docs: Map<string, EngineDoc>
  /** Paths detected as binary: excluded from sync, badged in the UI (D2f). */
  binaries: string[]
}

export async function enrollFolder(
  engine: SyncEngine,
  adapter: VaultAdapter,
  folderDoc: EngineDoc,
  lcaStore: LcaStore,
  newGuid: () => string = () => crypto.randomUUID()
): Promise<EnrollResult> {
  if (folderDoc.getMap().entries().length > 0) {
    throw new Error(
      'folder doc already seeded — join instead of enrolling (single-seeder rule)'
    )
  }
  const docs = new Map<string, EngineDoc>()
  const binaries: string[] = []

  for (const stat of await adapter.list()) {
    const bytes = await adapter.read(stat.path)
    if (bytes === null) continue
    if (looksBinary(stat.path, bytes)) {
      binaries.push(stat.path)
      folderDoc.transactMap(
        (m) => m.set(stat.path, { guid: newGuid(), kind: 'binary' }),
        'seed'
      )
      continue
    }
    const guid = newGuid()
    const decoded = decodeFile(bytes)
    const doc = engine.createDoc(guid)
    doc.transact((t) => t.insert(0, decoded.text), 'seed')
    folderDoc.transactMap((m) => m.set(stat.path, { guid, kind: 'text' }), 'seed')
    await lcaStore.put({
      guid,
      path: stat.path,
      baseText: decoded.text,
      contentHash: hashBytes(bytes),
      heads: engine.encodeHeads(engine.heads(doc)),
      eol: decoded.eol,
      bom: decoded.bom,
    })
    docs.set(guid, doc)
  }
  // Directories are first-class map entries (M3): every dir enrolls — not just
  // empty ones — so the map is the full tree authority and renames/deletes
  // have an entry to rewrite. No Y.Doc, no LCA, no provider.
  for (const dir of await adapter.listDirs()) {
    folderDoc.transactMap((m) => m.set(dir, { guid: newGuid(), kind: 'dir' }), 'seed')
  }
  return { docs, binaries }
}

export interface JoinProblem {
  path: string
  reason: 'disk-differs-from-remote'
}

/**
 * Joiner: folderDoc (and per-file docs) already carry remote state.
 * Local folder must be empty or hold byte-identical copies (e.g. a fresh
 * git clone). Anything else is reported, not merged — V1 conservatism.
 */
export async function joinFolder(
  engine: SyncEngine,
  adapter: VaultAdapter,
  folderDoc: EngineDoc,
  docs: Map<string, EngineDoc>,
  lcaStore: LcaStore
): Promise<{ problems: JoinProblem[] }> {
  const problems: JoinProblem[] = []
  for (const [path, entry] of folderDoc.getMap().entries()) {
    if (entry.kind !== 'text' || entry.deleted) continue
    const doc = docs.get(entry.guid)
    if (!doc) continue
    const diskBytes = await adapter.read(path)
    if (diskBytes === null) {
      // Clean folder: LCA says "never on disk"; the session materializes it.
      const tmp = engine.createDoc(`${entry.guid}:empty-baseline`)
      const emptyHeads = engine.heads(tmp)
      tmp.destroy()
      await lcaStore.put({
        guid: entry.guid,
        path,
        baseText: '',
        contentHash: NEVER_ON_DISK,
        heads: engine.encodeHeads(emptyHeads),
        eol: 'lf',
        bom: false,
      })
      continue
    }
    const decoded = decodeFile(diskBytes)
    if (decoded.text === doc.getText()) {
      await lcaStore.put({
        guid: entry.guid,
        path,
        baseText: decoded.text,
        contentHash: hashBytes(diskBytes),
        heads: engine.encodeHeads(engine.heads(doc)),
        eol: decoded.eol,
        bom: decoded.bom,
      })
    } else {
      problems.push({ path, reason: 'disk-differs-from-remote' })
    }
  }
  return { problems }
}
