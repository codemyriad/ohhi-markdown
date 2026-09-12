/** Where the generated JSON Schemas live: `<repo root>/spec`. */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Walk up for `rush.json`; the repo root is the only anchor that survives src/ vs dist/. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from)
  for (;;) {
    if (existsSync(resolve(dir, 'rush.json'))) return dir
    const up = dirname(dir)
    if (up === dir) throw new Error('not inside the Editor monorepo: no rush.json above ' + from)
    dir = up
  }
}

export function specDir(from?: string): string {
  return resolve(repoRoot(from), 'spec')
}

export const SCHEMA_ID_BASE = 'https://ohhi.md/schema'
