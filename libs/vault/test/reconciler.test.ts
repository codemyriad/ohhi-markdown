import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { decodeFile, renderFile } from '../src/eol.js'
import { enrollFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { reconcileFile, resolveDivergence, type ReconcileContext } from '../src/reconciler.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { DEFAULT_THRESHOLDS } from '../src/types.js'

const enc = (s: string) => new TextEncoder().encode(s)
const dec = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

async function setup(initial: Record<string, string>) {
  const engine = createYjsEngine()
  const adapter = new MemVaultAdapter()
  for (const [path, text] of Object.entries(initial)) {
    await adapter.writeAtomic(path, enc(text))
  }
  const lcaStore = new MemLcaStore()
  const folderDoc = engine.createDoc('folder')
  let n = 0
  const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore, () => `g${n++}`)
  const ctx: ReconcileContext = {
    engine,
    adapter,
    lcaStore,
    journal: new MemJournal(),
    thresholds: DEFAULT_THRESHOLDS,
    recentFlushes: new Map(),
    openPaths: new Set(),
  }
  return { engine, adapter, lcaStore, folderDoc, docs, ctx }
}

describe('reconciler classification matrix', () => {
  it('noop when neither side changed', async () => {
    const { ctx, docs, lcaStore } = await setup({ 'a.md': 'hello\n' })
    const doc = docs.get('g0')!
    const result = await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(result.action).toBe('noop')
  })

  it('materializes when only the CRDT advanced', async () => {
    const { ctx, docs, lcaStore, adapter, engine } = await setup({ 'a.md': 'hello\n' })
    const doc = docs.get('g0')!
    doc.transact((t) => t.insert(0, 'edited '), 'local')
    const result = await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(result.action).toBe('materialized')
    expect(dec(await adapter.read('a.md'))).toBe('edited hello\n')
    // LCA advanced with it:
    const lca = (await lcaStore.get('g0'))!
    expect(lca.baseText).toBe('edited hello\n')
    expect(engine.headsEqual(engine.decodeHeads(lca.heads), engine.heads(doc))).toBe(true)
    // Pre-image journaled:
    const pre = await ctx.journal.latest('a.md')
    expect(dec(pre!.bytes)).toBe('hello\n')
  })

  it('ingests external-only edits as CRDT ops', async () => {
    const { ctx, docs, lcaStore, adapter } = await setup({ 'a.md': 'one\ntwo\nthree\n' })
    const doc = docs.get('g0')!
    await adapter.writeAtomic('a.md', enc('one\ntwo-edited\nthree\nfour\n'))
    const result = await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(result.action).toBe('ingested')
    expect(doc.getText()).toBe('one\ntwo-edited\nthree\nfour\n')
  })

  it('flags three-way divergence and writes nothing', async () => {
    const { ctx, docs, lcaStore, adapter } = await setup({ 'a.md': 'base\n' })
    const doc = docs.get('g0')!
    doc.transact((t) => t.insert(0, 'crdt-side '), 'local')
    await adapter.writeAtomic('a.md', enc('disk-side base\n'))
    const result = await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(result.action).toBe('diverged')
    expect(result.review).toMatchObject({
      base: 'base\n',
      mine: 'crdt-side base\n',
      theirs: 'disk-side base\n',
      reason: 'three-way',
    })
    // Disk untouched, CRDT untouched:
    expect(dec(await adapter.read('a.md'))).toBe('disk-side base\n')
    expect(doc.getText()).toBe('crdt-side base\n')
  })

  it('resolveDivergence applies merged text as minimal ops then materializes', async () => {
    const { ctx, docs, lcaStore, adapter } = await setup({ 'a.md': 'base\n' })
    const doc = docs.get('g0')!
    doc.transact((t) => t.insert(0, 'mine '), 'local')
    await adapter.writeAtomic('a.md', enc('theirs base\n'))
    const merged = 'mine theirs base\n'
    const result = await resolveDivergence(ctx, doc, (await lcaStore.get('g0'))!, merged)
    expect(result.action).toBe('materialized')
    expect(doc.getText()).toBe(merged)
    expect(dec(await adapter.read('a.md'))).toBe(merged)
  })

  it('escalates huge external rewrites instead of auto-ingesting', async () => {
    const longBase = 'line\n'.repeat(100)
    const { ctx, docs, lcaStore, adapter } = await setup({ 'a.md': longBase })
    const doc = docs.get('g0')!
    await adapter.writeAtomic('a.md', enc('completely different content\n'.repeat(40)))
    const result = await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(result.action).toBe('escalated')
    expect(result.review?.reason).toBe('ratio-threshold')
    expect(doc.getText()).toBe(longBase) // CRDT untouched
  })

  it('treats external deletion as divergence, never silent loss', async () => {
    const { ctx, docs, lcaStore, adapter } = await setup({ 'a.md': 'precious\n' })
    const doc = docs.get('g0')!
    await adapter.remove('a.md')
    const result = await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(result.action).toBe('diverged')
    expect(result.review?.theirs).toBe('')
    expect(doc.getText()).toBe('precious\n')
  })
})

describe('EOL/BOM round-trip (blocking L1 invariant)', () => {
  const cases: [string, string][] = [
    ['lf', 'one\ntwo\n'],
    ['crlf', 'one\r\ntwo\r\n'],
    ['mixed', 'one\r\ntwo\nthree\rfour'],
    ['bom-lf', '﻿one\ntwo\n'],
    ['bom-crlf', '﻿one\r\ntwo\r\n'],
    ['empty', ''],
  ]
  for (const [name, content] of cases) {
    it(`render(decode(bytes)) === bytes for ${name}`, () => {
      const bytes = enc(content)
      const d = decodeFile(bytes)
      expect(renderFile(d.text, d.eol, d.bom)).toEqual(bytes)
    })
  }

  it('CRLF files stay CRLF after a CRDT edit + materialize', async () => {
    const { ctx, docs, lcaStore, adapter } = await setup({ 'w.md': 'one\r\ntwo\r\n' })
    const doc = docs.get('g0')!
    expect(doc.getText()).toBe('one\ntwo\n') // normalized inside the CRDT
    doc.transact((t) => t.insert(0, 'zero\n'), 'local')
    await reconcileFile(ctx, doc, (await lcaStore.get('g0'))!)
    expect(dec(await adapter.read('w.md'))).toBe('zero\r\none\r\ntwo\r\n')
  })
})
