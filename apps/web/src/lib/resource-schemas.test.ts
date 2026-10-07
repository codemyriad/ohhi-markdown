/**
 * `spec/ohhi.{layout,keymap}.v1.schema.json`, `examples/` and the id lists in
 * `docs/customising.md` are GENERATED (quiet-shell F16, golden rule 9) — this
 * is their drift test, the app's twin of apps/cli's conformance test. A change
 * to a command table, the readout catalogue, a preset or a schema that was
 * not regenerated fails here:
 *
 *   cd apps/web && rushx gen-schemas
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { generateExamples, generateResourceSchemas, renderDocLists } from './resource-schemas.js'

function repoRoot(): string {
  let dir = resolve(process.cwd())
  while (!existsSync(join(dir, 'rush.json'))) {
    const up = dirname(dir)
    if (up === dir) throw new Error('no rush.json above ' + process.cwd())
    dir = up
  }
  return dir
}
const root = repoRoot()
const onDisk = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '')
const regen = 'run `cd apps/web && rushx gen-schemas`'

describe('generated files are what the code says (no drift)', () => {
  it('spec/ holds the two resource schemas, byte for byte', () => {
    for (const [name, text] of generateResourceSchemas()) {
      expect(onDisk(join(root, 'spec', name)), `spec/${name} is stale — ${regen}`).toBe(text)
    }
  })
  it('examples/ holds the presets and the example keymap, byte for byte', () => {
    for (const [rel, text] of generateExamples()) {
      expect(onDisk(join(root, 'examples', rel)), `examples/${rel} is stale — ${regen}`).toBe(text)
    }
  })
  it('docs/customising.md carries the current id lists', () => {
    const docs = onDisk(join(root, 'docs', 'customising.md'))
    expect(renderDocLists(docs), `docs/customising.md's lists are stale — ${regen}`).toBe(docs)
  })
})
