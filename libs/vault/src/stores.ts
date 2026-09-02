/**
 * Durable-store v0 implementations. The LCA store and pre-image journal live
 * in app-data (NEVER the vault, NEVER droppable cache storage — shaping D5).
 * An atomic JSON file via an injected io. SQLite would sit behind the same
 * interfaces if the durable side ever needed it — not scheduled: the V2 index
 * decision (plans/v2-shaping.md Fork 1) deferred SQLite entirely, behind a
 * measured trigger, and that trigger is about the DROPPABLE index, not this.
 */
import type {
  JournalEntry,
  LcaRecord,
  LcaStore,
  PreImageJournal,
} from './types.js'

export interface StoreIo {
  read(): Promise<Uint8Array | null>
  writeAtomic(bytes: Uint8Array): Promise<void>
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

/** Atomic-JSON-file LCA store over an injected io (node fs, Tauri fs, …). */
export class JsonFileLcaStore implements LcaStore {
  private cache: Map<string, LcaRecord> | null = null

  constructor(private io: StoreIo) {}

  private async load(): Promise<Map<string, LcaRecord>> {
    if (this.cache) return this.cache
    const bytes = await this.io.read()
    const map = new Map<string, LcaRecord>()
    if (bytes) {
      const list = JSON.parse(new TextDecoder().decode(bytes)) as SerializedLca[]
      for (const s of list) {
        const { headsB64, ...rest } = s
        map.set(s.guid, { ...rest, heads: b64ToBytes(headsB64) })
      }
    }
    this.cache = map
    return map
  }

  private async persist(): Promise<void> {
    const map = await this.load()
    const list: SerializedLca[] = [...map.values()].map((r) => {
      const { heads, ...rest } = r
      return { ...rest, headsB64: bytesToB64(heads) }
    })
    await this.io.writeAtomic(new TextEncoder().encode(JSON.stringify(list)))
  }

  async get(guid: string): Promise<LcaRecord | null> {
    return (await this.load()).get(guid) ?? null
  }
  async put(rec: LcaRecord): Promise<void> {
    ;(await this.load()).set(rec.guid, rec)
    await this.persist()
  }
  async remove(guid: string): Promise<void> {
    ;(await this.load()).delete(guid)
    await this.persist()
  }
  async all(): Promise<LcaRecord[]> {
    return [...(await this.load()).values()]
  }
}

export class MemJournal implements PreImageJournal {
  private log: JournalEntry[] = []

  constructor(private now: () => number = () => 0) {}

  async record(path: string, bytes: Uint8Array | null): Promise<void> {
    this.log.push({ path, at: this.now(), bytes: bytes ? bytes.slice() : new Uint8Array() })
  }
  async entries(path?: string): Promise<JournalEntry[]> {
    return this.log.filter((e) => !path || e.path === path)
  }
  async latest(path: string): Promise<JournalEntry | null> {
    const list = await this.entries(path)
    return list.length ? list[list.length - 1]! : null
  }
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
