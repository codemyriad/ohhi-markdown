/**
 * Spike S10-Q4 — how long does linking a NEW device take?
 *
 *   rushx bench:pull                       # 1,029 files (the real vault), 3 runs
 *   BENCH_FILES=5000 BENCH_RUNS=1 rushx bench:pull
 *
 * The measurement, end to end, on a real filesystem and the real relay:
 *   1. generate a synthetic vault shaped like Chris's (see gen-vault.ts);
 *   2. SEED it: a headless MountSession enrolls the vault into a fresh room
 *      and we wait until every doc record is synced with no unacked local
 *      updates — the pill-green, durably-acked condition (golden rule 4);
 *   3. stop the seeder AND the relay (a linked device pulls from the relay,
 *      not from a live peer — this also forces the relay to reload every doc
 *      from SQLite, the cold path);
 *   4. JOIN: a second MountSession over an EMPTY folder with `firstJoin`,
 *      timed from construction to the boot promise resolving.
 *
 * `rushx test` never collects this file (vitest's default include is
 * `**​/*.{test,spec}.*`); it runs only through `bench/vitest.bench.config.ts`.
 * `bench/` is also outside the package tsconfig's `include`, so `rushx check`
 * skips it — it does typecheck under the package's own compiler settings.
 */
import { mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { describe, it } from 'vitest'
import { generateVault } from './gen-vault.js'
import { startRelay } from './relay-child.js'
import { allSynced, countSynced, createMount, newProbe, now, waitFor } from './harness.js'
import { FOLDER_RECORD_KEY } from '../src/types.js'

const FILES = Number(process.env.BENCH_FILES ?? 1029)
const RUNS = Number(process.env.BENCH_RUNS ?? 3)
const SEED = Number(process.env.BENCH_SEED ?? 20260910)
const ROOM = 'benchroom'
const TOKEN = 'bench-token'
const KEEP = process.env.BENCH_KEEP === '1'
const BASE_TMP = process.env.BENCH_TMP ?? tmpdir()

interface RunResult {
  run: number
  folderMs: number | null
  p50Ms: number | null
  p90Ms: number | null
  p100Ms: number | null
  materializeMs: number | null
  bootMs: number
  docsSynced: number
  filesOnDisk: number
  bytesOnDisk: number
  peakSockets: number
  totalSockets: number
  storeWrites: string
  error: string | null
}

/** Durable-store write volume, biggest first — write amplification, visible. */
function storeSummary(probe: { storeWrites: Map<string, { count: number; bytes: number }> }): string {
  return [...probe.storeWrites]
    .sort((a, b) => b[1].bytes - a[1].bytes)
    .slice(0, 5)
    .map(([name, w]) => `${name} ${w.count}x/${(w.bytes / 1e6).toFixed(0)}MB`)
    .join('  ')
}

const ms = (v: number | null): string => (v === null ? '—' : `${(v / 1000).toFixed(1)}s`)

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

async function walk(root: string): Promise<{ files: number; bytes: number; paths: string[] }> {
  const paths: string[] = []
  let bytes = 0
  const rec = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await rec(full)
      else {
        paths.push(relative(root, full).split(sep).join('/'))
        bytes += (await stat(full)).size
      }
    }
  }
  await rec(root)
  return { files: paths.length, bytes, paths: paths.sort() }
}

describe('S10-Q4 — whole-vault pull onto a fresh device', () => {
  it(
    `pulls ${FILES} markdown files into an empty folder (${RUNS} run(s))`,
    async () => {
      const base = await mkdtemp(join(BASE_TMP, 'editor-pull-bench-'))
      const seedVault = join(base, 'seed-vault')
      const seedStore = join(base, 'seed-store')
      const relayData = join(base, 'relay')
      for (const d of [seedVault, seedStore, relayData]) await mkdir(d, { recursive: true })

      const genT0 = now()
      const vault = await generateVault(seedVault, FILES, SEED)
      const genMs = now() - genT0

      // ---- seed ----
      let relay = await startRelay({ dataDir: relayData, seedShare: `${ROOM}:${TOKEN}` })
      const seedProbe = newProbe()
      const seedT0 = now()
      const seeder = await createMount({
        vaultDir: seedVault,
        storeRoot: seedStore,
        room: ROOM,
        relay: { url: relay.url, token: TOKEN },
        probe: seedProbe,
      })
      const enrollMs = now() - seedT0
      let lastLog = 0
      await waitFor(
        'seed durable ack',
        () => allSynced(seedProbe, vault.files),
        40 * 60_000,
        () => {
          const n = countSynced(seedProbe)
          if (n - lastLog >= 200) {
            lastLog = n
            process.stdout.write(`  seeding: ${n}/${vault.files} docs acked\n`)
          }
        }
      )
      const seedMs = now() - seedT0
      const seedPeak = seedProbe.sockets.peak
      const seedStoreWrites = storeSummary(seedProbe)
      await seeder.shutdown()
      await relay.stop()

      // ---- join, once per run (relay restarted cold each time) ----
      const results: RunResult[] = []
      for (let run = 1; run <= RUNS; run++) {
        relay = await startRelay({ dataDir: relayData, seedShare: `${ROOM}:${TOKEN}` })
        const joinVault = join(base, `join-${run}`)
        const joinStore = join(base, `join-store-${run}`)
        await mkdir(joinVault, { recursive: true })
        await mkdir(joinStore, { recursive: true })

        const probe = newProbe()
        const t0 = now()
        probe.t0 = t0
        let error: string | null = null
        let bootMs = 0
        let session: Awaited<ReturnType<typeof createMount>> | null = null
        try {
          session = await createMount({
            vaultDir: joinVault,
            storeRoot: joinStore,
            room: ROOM,
            relay: { url: relay.url, token: TOKEN },
            firstJoin: true,
            probe,
          })
          bootMs = now() - t0
        } catch (err) {
          bootMs = now() - t0
          error = String(err)
        }

        const docTimes = [...probe.syncedAt]
          .filter(([key]) => key !== FOLDER_RECORD_KEY)
          .map(([, at]) => at - t0)
          .sort((a, b) => a - b)
        const at = (fraction: number): number | null => {
          if (docTimes.length === 0) return null
          const idx = Math.min(docTimes.length - 1, Math.ceil(fraction * vault.files) - 1)
          return idx < docTimes.length ? docTimes[idx]! : null
        }
        const folderAt = probe.syncedAt.get(FOLDER_RECORD_KEY)
        const disk = await walk(joinVault)
        const lastSync = docTimes.at(-1) ?? null
        results.push({
          run,
          folderMs: folderAt === undefined ? null : folderAt - t0,
          p50Ms: at(0.5),
          p90Ms: at(0.9),
          p100Ms: docTimes.length >= vault.files ? at(1) : null,
          materializeMs: lastSync === null ? null : bootMs - lastSync,
          bootMs,
          docsSynced: docTimes.length,
          filesOnDisk: disk.files,
          bytesOnDisk: disk.bytes,
          peakSockets: probe.sockets.peak,
          totalSockets: probe.sockets.opened,
          storeWrites: storeSummary(probe),
          error,
        })

        // Content check: the pull must reproduce the vault byte for byte.
        if (!error) {
          const source = await walk(seedVault)
          const missing = source.paths.filter((p) => !disk.paths.includes(p))
          if (missing.length > 0) {
            process.stdout.write(`  !! ${missing.length} paths missing, e.g. ${missing[0]}\n`)
          }
          for (const p of [source.paths[0]!, source.paths.at(-1)!]) {
            const a = await readFile(join(seedVault, p))
            const b = await readFile(join(joinVault, p)).catch(() => null)
            if (!b || !a.equals(b)) process.stdout.write(`  !! content mismatch at ${p}\n`)
          }
        }

        await session?.shutdown()
        await relay.stop()
        if (!KEEP) await rm(joinVault, { recursive: true, force: true })
      }

      // ---- table ----
      const lines: string[] = []
      lines.push('')
      lines.push('Spike S10-Q4 — whole-vault pull onto a fresh device')
      lines.push(
        `corpus: ${vault.files} .md / ${(vault.bytes / 1e6).toFixed(2)} MB / max depth ${vault.maxDepth} ` +
          `(generated in ${genMs.toFixed(0)}ms, seed ${SEED})`
      )
      lines.push(
        `seeder: enroll ${(enrollMs / 1000).toFixed(1)}s, all docs durably acked ` +
          `${(seedMs / 1000).toFixed(1)}s, peak sockets ${seedPeak}`
      )
      lines.push(`seeder store writes: ${seedStoreWrites}`)
      lines.push('')
      const head = ['run', 'folder', '50% docs', '90% docs', '100% docs', 'materialize', 'BOOT', 'files', 'MB', 'sockets']
      const rows = results.map((r) => [
        String(r.run),
        ms(r.folderMs),
        ms(r.p50Ms),
        ms(r.p90Ms),
        ms(r.p100Ms),
        ms(r.materializeMs),
        r.error ? 'FAIL' : ms(r.bootMs),
        `${r.filesOnDisk}`,
        (r.bytesOnDisk / 1e6).toFixed(2),
        `${r.peakSockets}`,
      ])
      const ok = results.filter((r) => !r.error)
      if (ok.length > 0) {
        rows.push([
          'median',
          ms(median(ok.map((r) => r.folderMs ?? 0))),
          ms(median(ok.map((r) => r.p50Ms ?? 0))),
          ms(median(ok.map((r) => r.p90Ms ?? 0))),
          ms(median(ok.map((r) => r.p100Ms ?? 0))),
          ms(median(ok.map((r) => r.materializeMs ?? 0))),
          ms(median(ok.map((r) => r.bootMs))),
          '',
          '',
          '',
        ])
      }
      const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)))
      const fmt = (cells: string[]): string =>
        cells.map((c, i) => c.padStart(widths[i]!)).join('  ')
      lines.push(fmt(head))
      lines.push(widths.map((w) => '-'.repeat(w)).join('  '))
      for (const row of rows) lines.push(fmt(row))
      lines.push('')
      for (const r of results) {
        if (r.error) lines.push(`run ${r.run} FAILED: ${r.error}`)
        lines.push(
          `run ${r.run}: ${r.docsSynced}/${vault.files} doc providers synced, ` +
            `${r.totalSockets} sockets opened (peak concurrent ${r.peakSockets}), ` +
            `slowest provider ${ms(r.p100Ms)} of the 60s timeout`
        )
        lines.push(`         store writes: ${r.storeWrites}`)
      }
      lines.push('')
      process.stdout.write(lines.join('\n'))

      if (!KEEP) await rm(base, { recursive: true, force: true })
      else process.stdout.write(`kept: ${base}\n`)
    },
    Number(process.env.BENCH_TIMEOUT_MS ?? 90 * 60_000)
  )
})
