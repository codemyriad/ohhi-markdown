/**
 * Fork 1's evidence, re-runnable — gated so CI never depends on a real vault.
 *
 *   EDITOR_BENCH_VAULT="/path/to/vault" rushx test
 *
 * plans/v2-shaping.md defers the sqlite-wasm/rusqlite index behind a MEASURED
 * trigger (>5,000 files, >20 MB, cold build >750 ms, search p95 >50 ms). This
 * is how that gets re-measured rather than assumed. It prints; it asserts only
 * that the trigger has not fired.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MemoryIndex } from '../src/index.js'
import type { IndexDoc } from '../src/types.js'

const VAULT = process.env.EDITOR_BENCH_VAULT

describe.skipIf(!VAULT)('real-vault benchmark', () => {
  it('stays under the Fork 1 trigger', async () => {
    const docs: IndexDoc[] = []
    const walk = (dir: string, rel = ''): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue
        const abs = join(dir, e.name)
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) walk(abs, r)
        else if (e.name.endsWith('.md')) {
          docs.push({ guid: r, path: r, text: readFileSync(abs, 'utf8') })
        }
      }
    }
    const t0 = performance.now()
    walk(VAULT!)
    const readMs = performance.now() - t0

    const index = new MemoryIndex()
    const t1 = performance.now()
    index.rebuild(docs)
    const buildMs = performance.now() - t1

    const stats = await index.stats()
    const bytes = docs.reduce((n, d) => n + d.text.length, 0)

    const bench = async (fn: () => Promise<unknown>, n = 100): Promise<number> => {
      await fn()
      const t = performance.now()
      for (let i = 0; i < n; i++) await fn()
      return (performance.now() - t) / n
    }
    const searchMs = await bench(() => index.search('memory'))
    const prefixMs = await bench(() => index.search('prog'))
    const quickMs = await bench(() => index.quickOpen('sysprog'))

    // The keystroke path: one upsert plus the two link queries the panels run.
    // This sits directly on CodeMirror's input path, so it is the number that
    // decides whether typing feels right.
    const victim = docs[Math.floor(docs.length / 2)]
    const keystrokeMs = await bench(async () => {
      index.upsert({ ...victim, text: `${victim.text} x` })
      await index.backlinks(victim.path)
      await index.outgoing(victim.guid)
    }, 50)

    console.log(
      [
        `docs=${docs.length} bytes=${(bytes / 1e6).toFixed(2)}MB`,
        `read+decode=${readMs.toFixed(0)}ms build=${buildMs.toFixed(0)}ms`,
        `terms=${stats.terms} links=${stats.links} unresolved=${stats.unresolved} tags=${stats.tags}`,
        `search=${searchMs.toFixed(2)}ms prefix=${prefixMs.toFixed(2)}ms quickOpen=${quickMs.toFixed(3)}ms`,
        `keystroke(upsert+backlinks+outgoing)=${keystrokeMs.toFixed(2)}ms`,
        `heap=${(process.memoryUsage().heapUsed / 1e6).toFixed(1)}MB`,
      ].join('\n')
    )

    // The Fork 1 trigger. If any of these fail, the SQLite backend is due —
    // see plans/v2-shaping.md and shaping.md Spike S5.
    expect(docs.length, 'file-count trigger').toBeLessThan(5000)
    expect(bytes, 'corpus-size trigger').toBeLessThan(20e6)
    expect(buildMs, 'cold-build trigger').toBeLessThan(750)
    expect(Math.max(searchMs, prefixMs), 'search-latency trigger').toBeLessThan(50)
    // A keystroke must not cost a frame. Before the link graph became
    // incremental this was 11.9 ms on this corpus.
    expect(keystrokeMs, 'per-keystroke index cost').toBeLessThan(4)
  })
})
