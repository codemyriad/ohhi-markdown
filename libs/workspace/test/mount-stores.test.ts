import { createYjsEngine } from '@ohhi/sync'
import { BlobDocStore, FileJournal, MemStoreDir } from '@ohhi/vault'
import { SimClock } from '@ohhi/testkit'
import { describe, expect, it } from 'vitest'
import { createMountStores } from '../src/index.js'

describe('createMountStores', () => {
  it('builds the four objects under <storeDir>/<room>/', async () => {
    const storeDir = new MemStoreDir()
    const stores = createMountStores(createYjsEngine(), storeDir, 'room-a', new SimClock())
    expect(stores.docStore).toBeInstanceOf(BlobDocStore)
    expect(stores.journal).toBeInstanceOf(FileJournal)
    expect(typeof stores.lcaStore.get).toBe('function')
    expect(typeof stores.lcaStore.put).toBe('function')
    await stores.mountDir.io('probe').writeAtomic(new Uint8Array([1]))
    expect(await storeDir.list('room-a/')).toContain('room-a/probe')
  })

  it('stamps the journal through the injected clock', async () => {
    const clock = new SimClock()
    clock.advance(123_456)
    const { journal } = createMountStores(createYjsEngine(), new MemStoreDir(), 'room-b', clock)
    await journal.record('note.md', new TextEncoder().encode('before'))
    clock.advance(1_000)
    await journal.record('note.md', null)
    const at = (await journal.list('note.md')).map((e) => e.at)
    expect(at).toEqual([123_456, 124_456])
  })
})
