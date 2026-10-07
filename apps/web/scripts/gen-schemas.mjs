/**
 * Writes the app's generated resource docs (quiet-shell F16) — never
 * hand-edit what it writes:
 *
 *   spec/ohhi.layout.v1.schema.json, spec/ohhi.keymap.v1.schema.json
 *   examples/layouts/*.json, examples/keymaps/*.json
 *   the id lists between the `generated:` markers in docs/customising.md
 *
 * The source is `src/lib/resource-schemas.ts`, loaded through Vite's module
 * runner so the TypeScript (and its JSON imports) run as the app compiles
 * them. `src/lib/resource-schemas.test.ts` fails on drift.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
let root = resolve(here)
while (!existsSync(join(root, 'rush.json'))) {
  const up = dirname(root)
  if (up === root) throw new Error('not inside the Editor monorepo: no rush.json above ' + here)
  root = up
}

const { module: m } = await runnerImport(resolve(here, '../src/lib/resource-schemas.ts'), {
  configFile: false,
  logLevel: 'error',
})

let count = 0
const write = (path, text) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text, 'utf8')
  count++
}
for (const [name, text] of m.generateResourceSchemas()) write(join(root, 'spec', name), text)
for (const [rel, text] of m.generateExamples()) write(join(root, 'examples', rel), text)
const docs = join(root, 'docs', 'customising.md')
if (existsSync(docs)) {
  const before = readFileSync(docs, 'utf8')
  const after = m.renderDocLists(before)
  if (after !== before) write(docs, after)
}
process.stderr.write(`wrote ${count} files (spec/, examples/, docs/customising.md)\n`)
