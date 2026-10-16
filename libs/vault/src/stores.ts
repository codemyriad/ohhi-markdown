/**
 * Durable-store v0 implementations. The LCA store and pre-image journal live
 * in app-data (NEVER the vault, NEVER droppable cache storage — shaping D5).
 * SQLite would sit behind the same interfaces if the durable side ever needed
 * it — not scheduled: the V2 index decision (v2-shaping Fork 1)
 * deferred SQLite entirely, behind a measured trigger, and that trigger is
 * about the DROPPABLE index, not this.
 *
 * LCA layout — ONE FILE PER RECORD (`lca/<guid>.json`), not one per mount. An
 * LcaRecord carries a full `baseText` shadow of its note, so the old single
 * `lca.json` rewrote the whole corpus on every put: spike S10-Q4 measured
 * 4,116 rewrites / 5.6 GB of fsynced writes to reproduce a 3.08 MB vault,
 * quadratic in note count (130 GB at 5,000 notes). Per record, `put` costs
 * O(|rec|). A legacy `lca.json` is split into per-record files on first open.
 */
import type {
  JournalEntry,
  JournalEntryInfo,
  LcaRecord,
  LcaStore,
  PreImageJournal,
} from './types.js'
import type { StoreDir } from './store-dir.js'

/** Where a StoreIo came from — see `StoreIo.binding`. */
export interface StoreIoBinding {
  dir: StoreDir
  name: string
}

export interface StoreIo {
  read(): Promise<Uint8Array | null>
  writeAtomic(bytes: Uint8Array): Promise<void>
  /**
   * The dir this io was opened from and the name it was opened under. Every
   * `StoreDir.io()` implementation sets it; it lets a store that needs
   * SIBLING files (the LCA store's per-record layout) recover its namespace
   * from a plain io, so `new JsonFileLcaStore(dir.io('lca.json'))` keeps
   * working unchanged. A wrapper StoreDir that rebuilds the io object must
   * forward a binding pointing at ITSELF, so its own crash injection / write
   * counting still sees the writes; one that does not gets the legacy
   * whole-file layout — correct, but it rewrites every record on every put.
   */
  readonly binding?: StoreIoBinding
}

export class MemLcaStore implements LcaStore {
  private records = new Map<string, LcaRecord>()

  async get(guid: string): Promise<LcaRecord | null> {
    return this.records.get(guid) ?? null
  }
  async put(rec: LcaRecord): Promise<void> {
    this.records.set(rec.guid, { ...rec, heads: rec.heads.slice() })
  }
  async remove(guid: string): Promise<void> {
    this.records.delete(guid)
  }
  async all(): Promise<LcaRecord[]> {
    return [...this.records.values()]
  }
}

interface SerializedLca extends Omit<LcaRecord, 'heads'> {
  headsB64: string
}

/** Per-record files under `prefix`; `legacyName` is split in on first open. */
interface PerRecordLayout {
  kind: 'per-record'
  dir: StoreDir
  prefix: string
  legacyName: string
}

/** One JSON array in one file — only reachable through an unbound StoreIo. */
interface SingleFileLayout {
  kind: 'single-file'
  io: StoreIo
}

type Layout = PerRecordLayout | SingleFileLayout

/** Record files read in parallel batches at open (fd ceiling vs. latency). */
const READ_BATCH = 64

function isStoreDir(target: StoreIo | StoreDir): target is StoreDir {
  return typeof (target as StoreDir).io === 'function'
}

function withSlash(prefix: string): string {
  return prefix.endsWith('/') ? prefix : `${prefix}/`
}

/** `<room>/lca.json` → `<room>/lca/`: the per-record namespace beside it. */
function prefixFor(name: string): string {
  return withSlash(name.replace(/\.json$/i, ''))
}

/**
 * LCA store over a StoreDir, one small JSON file per record.
 *
 * Accepts either the StoreDir itself (`new JsonFileLcaStore(dir)`, preferred)
 * or the `dir.io('lca.json')` the older call sites pass — a bound io names its
 * dir, so those get the per-record layout with no change. An io from a wrapper
 * that drops the binding keeps the pre-S10 single-file layout.
 */
export class JsonFileLcaStore implements LcaStore {
  private cache: Map<string, LcaRecord> | null = null
  private loading: Promise<Map<string, LcaRecord>> | null = null
  private readonly layout: Layout

  constructor(target: StoreIo | StoreDir, opts?: { prefix?: string; legacyName?: string }) {
    const binding = isStoreDir(target) ? { dir: target, name: 'lca.json' } : target.binding
    if (!binding) {
      this.layout = { kind: 'single-file', io: target as StoreIo }
      return
    }
    const legacyName = opts?.legacyName ?? binding.name
    this.layout = {
      kind: 'per-record',
      dir: binding.dir,
      prefix: opts?.prefix ? withSlash(opts.prefix) : prefixFor(legacyName),
      legacyName,
    }
  }

  private ensure(): Promise<Map<string, LcaRecord>> {
    if (this.cache) return Promise.resolve(this.cache)
    this.loading ??= this.loadOnce().then(
      (map) => {
        this.cache = map
        this.loading = null
        return map
      },
      (err: unknown) => {
        this.loading = null
        throw err
      }
    )
    return this.loading
  }

  private async loadOnce(): Promise<Map<string, LcaRecord>> {
    const layout = this.layout
    const map = new Map<string, LcaRecord>()
    if (layout.kind === 'single-file') {
      for (const s of parseList(await layout.io.read())) map.set(s.guid, deserialize(s))
      return map
    }

    const names = (await layout.dir.list(layout.prefix)).filter((n) => n.endsWith('.json'))
    for (let i = 0; i < names.length; i += READ_BATCH) {
      const batch = await Promise.all(
        names.slice(i, i + READ_BATCH).map((name) => layout.dir.io(name).read())
      )
      for (const bytes of batch) {
        if (!bytes) continue
        const rec = deserialize(JSON.parse(decode(bytes)) as SerializedLca)
        map.set(rec.guid, rec)
      }
    }

    // Legacy single-file store (pre-S10): split it into per-record files, then
    // drop it LAST. A crash mid-split re-runs harmlessly on the next open — a
    // guid present in both wins from its per-record file, which is at least as
    // new (the split only ever writes records the per-record side is missing).
    const legacyBytes = await layout.dir.io(layout.legacyName).read()
    if (legacyBytes !== null) {
      for (const s of parseList(legacyBytes)) {
        if (map.has(s.guid)) continue
        const rec = deserialize(s)
        await writeRecord(layout, rec)
        map.set(rec.guid, rec)
      }
      await layout.dir.remove(layout.legacyName)
    }
    return map
  }

  async get(guid: string): Promise<LcaRecord | null> {
    return (await this.ensure()).get(guid) ?? null
  }

  async put(rec: LcaRecord): Promise<void> {
    const layout = this.layout
    const map = await this.ensure()
    if (layout.kind === 'per-record') {
      await writeRecord(layout, rec) // durable before the cache claims it
      map.set(rec.guid, rec)
      return
    }
    map.set(rec.guid, rec)
    await persistSingleFile(layout, map)
  }

  async remove(guid: string): Promise<void> {
    const layout = this.layout
    const map = await this.ensure()
    if (layout.kind === 'per-record') {
      await layout.dir.remove(recordName(layout, guid))
      map.delete(guid)
      return
    }
    map.delete(guid)
    await persistSingleFile(layout, map)
  }

  async all(): Promise<LcaRecord[]> {
    return [...(await this.ensure()).values()]
  }
}

export class MemJournal implements PreImageJournal {
  private log: JournalEntry[] = []
  /** Mirrors FileJournal's file-name seq: 1-based, never reused. */
  private seq = 0

  constructor(private now: () => number = () => 0) {}

  async record(path: string, bytes: Uint8Array | null): Promise<void> {
    const copy = bytes ? bytes.slice() : new Uint8Array()
    this.log.push({ seq: ++this.seq, path, at: this.now(), size: copy.length, bytes: copy })
  }
  async list(path?: string): Promise<JournalEntryInfo[]> {
    return (await this.entries(path)).map(({ seq, path: p, at, size }) => ({ seq, path: p, at, size }))
  }
  async entries(path?: string): Promise<JournalEntry[]> {
    return this.log.filter((e) => !path || e.path === path)
  }
  async latest(path: string): Promise<JournalEntry | null> {
    const list = await this.entries(path)
    return list.length ? list[list.length - 1]! : null
  }
  /** Prefix-wise re-key, as FileJournal (M10). */
  async rename(from: string, to: string): Promise<void> {
    const prefix = `${from}/`
    for (const e of this.log) {
      if (e.path === from) e.path = to
      else if (e.path.startsWith(prefix)) e.path = to + e.path.slice(from.length)
    }
  }
}

/** Directory-relative name of one record's file. */
function recordName(layout: PerRecordLayout, guid: string): string {
  return `${layout.prefix}${encodeURIComponent(guid)}.json`
}

async function writeRecord(layout: PerRecordLayout, rec: LcaRecord): Promise<void> {
  await layout.dir
    .io(recordName(layout, rec.guid))
    .writeAtomic(encode(JSON.stringify(serialize(rec))))
}

async function persistSingleFile(
  layout: SingleFileLayout,
  map: Map<string, LcaRecord>
): Promise<void> {
  await layout.io.writeAtomic(encode(JSON.stringify([...map.values()].map(serialize))))
}

function serialize(rec: LcaRecord): SerializedLca {
  const { heads, ...rest } = rec
  return { ...rest, headsB64: bytesToB64(heads) }
}

function deserialize(s: SerializedLca): LcaRecord {
  const { headsB64, ...rest } = s
  return { ...rest, heads: b64ToBytes(headsB64) }
}

function parseList(bytes: Uint8Array | null): SerializedLca[] {
  if (!bytes || bytes.length === 0) return []
  const parsed = JSON.parse(decode(bytes)) as SerializedLca[]
  return Array.isArray(parsed) ? parsed : []
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

function decode(b: Uint8Array): string {
  return new TextDecoder().decode(b)
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
