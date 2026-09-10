/**
 * Durable pre-image journal over a StoreDir (spike S8; discharges D2a's
 * "MemJournal only" gap). Entry bytes live one file per record under
 * `journal/`, and the file NAME carries the metadata:
 * `journal/<seq>.<at>-<url-encoded path>.bin`. Recording a pre-image is
 * therefore exactly ONE write — of the bytes it protects, before the disk
 * write it protects (golden rule 1). A crash can only orphan an entry file,
 * never hide one: the directory listing IS the index.
 *
 * Before spike S10-Q4 an `journal/index.json` listing every entry was
 * rewritten on every record — quadratic write volume (1,029 rewrites / 76 MB
 * for one 1,029-note join). Stores written that way still read: entries named
 * `journal/<seq>-<path>.bin` take their timestamps from the surviving
 * `index.json`, which is dropped once the last of them ages out of retention.
 */
import type { JournalEntry, PreImageJournal } from './types.js'
import type { StoreDir } from './store-dir.js'

const PREFIX = 'journal/'
const INDEX_NAME = `${PREFIX}index.json`

/** `journal/<seq>.<at>-<encoded path>.bin` — the current layout. */
const ENTRY_NAME = /^journal\/(\d+)\.(\d+)-(.*)\.bin$/
/**
 * `journal/<seq>-<encoded path>.bin` — the pre-S10 layout. Unambiguous
 * against the current one: a legacy name always has '-' after the seq digits,
 * never '.', so ENTRY_NAME cannot match it (and vice versa).
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
  /** Pre-S10 name; its `at` came from `index.json`, which must outlive it. */
  legacy: boolean
}

/** Names encode `at` as digits, so a clock's value is stamped as one. */
function stamp(at: number): number {
  return Number.isFinite(at) ? Math.max(0, Math.trunc(at)) : 0
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
    const path = decodePath(current[3]!)
    return path === null ? null : { seq: Number(current[1]), at: Number(current[2]), path, file, legacy: false }
  }
  const legacy = LEGACY_ENTRY_NAME.exec(file)
  if (legacy) {
    const path = decodePath(legacy[2]!)
    return path === null
      ? null
      : { seq: Number(legacy[1]), at: legacyAt.get(file) ?? 0, path, file, legacy: true }
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
      const file = `${PREFIX}${seq}.${at}-${encodeURIComponent(path)}.bin`
      // The pre-image is durable before record() resolves — the disk write it
      // protects only happens after (golden rule 1). One write, no index.
      await this.dir.io(file).writeAtomic(bytes ? bytes.slice() : new Uint8Array())
      entries.push({ seq, path, at, file, legacy: false })

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

  async entries(path?: string): Promise<JournalEntry[]> {
    const selected = (await this.ensure()).filter((e) => !path || e.path === path)
    const out: JournalEntry[] = []
    for (const e of selected) {
      const bytes = await this.dir.io(e.file).read()
      out.push({ seq: e.seq, path: e.path, at: e.at, bytes: bytes ?? new Uint8Array() })
    }
    return out
  }

  async latest(path: string): Promise<JournalEntry | null> {
    const selected = (await this.ensure()).filter((e) => e.path === path)
    const last = selected[selected.length - 1]
    if (!last) return null
    const bytes = await this.dir.io(last.file).read()
    return { seq: last.seq, path: last.path, at: last.at, bytes: bytes ?? new Uint8Array() }
  }
}
