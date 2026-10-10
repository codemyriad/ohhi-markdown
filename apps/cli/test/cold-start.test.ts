/**
 * R6: a cold `ohhi` invocation on the real vault stays under ~500 ms. The
 * bundle is what makes that possible — `rushx build` esbuilds `src/main.ts`
 * into `dist/ohhi.mjs`, so start-up is not Rush's TypeScript loader — and
 * code splitting keeps `ask` (the AI SDK) and `mcp` (the MCP SDK) in
 * `dist/chunks/`, loaded only by the commands that need them.
 *
 * Skipped when `dist/` is absent (a plain `rushx test` on a fresh clone);
 * CI runs `rushx build` first. Under `EDITOR_BENCH_VAULT` it measures the
 * real vault and asserts the budget.
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { OP_NAMES } from '@ohhi/agent'
import { fixture } from './helpers.js'

const BUNDLE = resolve(process.cwd(), 'dist/ohhi.mjs')
const BUDGET_MS = 500

const runBundle = (argv: string[]): { stdout: string; ms: number } => {
  const started = performance.now()
  const stdout = execFileSync(process.execPath, [BUNDLE, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return { stdout, ms: performance.now() - started }
}

describe.skipIf(!existsSync(BUNDLE))('the shipped bundle', () => {
  it('answers `stats` over a fixture vault, exit 0', async () => {
    const v = await fixture()
    const { stdout } = runBundle(['stats', '--vault', v.root, '--data-dir', v.dataDir, '--json'])
    const doc = JSON.parse(stdout) as { schema: string; docs: number }
    expect(doc.schema).toBe('ohhi.stats.v1')
    expect(doc.docs).toBeGreaterThan(5)
  })

  it('prints usage with no arguments, exit 0', () => {
    const { stdout } = runBundle([])
    expect(stdout).toContain('COMMANDS')
  })

  it('serves the same vocabulary over stdio MCP', async () => {
    const v = await fixture()
    const client = new Client({ name: 'ohhi-conformance', version: '0.0.0' }, { capabilities: {} })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BUNDLE, 'mcp', '--vault', v.root, '--data-dir', v.dataDir],
    })
    try {
      await client.connect(transport)
      const { tools } = await client.listTools()
      expect(tools.map((t) => t.name).sort()).toEqual(OP_NAMES.map((op) => `ohhi_${op}`).sort())

      const stats = (await client.callTool({ name: 'ohhi_stats', arguments: {} })) as {
        isError?: boolean
        content: { text: string }[]
      }
      expect(stats.isError).toBeFalsy()
      expect(JSON.parse(stats.content[0].text)).toMatchObject({ schema: 'ohhi.stats.v1' })

      const bad = (await client.callTool({ name: 'ohhi_read', arguments: { path: 'Nope.md' } })) as {
        isError?: boolean
        content: { text: string }[]
      }
      expect(bad.isError).toBe(true)
      expect(JSON.parse(bad.content[0].text)).toMatchObject({ schema: 'ohhi.error.v1', code: 'not_found' })
    } finally {
      await client.close().catch(() => {})
    }
  }, 20_000)

  const bench = process.env.EDITOR_BENCH_VAULT
  it.skipIf(!bench)(`answers a real vault in under ${BUDGET_MS} ms, cold`, () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'ohhi-bench-'))
    try {
      // One warm-up for the page cache, then the measured run.
      runBundle(['stats', '--vault', bench!, '--data-dir', dataDir, '--json'])
      const { stdout, ms } = runBundle(['stats', '--vault', bench!, '--data-dir', dataDir, '--json'])
      const doc = JSON.parse(stdout) as { docs: number; buildMs: number }
      process.stderr.write(`cold start: ${ms.toFixed(0)} ms for ${doc.docs} notes (index build ${doc.buildMs.toFixed(0)} ms)\n`)
      expect(ms).toBeLessThan(BUDGET_MS)
    } finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})
