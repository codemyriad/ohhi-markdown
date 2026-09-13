/**
 * Vanished-file reviews (M5, spike S8 Q5): an external deletion classifies
 * as a 'vanished' review — never silent loss — and resolves two ways:
 * 'restore' materializes the CRDT content back, 'remove' journals the shadow
 * copy, tombstones the map entry for peers, and drops the LCA.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import {
  enrollFolder,
  MemJournal,
  MemLcaStore,
  MemVaultAdapter,
  VaultSession,
  type DivergenceReview,
} from '../src/index.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

async function harness() {
  const engine = createYjsEngine()
  const adapter = new MemVaultAdapter()
  await adapter.writeAtomic('a.md', enc.encode('hello vault\n'))
  const lcaStore = new MemLcaStore()
  const journal = new MemJournal()
  const clock = new SimClock()
  const folderDoc = engine.createDoc('r/folder')
  const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore)
  const reviews: DivergenceReview[] = []
  const cleared: string[] = []
  const session = new VaultSession({
    engine,
    adapter,
    lcaStore,
    journal,
    clock,
    folderDoc,
    docs,
    events: { onReview: (r) => reviews.push(r), onReviewCleared: (g) => cleared.push(g) },
  })
  await session.start()
  const guid = folderDoc.getMap().get('a.md')!.guid
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      clock.advance(200)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  return { engine, adapter, lcaStore, journal, folderDoc, docs, session, guid, reviews, cleared, settle }
}

describe('vanished-file review', () => {
  it('external deletion → review with reason "vanished", nothing written', async () => {
    const h = await harness()
    await h.adapter.remove('a.md')
    await h.settle()
    expect(h.reviews).toHaveLength(1)
    expect(h.reviews[0]).toMatchObject({ guid: h.guid, path: 'a.md', reason: 'vanished', theirs: '' })
    expect(await h.adapter.read('a.md')).toBeNull() // review touched nothing
    h.session.dispose()
  })

  it("'restore' materializes the CRDT content back onto disk", async () => {
    const h = await harness()
    await h.adapter.remove('a.md')
    await h.settle()
    await h.session.resolveVanished(h.guid, 'restore')
    expect(dec.decode((await h.adapter.read('a.md'))!)).toBe('hello vault\n')
    expect(h.cleared).toContain(h.guid)
    // Settled: re-running the reconciler changes nothing (idempotence).
    await h.settle()
    expect(h.reviews).toHaveLength(1)
    h.session.dispose()
  })

  it("'remove' journals the shadow copy, tombstones the entry, drops the LCA", async () => {
    const h = await harness()
    await h.adapter.remove('a.md')
    await h.settle()
    await h.session.resolveVanished(h.guid, 'remove')
    expect(h.folderDoc.getMap().get('a.md')?.deleted).toBe(true) // peers see a delete
    expect(await h.lcaStore.get(h.guid)).toBeNull()
    const pre = await h.journal.latest('a.md')
    expect(pre).not.toBeNull()
    expect(dec.decode(pre!.bytes)).toBe('hello vault\n') // recoverable
    expect(h.cleared).toContain(h.guid)
    h.session.dispose()
  })
})
