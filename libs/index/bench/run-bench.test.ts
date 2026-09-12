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
import { beforeAll, describe, expect, it } from 'vitest'
import { MemoryIndex } from '../src/index.js'
import type { IndexDoc } from '../src/types.js'

const VAULT = process.env.EDITOR_BENCH_VAULT

/** Read the vault into IndexDocs. Read-only, `.`-prefixed dirs skipped. */
function loadVault(root: string): IndexDoc[] {
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
  walk(root)
  return docs
}

describe.skipIf(!VAULT)('real-vault benchmark', () => {
  it('stays under the Fork 1 trigger', async () => {
    const t0 = performance.now()
    const docs = loadVault(VAULT!)
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

/**
 * THE SEVEN PROBES, on the real vault (plans/agent-surface-shaping.md,
 * "Evidence — the real vault, measured for search"; requirement R5).
 *
 * These are the exact queries and the exact notes from the evidence table:
 * single generic nouns whose word is also the vault's most frequent body term.
 * Before the tiered ranking pass, ONE of the seven put the right note first —
 * `networking`, and only because nothing large competes for it. All seven do
 * now, and this is what fails if a weight gets nudged.
 *
 * Gated on EDITOR_BENCH_VAULT so CI never depends on a real vault; the same
 * probes run in CI against the synthetic corpus in
 * test/ranking-corpus.test.ts.
 */
const PROBES: { query: string; expect: string; competitor?: string }[] = [
  // 1.1 KB; its body says "docs" ZERO times, and 296 other notes say it.
  { query: 'Docs', expect: 'Edible/Docs.md' },
  // 154 B, against a 30 KB note with 58 "json" mentions.
  { query: 'JSON', expect: 'Areas/CS/JSON.md' },
  // 961 B, against a 64 KB music list whose 39 "html" hits are all in URLs.
  { query: 'HTML', expect: 'Areas/CS/HTML.md', competitor: 'Areas/Life/Music.md' },
  { query: 'Svelte', expect: 'Areas/CS/Svelte.md' },
  { query: 'Testing', expect: 'Areas/CS/Testing.md' },
  // 120 B.
  { query: 'Writing', expect: 'TODO/Writing.md' },
  // The query Obsidian had open when the vault was measured.
  { query: 'networking', expect: 'Areas/CS/Networking.md' },
]

describe.skipIf(!VAULT)('real-vault search precision (R5)', () => {
  let index: MemoryIndex

  beforeAll(() => {
    index = new MemoryIndex()
    index.rebuild(loadVault(VAULT!))
  })

  for (const { query, expect: wanted, competitor } of PROBES) {
    it(`"${query}" puts ${wanted} first`, async () => {
      const { items, total } = await index.search(query, { limit: 3 })
      const top = items.map((h) => `${h.tier} ${h.path}`).join(' | ')
      console.log(`${query}: total=${total} → ${top}`)
      expect(items[0]?.path, top).toBe(wanted)
      expect(items[0].tier).toBe('title')
      if (competitor) {
        // The URL dump must not merely lose — it must not be on the page at all.
        const page = await index.search(query, { limit: 10 })
        expect(page.items.map((h) => h.path)).not.toContain(competitor)
      }
    })
  }

  it('grep still finds what ranking refuses to rank', async () => {
    // `Areas/Life/Music.md` mentions "html" only inside URLs. Excluding it from
    // ranking must not make it unfindable (parent shaping R7: honesty).
    const ranked = await index.search('HTML', { limit: 50 })
    expect(ranked.items.map((h) => h.path)).not.toContain('Areas/Life/Music.md')
    const t = performance.now()
    const grepped = await index.grep('html', { pathPrefix: 'Areas/Life/Music.md', limit: 100 })
    console.log(`grep html in Music.md: ${grepped.total} hits in ${(performance.now() - t).toFixed(1)}ms`)
    expect(grepped.total).toBeGreaterThan(20)
  })

  it('answers a whole-vault grep well under the search-latency trigger', async () => {
    const t = performance.now()
    await index.grep('memory', { limit: 10 })
    const ms = performance.now() - t
    console.log(`grep(memory) over the whole vault = ${ms.toFixed(1)}ms`)
    expect(ms, 'grep latency').toBeLessThan(50)
  })
})
