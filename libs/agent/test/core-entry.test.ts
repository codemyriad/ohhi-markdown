/**
 * `@ohhi/agent/core` and `@ohhi/agent/skills` are what a browser bundle
 * (the app's harness) imports: nothing reachable from them may name a Node
 * builtin or `@ohhi/vault/node`. Walked over the source, so a new import
 * that drags the files backend in fails here rather than in `vite build`.
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const FORBIDDEN = /^(node:|@ohhi\/vault\/node$|fs$|path$|os$)/

/** Every module reachable from `entry` through relative imports, with its bare specifiers. */
function graph(entry: string): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const visit = (file: string): void => {
    if (out.has(file)) return
    const text = readFileSync(file, 'utf8')
    const specs = [...text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]!)
    out.set(file, specs.filter((s) => !s.startsWith('.')))
    for (const s of specs.filter((s) => s.startsWith('.'))) visit(join(dirname(file), s.replace(/\.js$/, '.ts')))
  }
  visit(join(SRC, entry))
  return out
}

describe('the browser-safe entries', () => {
  for (const entry of ['core.ts', 'skills.ts']) {
    it(`${entry} reaches no Node module`, () => {
      const bad = [...graph(entry)].flatMap(([file, specs]) =>
        specs.filter((s) => FORBIDDEN.test(s)).map((s) => `${file.slice(SRC.length + 1)} → ${s}`),
      )
      expect(bad).toEqual([])
    })
  }

  it('core carries what the harness runs: the contract, the ops and the read helpers', async () => {
    const core = await import('../src/core.js')
    expect(typeof core.runOp).toBe('function')
    expect(typeof core.OpError).toBe('function')
    expect(typeof core.openForRead).toBe('function')
    expect(core.OP_NAMES).toContain('search')
    expect('createFilesBackend' in core).toBe(false)
  })
})
