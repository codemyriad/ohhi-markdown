/**
 * `spec/` GENERATOR — never hand-edit the files it writes.
 *
 * Shaping A9/R7: the `--json` documents are a named, versioned contract, and
 * the way a contract stays true is that it is emitted from the same zod
 * schemas the code runs on. `test/conformance.test.ts` regenerates and diffs,
 * so a change to `libs/agent/src/contract.ts` that is not regenerated fails
 * the build instead of silently shipping a lie.
 *
 *   rushx gen-schemas     # rewrite spec/
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ErrorOut, OP_NAMES, OP_SCHEMAS, schemaName } from '@editor/agent'
import { SCHEMA_ID_BASE, specDir } from './spec-dir.js'

/** File name for an op's output schema, e.g. `ohhi.search.v1.schema.json`. */
const schemaFileName = (op: string): string => `${schemaName(op)}.schema.json`

function toSchema(schema: z.ZodType, name: string, description: string): string {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output' }) as Record<string, unknown>
  const { $schema, ...rest } = json
  const document = {
    $schema: ($schema as string | undefined) ?? 'https://json-schema.org/draft/2020-12/schema',
    $id: `${SCHEMA_ID_BASE}/${name}.schema.json`,
    title: name,
    description,
    ...rest,
  }
  return JSON.stringify(document, null, 2) + '\n'
}

/**
 * Every file `spec/` should contain, as `name → JSON text`. Pure: the
 * conformance test calls it and compares with what is on disk.
 */
export function generateSchemas(): Map<string, string> {
  const files = new Map<string, string>()
  for (const op of OP_NAMES) {
    files.set(schemaFileName(op), toSchema(OP_SCHEMAS[op].output, schemaName(op), OP_SCHEMAS[op].description))
  }
  files.set(
    schemaFileName('error'),
    toSchema(ErrorOut, schemaName('error'), 'Any ohhi command that failed, printed on stdout in --json mode. Exit codes: usage 2, conflict 3, everything else 1.')
  )
  return files
}

/** Writes `spec/`, returning the paths written. */
export function writeSchemas(dir: string = specDir()): string[] {
  mkdirSync(dir, { recursive: true })
  const written: string[] = []
  for (const [name, text] of generateSchemas()) {
    writeFileSync(join(dir, name), text, 'utf8')
    written.push(join(dir, name))
  }
  return written
}

/** What is on disk now, for the drift check. */
export function readSchemas(dir: string = specDir()): Map<string, string> {
  const onDisk = new Map<string, string>()
  for (const name of generateSchemas().keys()) {
    try {
      onDisk.set(name, readFileSync(join(dir, name), 'utf8'))
    } catch {
      onDisk.set(name, '')
    }
  }
  return onDisk
}

const isMain = process.argv[1] !== undefined && /gen-schemas(\.[cm]?[jt]s)?$/.test(process.argv[1])
if (isMain) {
  const written = writeSchemas()
  process.stderr.write(`wrote ${written.length} schemas to ${specDir()}\n`)
}
