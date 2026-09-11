/**
 * Durable pre-image journal over a StoreDir (spike S8; discharges D2a's
 * "MemJournal only" gap). Entry bytes live one file per record under
 * `journal/`, and the file NAME carries the metadata:
 * `journal/<seq>.<at>.<size>-<url-encoded path>.bin`. Recording a pre-image is
 * therefore exactly ONE write — of the bytes it protects, before the disk
 * write it protects (golden rule 1). A crash can only orphan an entry file,
 * never hide one: the directory listing IS the index.
 *
 * `size` joined the name for `list()` (M11): the History rail re-lists a
 * note's retained versions on every flush, and a listing that had to read
 * each entry back to learn its length was reading the whole retention window
 * — up to 20 full copies of a note — to print a column of byte counts.
 *
 * Two older layouts still read, and are named apart by construction (a seq is
 * followed by '.' in the current one, '-' in the oldest; the middle layout has
 * one dot where the current has two):
 *
 *  - `journal/<seq>.<at>-<path>.bin` — pre-M11. No size in the name, so
 *    `list()` reads those entries (and only those) to answer `size`.
 *  - `journal/<seq>-<path>.bin` — pre-S10-Q4, when a `journal/index.json`
 *    listing every entry was rewritten on every record (quadratic write
 *    volume: 1,029 rewrites / 76 MB for one 1,029-note join). Those entries
 *    take their timestamps from the surviving `index.json`, which is dropped
 *    once the last of them ages out of retention.
 */
import type { JournalEntry, JournalEntryInfo, PreImageJournal } from './types.js'
import type { StoreDir } from './store-dir.js'

const PREFIX = 'journal/'
const INDEX_NAME = `${PREFIX}index.json`

/** `journal/<seq>.<at>.<size>-<encoded path>.bin` — the current layout. */
const ENTRY_NAME = /^journal\/(\d+)\.(\d+)\.(\d+)-(.*)\.bin$/
/**
 * `journal/<seq>.<at>-<encoded path>.bin` — pre-M11, no size in the name.
 * Unambiguous against the current layout: the digits after `<at>` must be
 * followed by '-', which a current name spells '.', so neither regex can
 * match the other's names.
 */
const SIZELESS_ENTRY_NAME = /^journal\/(\d+)\.(\d+)-(.*)\.bin$/
/**
 * `journal/<seq>-<encoded path>.bin` — the pre-S10 layout. Unambiguous
 * against both of the above: a legacy name always has '-' after the seq
 * digits, never '.', so neither of them can match it (and vice versa).
 */
const LEGACY_ENTRY_NAME = /^journal\/(\d+)-(.*)\.bin$/

interface LegacyIndexEntry {
  seq: number
  path: string
  at: number
  file: string
}

interface Entry {
  seq: number
  path: string
  at: number
  file: string
  /** Byte length, or null for a pre-M11 name that does not carry one. */
  size: number | null
  /** Pre-S10 name; its `at` came from `index.json`, which must outlive it. */
  legacy: boolean
}

/** Names encode `at` as digits, so a clock's value is stamped as one. */
function stamp(at: number): number {
  return Number.isFinite(at) ? Math.max(0, Math.trunc(at)) : 0
}

/** The one place an entry's name is built, so parse and print cannot drift. */
function entryName(seq: number, at: number, size: number, path: string): string {
  return `${PREFIX}${seq}.${at}.${size}-${encodeURIComponent(path)}.bin`
}

function parseEntryName(file: string, legacyAt: Map<string, number>): Entry | null {
  const decodePath = (raw: string): string | null => {
    try {
      return decodeURIComponent(raw)
    } catch {
      return null
    }
  }
  const current = ENTRY_NAME.exec(file)
  if (current) {
    const path = decodePath(current[4]!)
    return path === null
      ? null
      : {
          seq: Number(current[1]),
          at: Number(current[2]),
          size: Number(current[3]),
          path,
          file,
          legacy: false,
        }
  }
  const sizeless = SIZELESS_ENTRY_NAME.exec(file)
  if (sizeless) {
    const path = decodePath(sizeless[3]!)
    return path === null
      ? null
      : { seq: Number(sizeless[1]), at: Number(sizeless[2]), size: null, path, file, legacy: false }
  }
  const legacy = LEGACY_ENTRY_NAME.exec(file)
  if (legacy) {
    const path = decodePath(legacy[2]!)
    return path === null
      ? null
      : { seq: Number(legacy[1]), at: legacyAt.get(file) ?? 0, size: null, path, file, legacy: true }
  }
  return null
}

export class FileJournal implements PreImageJournal {
  private entries_: Entry[] | null = null
  private loading: Promise<Entry[]> | null = null
  private seq = 0
  /** A pre-S10 `index.json` is still on disk and still needed for its `at`s. */
  private legacyIndex = false
  private readonly now: () => number
  private readonly retentionPerPath: number
  /** Serializes record() calls so seq allocation never interleaves. */
  private work: Promise<void> = Promise.resolve()

  constructor(
    private dir: StoreDir,
    opts?: { now?: () => number; retentionPerPath?: number }
  ) {
    this.now = opts?.now ?? (() => 0)
    this.retentionPerPath = opts?.retentionPerPath ?? 20
  }

  private ensure(): Promise<Entry[]> {
    if (this.entries_) return Promise.resolve(this.entries_)
    this.loading ??= this.loadOnce().then(
      (entries) => {
        this.entries_ = entries
        this.loading = null
        return entries
      },
      (err: unknown) => {
        this.loading = null
        throw err
      }
    )
    return this.loading
  }

  private async loadOnce(): Promise<Entry[]> {
    const names = await this.dir.list(PREFIX)
    const legacyAt = new Map<string, number>()
    let maxSeq = 0
    if (names.includes(INDEX_NAME)) {
      this.legacyIndex = true
      const bytes = await this.dir.io(INDEX_NAME).read()
      if (bytes && bytes.length > 0) {
        const state = JSON.parse(new TextDecoder().decode(bytes)) as {
          seq?: number
          entries?: LegacyIndexEntry[]
        }
        for (const e of state.entries ?? []) legacyAt.set(e.file, e.at)
        maxSeq = Math.max(maxSeq, state.seq ?? 0)
      }
    }
    const entries: Entry[] = []
    for (const name of names) {
      if (name === INDEX_NAME) continue
      const entry = parseEntryName(name, legacyAt)
      if (entry) entries.push(entry)
    }
    entries.sort((a, b) => a.seq - b.seq)
    this.seq = entries.reduce((max, e) => Math.max(max, e.seq), maxSeq)
    if (this.legacyIndex && !entries.some((e) => e.legacy)) {
      this.legacyIndex = false
      await this.dir.remove(INDEX_NAME).catch(() => {})
    }
    return entries
  }

  async record(path: string, bytes: Uint8Array | null): Promise<void> {
    const run = this.work.then(async () => {
      const entries = await this.ensure()
      const seq = ++this.seq
      const at = stamp(this.now())
      const size = bytes ? bytes.length : 0
      const file = entryName(seq, at, size, path)
      // The pre-image is durable before record() resolves — the disk write it
      // protects only happens after (golden rule 1). One write, no index.
      await this.dir.io(file).writeAtomic(bytes ? bytes.slice() : new Uint8Array())
      entries.push({ seq, path, at, size, file, legacy: false })

      const forPath = entries.filter((e) => e.path === path)
      const dropped = forPath.slice(0, Math.max(0, forPath.length - this.retentionPerPath))
      if (dropped.length > 0) {
        const doomed = new Set(dropped.map((e) => e.file))
        this.entries_ = entries.filter((e) => !doomed.has(e.file))
        for (const d of dropped) await this.dir.remove(d.file).catch(() => {})
      }
      if (this.legacyIndex && !(this.entries_ ?? entries).some((e) => e.legacy)) {
        this.legacyIndex = false
        await this.dir.remove(INDEX_NAME).catch(() => {}) // its dates outlived
      }
    })
    this.work = run.catch(() => {})
    return run
  }

  /**
   * Metadata for every retained pre-image, in seq order — WITHOUT reading a
   * single entry back (M11). Only entries written before the size joined the
   * name cost a read, and only until they age out of retention.
   */
  async list(path?: string): Promise<JournalEntryInfo[]> {
    const selected = (await this.ensure()).filter((e) => !path || e.path === path)
    const out: JournalEntryInfo[] = []
    for (const e of selected) {
      const size = e.size ?? (await this.dir.io(e.file).read())?.length ?? 0
      out.push({ seq: e.seq, path: e.path, at: e.at, size })
    }
    return out
  }

  async entries(path?: string): Promise<JournalEntry[]> {
    const selected = (await this.ensure()).filter((e) => !path || e.path === path)
    const out: JournalEntry[] = []
    for (const e of selected) {
      const bytes = (await this.dir.io(e.file).read()) ?? new Uint8Array()
      out.push({ seq: e.seq, path: e.path, at: e.at, size: bytes.length, bytes })
    }
    return out
  }

  async latest(path: string): Promise<JournalEntry | null> {
    const selected = (await this.ensure()).filter((e) => e.path === path)
    const last = selected[selected.length - 1]
    if (!last) return null
    const bytes = (await this.dir.io(last.file).read()) ?? new Uint8Array()
    return { seq: last.seq, path: last.path, at: last.at, size: bytes.length, bytes }
  }

  /**
   * Re-key a renamed path's history (M10), prefix-wise for a directory.
   *
   * Copy to the new name BEFORE removing the old one: a crash in between
   * leaves the same pre-image listed twice — under a path that no longer
   * exists and under the one that does — which is a visible duplicate, never
   * a lost version (the same rule every other move in the vault follows).
   * Serialized with `record()` so seq allocation never interleaves with it.
   */
  async rename(from: string, to: string): Promise<void> {
    const run = this.work.then(async () => {
      const entries = await this.ensure()
      const prefix = `${from}/`
      const affected = entries.filter((e) => e.path === from || e.path.startsWith(prefix))
      for (const e of affected) {
        const bytes = (await this.dir.io(e.file).read()) ?? new Uint8Array()
        const next = e.path === from ? to : to + e.path.slice(from.length)
        const file = entryName(e.seq, e.at, bytes.length, next)
        if (file === e.file) continue
        await this.dir.io(file).writeAtomic(bytes)
        await this.dir.remove(e.file).catch(() => {})
        e.path = next
        e.file = file
        e.size = bytes.length
        // A pre-S10 entry has just been rewritten under a current name, so
        // index.json no longer dates it.
        e.legacy = false
      }
      if (this.legacyIndex && !entries.some((e) => e.legacy)) {
        this.legacyIndex = false
        await this.dir.remove(INDEX_NAME).catch(() => {})
      }
    })
    this.work = run.catch(() => {})
    return run
  }
}
