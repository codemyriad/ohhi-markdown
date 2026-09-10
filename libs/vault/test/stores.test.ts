/**
 * LCA store: the per-record layout (spike S10-Q4's write-amplification fix).
 * The contract runs against both durable StoreDirs; the amplification test is
 * the regression guard — `put` must cost one small write, never a rewrite of
 * every record (4,116 rewrites / 5.6 GB for one 1,029-note join, measured).
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MemStoreDir } from '../src/store-dir.js'
import { NodeStoreDir } from '../src/node-adapter.js'
import { JsonFileLcaStore, type StoreIo } from '../src/stores.js'
import type { StoreDir } from '../src/store-dir.js'
import type { LcaRecord } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

function rec(guid: string, text = `body of ${guid}`): LcaRecord {
  return {
    guid,
    path: `${guid}.md`,
    baseText: text,
    contentHash: `hash-${guid}`,
    heads: enc(`heads-${guid}`),
    eol: 'lf',
    bom: false,
  }
}

/** Legacy (pre-S10) `lca.json` payload: one JSON array of every record. */
function legacyBytes(records: LcaRecord[]): Uint8Array {
  return enc(
    JSON.stringify(
      records.map(({ heads, ...rest }) => ({
        ...rest,
        headsB64: Buffer.from(heads).toString('base64'),
      }))
    )
  )
}

/** Counts writeAtomic/remove per name; binding names ITSELF so puts route back. */
class CountingStoreDir implements StoreDir {
  writes: string[] = []
  removes: string[] = []
  constructor(private inner: StoreDir) {}
  io(name: string): StoreIo {
    const io = this.inner.io(name)
    return {
      read: () => io.read(),
      writeAtomic: async (bytes) => {
        this.writes.push(name)
        await io.writeAtomic(bytes)
      },
      binding: { dir: this, name },
    }
  }
  remove(name: string): Promise<void> {
    this.removes.push(name)
    return this.inner.remove(name)
  }
  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
}

/** Throws once `writesLeft` is spent — crash injection mid-migration. */
class CrashingStoreDir implements StoreDir {
  constructor(
    private inner: StoreDir,
    public writesLeft: number
  ) {}
  io(name: string): StoreIo {
    const io = this.inner.io(name)
    return {
      read: () => io.read(),
      writeAtomic: async (bytes) => {
        if (this.writesLeft <= 0) throw new Error('injected-crash')
        this.writesLeft--
        await io.writeAtomic(bytes)
      },
      binding: { dir: this, name },
    }
  }
  remove(name: string): Promise<void> {
    if (this.writesLeft <= 0) throw new Error('injected-crash')
    this.writesLeft--
    return this.inner.remove(name)
  }
  list(prefix?: string): Promise<string[]> {
    return this.inner.list(prefix)
  }
}

/** Contract suite run against every durable StoreDir implementation. */
function lcaStoreContract(
  name: string,
  make: () => Promise<{ dir: StoreDir; cleanup?: () => Promise<void> }>
) {
  describe(`JsonFileLcaStore over ${name}`, () => {
    let cleanup: (() => Promise<void>) | undefined
    afterEach(async () => {
      await cleanup?.()
      cleanup = undefined
    })

    it('round-trips put/get/remove/all, one file per record', async () => {
      const made = await make()
      cleanup = made.cleanup
      const store = new JsonFileLcaStore(made.dir)

      expect(await store.get('g1')).toBeNull()
      await store.put(rec('g1'))
      await store.put(rec('g2'))

      const got = await store.get('g1')
      expect(got).toEqual(rec('g1')) // heads survive the base64 round trip
      expect((await store.all()).map((r) => r.guid).sort()).toEqual(['g1', 'g2'])
      expect(await made.dir.list('lca/')).toEqual(['lca/g1.json', 'lca/g2.json'])

      // An overwrite replaces one record, not the corpus.
      await store.put(rec('g1', 'edited'))
      expect((await store.get('g1'))!.baseText).toBe('edited')
      expect((await store.get('g2'))!.baseText).toBe('body of g2')

      await store.remove('g1')
      expect(await store.get('g1')).toBeNull()
      expect((await store.all()).map((r) => r.guid)).toEqual(['g2'])
      expect(await made.dir.list('lca/')).toEqual(['lca/g2.json'])
      // Removing an unknown guid is a no-op, like the StoreDir it sits on.
      await expect(store.remove('never')).resolves.toBeUndefined()
    })

    it('all() is correct across puts and removes in a REOPENED store', async () => {
      const made = await make()
      cleanup = made.cleanup
      const first = new JsonFileLcaStore(made.dir)
      for (const g of ['g1', 'g2', 'g3']) await first.put(rec(g))
      await first.remove('g2')
      await first.put(rec('g4'))

      const second = new JsonFileLcaStore(made.dir)
      expect((await second.all()).map((r) => r.guid).sort()).toEqual(['g1', 'g3', 'g4'])
      expect((await second.get('g3'))!.baseText).toBe('body of g3')
      expect(await second.get('g2')).toBeNull()
    })

    it('splits a legacy lca.json on first open and removes it (idempotently)', async () => {
      const made = await make()
      cleanup = made.cleanup
      await made.dir.io('lca.json').writeAtomic(legacyBytes([rec('g1'), rec('g2'), rec('g3')]))
      // A per-record file already present WINS over the legacy copy: it is the
      // one a crashed earlier split had already written.
      await new JsonFileLcaStore(made.dir).put(rec('g2', 'newer per-record'))

      const store = new JsonFileLcaStore(made.dir)
      expect((await store.all()).map((r) => r.guid).sort()).toEqual(['g1', 'g2', 'g3'])
      expect((await store.get('g2'))!.baseText).toBe('newer per-record')
      expect((await store.get('g1'))!.heads).toEqual(enc('heads-g1'))
      expect(await made.dir.io('lca.json').read()).toBeNull() // dropped last

      // Re-open over the migrated namespace: nothing left to do, same answer.
      const reopened = new JsonFileLcaStore(made.dir)
      expect((await reopened.all()).map((r) => r.guid).sort()).toEqual(['g1', 'g2', 'g3'])
    })
  })
}

lcaStoreContract('MemStoreDir', async () => ({ dir: new MemStoreDir() }))

lcaStoreContract('NodeStoreDir', async () => {
  const root = await mkdtemp(join(tmpdir(), 'editor-lca-store-'))
  return {
    dir: new NodeStoreDir(root),
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
})

describe('JsonFileLcaStore write amplification (spike S10-Q4)', () => {
  it('N puts cost N writes, not N² — and never rewrite a whole-corpus file', async () => {
    const counting = new CountingStoreDir(new MemStoreDir())
    const store = new JsonFileLcaStore(counting)
    const N = 60
    for (let i = 0; i < N; i++) await store.put(rec(`g${i}`))

    expect(counting.writes).toHaveLength(N) // exactly one file per put
    expect(counting.writes.every((w) => w.startsWith('lca/'))).toBe(true)
    expect(counting.writes).not.toContain('lca.json')
    // The old layout wrote the corpus every time: N*(N+1)/2 records of traffic.
    expect(counting.writes.length).toBeLessThan((N * (N + 1)) / 2)

    // Removes are one unlink each; re-puts are still one write each.
    for (let i = 0; i < 10; i++) await store.remove(`g${i}`)
    expect(counting.removes).toEqual(Array.from({ length: 10 }, (_, i) => `lca/g${i}.json`))
    await store.put(rec('g0'))
    expect(counting.writes).toHaveLength(N + 1)
    expect((await store.all()).length).toBe(N - 9)
  })

  it('the migration costs one write per legacy record plus one removal', async () => {
    const mem = new MemStoreDir()
    await mem.io('lca.json').writeAtomic(legacyBytes([rec('g1'), rec('g2'), rec('g3')]))
    const counting = new CountingStoreDir(mem)

    const store = new JsonFileLcaStore(counting)
    expect((await store.all()).length).toBe(3)
    expect(counting.writes).toEqual(['lca/g1.json', 'lca/g2.json', 'lca/g3.json'])
    expect(counting.removes).toEqual(['lca.json'])
  })
})

describe('JsonFileLcaStore crash safety', () => {
  it('a crash mid-split leaves a re-openable store: records in both, per-record wins', async () => {
    const mem = new MemStoreDir()
    await mem.io('lca.json').writeAtomic(legacyBytes([rec('g1'), rec('g2'), rec('g3')]))

    // Budget 2: two record files get written, then the third write throws —
    // the legacy file is NOT removed (that is the last step).
    const crashing = new CrashingStoreDir(mem, 2)
    await expect(new JsonFileLcaStore(crashing).all()).rejects.toThrow('injected-crash')
    expect(await mem.io('lca.json').read()).not.toBeNull()
    expect((await mem.list('lca/')).length).toBe(2)

    // Reboot over the surviving bytes: the split finishes, nothing is lost or
    // duplicated, and the legacy file is gone.
    const store = new JsonFileLcaStore(mem)
    expect((await store.all()).map((r) => r.guid).sort()).toEqual(['g1', 'g2', 'g3'])
    expect(await mem.io('lca.json').read()).toBeNull()
    expect((await mem.list('lca/')).length).toBe(3)
  })

  it('a failed put leaves the cache honest — get still reports the durable record', async () => {
    const mem = new MemStoreDir()
    const store = new JsonFileLcaStore(mem)
    await store.put(rec('g1', 'durable'))

    const crashing = new CrashingStoreDir(mem, 0)
    const guarded = new JsonFileLcaStore(crashing)
    await expect(guarded.put(rec('g1', 'never written'))).rejects.toThrow('injected-crash')
    expect((await guarded.get('g1'))!.baseText).toBe('durable')
    expect((await new JsonFileLcaStore(mem).get('g1'))!.baseText).toBe('durable')
  })
})

describe('JsonFileLcaStore namespacing', () => {
  it('a bound io keeps the old call shape and lands records beside its name', async () => {
    const dir = new MemStoreDir()
    // The shape every caller uses today: dir.io('<room>/lca.json').
    const store = new JsonFileLcaStore(dir.io('room-a/lca.json'))
    await store.put(rec('g1'))
    await store.put(rec('g2'))

    expect(await dir.list('room-a/')).toEqual(['room-a/lca/g1.json', 'room-a/lca/g2.json'])
    expect(await dir.list('room-b/')).toEqual([]) // scoped to its own room
    expect((await new JsonFileLcaStore(dir.io('room-a/lca.json')).all()).length).toBe(2)
  })

  it('guids that are not filename-safe round-trip', async () => {
    const dir = new MemStoreDir()
    const store = new JsonFileLcaStore(dir)
    await store.put(rec('a/b c%d'))
    expect(await dir.list('lca/')).toEqual(['lca/a%2Fb%20c%25d.json'])
    expect((await new JsonFileLcaStore(dir).get('a/b c%d'))!.path).toBe('a/b c%d.md')
  })

  it('an UNBOUND io (a wrapper that hides its dir) keeps the single-file layout', async () => {
    const dir = new MemStoreDir()
    const bound = dir.io('lca.json')
    const unbound: StoreIo = { read: () => bound.read(), writeAtomic: (b) => bound.writeAtomic(b) }

    const store = new JsonFileLcaStore(unbound)
    await store.put(rec('g1'))
    await store.put(rec('g2'))
    await store.remove('g1')

    expect(await dir.list()).toEqual(['lca.json']) // one file, the old way
    expect(dec(await dir.io('lca.json').read())).toContain('body of g2')
    expect((await new JsonFileLcaStore(unbound).all()).map((r) => r.guid)).toEqual(['g2'])
    // …and the next open through the DIR migrates that file into records.
    expect((await new JsonFileLcaStore(dir).all()).map((r) => r.guid)).toEqual(['g2'])
    expect(await dir.list()).toEqual(['lca/g2.json'])
  })
})
