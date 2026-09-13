/** Where the generated JSON Schemas live: `<repo root>/spec`. */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Walk up for `rush.json`; the repo root is the only anchor that survives src/ vs dist/. */
export function specDir(): string {
  const from = process.cwd()
  let dir = resolve(from)
  for (;;) {
    if (existsSync(resolve(dir, 'rush.json'))) return resolve(dir, 'spec')
    const up = dirname(dir)
    if (up === dir) throw new Error('not inside the Editor monorepo: no rush.json above ' + from)
    dir = up
  }
}

export const SCHEMA_ID_BASE = 'https://ohhi.md/schema'
