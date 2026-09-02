/**
 * Durable pre-image journal over a StoreDir (spike S8; discharges D2a's
 * "MemJournal only" gap). Entry bytes live one file per record under
 * `journal/`, indexed by `journal/index.json`. Write order is
 * entry-file → index → best-effort removal of dropped files, so a crash can
 * orphan an entry file but the index never references a missing one.
 */
import type { JournalEntry, PreImageJournal } from './types.js'
import type { StoreDir } from './store-dir.js'

const INDEX_NAME = 'journal/index.json'

interface IndexEntry {
  seq: number
  path: string
  at: number
  file: string
}

interface IndexState {
  seq: number
  entries: IndexEntry[]
}

export class FileJournal implements PreImageJournal {
  private state: IndexState | null = null
  private readonly now: () => number
  private readonly retentionPerPath: number
  /** Serializes record() calls so seq/index writes never interleave. */
  private work: Promise<void> = Promise.resolve()

  constructor(
    private dir: StoreDir,
    opts?: { now?: () => number; retentionPerPath?: number }
  ) {
    this.now = opts?.now ?? (() => 0)
    this.retentionPerPath = opts?.retentionPerPath ?? 20
  }

  private async load(): Promise<IndexState> {
    if (this.state) return this.state
    const bytes = await this.dir.io(INDEX_NAME).read()
    this.state = bytes
      ? (JSON.parse(new TextDecoder().decode(bytes)) as IndexState)
      : { seq: 0, entries: [] }
    return this.state
  }

  private async persistIndex(state: IndexState): Promise<void> {
    await this.dir
      .io(INDEX_NAME)
      .writeAtomic(new TextEncoder().encode(JSON.stringify(state)))
  }

  async record(path: string, bytes: Uint8Array | null): Promise<void> {
    const run = this.work.then(async () => {
      const state = await this.load()
      const seq = ++state.seq
      const file = `journal/${seq}-${encodeURIComponent(path)}.bin`
      await this.dir.io(file).writeAtomic(bytes ? bytes.slice() : new Uint8Array())

      const entry: IndexEntry = { seq, path, at: this.now(), file }
      const forPath = state.entries.filter((e) => e.path === path)
      const dropped = forPath.slice(0, Math.max(0, forPath.length + 1 - this.retentionPerPath))
      const droppedSeqs = new Set(dropped.map((e) => e.seq))
      state.entries = [...state.entries.filter((e) => !droppedSeqs.has(e.seq)), entry]
      await this.persistIndex(state)
      for (const d of dropped) await this.dir.remove(d.file).catch(() => {})
    })
    this.work = run.catch(() => {})
    return run
  }

  async entries(path?: string): Promise<JournalEntry[]> {
    const state = await this.load()
    const selected = state.entries.filter((e) => !path || e.path === path)
    const out: JournalEntry[] = []
    for (const e of selected) {
      const bytes = await this.dir.io(e.file).read()
      out.push({ path: e.path, at: e.at, bytes: bytes ?? new Uint8Array() })
    }
    return out
  }

  async latest(path: string): Promise<JournalEntry | null> {
    const list = await this.entries(path)
    return list.length ? list[list.length - 1]! : null
  }
}
