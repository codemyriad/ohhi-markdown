/**
 * THE CONTRACT TEST (shaping A9 / R7, build brief A2.5).
 *
 * Three things, none of which can be true by accident:
 *   (a) `spec/` on disk is byte-identical to what the contract generates —
 *       a schema change that was not regenerated fails here;
 *   (b) every op, run end-to-end through `run([... , '--json'])` over a
 *       fixture vault, emits exactly one document that its own zod output
 *       schema accepts;
 *   (c) the exit codes are what the skill's failure-decoding table says.
 */
import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ErrorOut, OP_NAMES, OP_SCHEMAS, type OpName } from '@ohhi/agent'
import { generateSchemas, readSchemas } from '../src/gen-schemas.js'
import { fixture, inVault, ohhi } from './helpers.js'

/** One argv per op that produces a non-trivial document over the fixture. */
const INVOCATIONS: Record<OpName, string[]> = {
  ls: ['ls', 'Areas'],
  read: ['read', 'Projects/Editor.md'],
  search: ['search', 'JSON'],
  links: ['links', 'Projects/Editor.md'],
  backlinks: ['backlinks', 'JSON'],
  unresolved: ['unresolved'],
  tags: ['tags'],
  resolve: ['resolve', 'JSON'],
  stats: ['stats'],
  changes: ['changes', '--since', '1970-01-01T00:00:00.000Z'],
  skills: ['skills'],
  skill: ['skill', 'line-edit'],
  collections: ['collections'],
  rows: ['rows', 'Competitors.base', '--view', 'Direct', '--where', 'depth == "Deep"'],
  write: ['write', 'Inbox/New Note.md', '--text', 'hello\n'],
  patch: ['patch', 'Areas/CS/JSON.md', '--old', 'JSON is a data format.', '--new', 'JSON is a data format!'],
  append: ['append', 'TODO/Writing.md', '--text', 'appended line\n'],
  fm: ['fm', 'Projects/Editor.md', '--set', 'status=done', '--unset', 'draft'],
  mv: ['mv', 'Areas/CS/HTML.md', 'Areas/CS/HTML (renamed).md'],
  rm: ['rm', 'Daily/02-5-2024.md'],
  restore: ['restore', 'Areas/CS/JSON.md', '--list'],
}

/**
 * Ops that need the vault touched first. `restore --list` succeeds with an
 * empty list before anything has written the note (an empty list means an
 * empty list), so this write is here to exercise a POPULATED `entries` array
 * against the schema rather than to keep the call from failing.
 */
const SETUP: Partial<Record<OpName, string[][]>> = {
  restore: [['append', 'Areas/CS/JSON.md', '--text', 'a line the journal will remember']],
}

describe('spec/ is generated, never hand-edited', () => {
  it('every schema on disk equals the freshly generated one', () => {
    const fresh = generateSchemas()
    const onDisk = readSchemas()
    for (const [name, text] of fresh) {
      expect(onDisk.get(name), `${name} is missing from spec/ — run \`rushx gen-schemas\``).not.toBe('')
      expect(onDisk.get(name), `${name} drifted from the contract — run \`rushx gen-schemas\``).toBe(text)
    }
  })

  it('covers every op plus the error document', () => {
    const names = [...generateSchemas().keys()]
    expect(names).toHaveLength(OP_NAMES.length + 1)
    for (const op of OP_NAMES) expect(names).toContain(`ohhi.${op}.v1.schema.json`)
    expect(names).toContain('ohhi.error.v1.schema.json')
  })

  it('every schema carries its $id and title', () => {
    for (const [name, text] of generateSchemas()) {
      const doc = JSON.parse(text) as { $id: string; title: string; $schema: string }
      expect(doc.$id).toBe(`https://ohhi.md/schema/${name}`)
      expect(doc.title).toBe(name.replace('.schema.json', ''))
      expect(doc.$schema).toContain('json-schema.org')
    }
  })
})

describe('--json output conforms to the contract', () => {
  for (const op of OP_NAMES) {
    it(`${op} emits one ohhi.${op}.v1 document`, async () => {
      const v = await fixture()
      for (const setup of SETUP[op] ?? []) {
        const prep = await ohhi(inVault(v, [...setup, '--json']))
        expect(prep.code, `setup for ohhi ${op}`).toBe(0)
      }
      const { out, code } = await ohhi(inVault(v, [...INVOCATIONS[op], '--json']))
      expect(code, `ohhi ${op} should succeed over the fixture`).toBe(0)
      // Exactly one JSON object, one trailing newline, nothing else on stdout.
      expect(out.endsWith('\n')).toBe(true)
      expect(out.trimEnd().includes('\n')).toBe(false)
      const doc = JSON.parse(out) as { schema: string }
      expect(doc.schema).toBe(`ohhi.${op}.v1`)
      const parsed = OP_SCHEMAS[op].output.safeParse(doc)
      expect(parsed.success ? null : JSON.stringify(parsed.error?.issues)).toBeNull()
    })
  }

  it('every list carries returned/total/nextCursor', async () => {
    const v = await fixture()
    for (const op of ['ls', 'search', 'links', 'backlinks', 'unresolved', 'tags', 'changes', 'skills'] as const) {
      const { out } = await ohhi(inVault(v, [...INVOCATIONS[op], '--json']))
      const doc = JSON.parse(out) as Record<string, unknown>
      expect(Object.keys(doc), op).toEqual(expect.arrayContaining(['returned', 'total', 'nextCursor']))
    }
  })

  it('everything that walks the vault carries coverage', async () => {
    const v = await fixture()
    for (const op of ['ls', 'search', 'stats'] as const) {
      const { out } = await ohhi(inVault(v, [...INVOCATIONS[op], '--json']))
      const doc = JSON.parse(out) as Record<string, unknown>
      const hasCoverage = 'coverage' in doc || ('skippedBinary' in doc && 'ignored' in doc)
      expect(hasCoverage, `${op} must say what it looked at`).toBe(true)
    }
  })
})

describe('exit codes are a contract', () => {
  it('0 — a search with no hits is a successful answer', async () => {
    const v = await fixture()
    const { out, code } = await ohhi(inVault(v, ['search', 'zzzznothinghere', '--json']))
    expect(code).toBe(0)
    expect((JSON.parse(out) as { hits: unknown[] }).hits).toEqual([])
  })

  it('2 — an unknown command', async () => {
    const v = await fixture()
    const { code, err, out } = await ohhi(inVault(v, ['frobnicate']))
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain('unknown command')
    expect(err).toContain('COMMANDS')
  })

  it('2 — no vault named and none found by walking up', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ohhi-novault-'))
    const { code, err } = await ohhi(['stats'], { cwd })
    rmSync(cwd, { recursive: true, force: true })
    expect(code).toBe(2)
    expect(err).toContain('--vault')
  })

  it('2 — the error document is on stdout in --json mode', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ohhi-novault-'))
    const { code, out } = await ohhi(['stats', '--json'], { cwd })
    rmSync(cwd, { recursive: true, force: true })
    expect(code).toBe(2)
    const doc = ErrorOut.parse(JSON.parse(out))
    expect(doc.schema).toBe('ohhi.error.v1')
    expect(doc.code).toBe('usage')
  })

  it('3 — --expect-hash mismatch, and nothing is written', async () => {
    const v = await fixture()
    const before = await ohhi(inVault(v, ['read', 'Areas/CS/JSON.md', '--json']))
    const { code, out } = await ohhi(
      inVault(v, ['write', 'Areas/CS/JSON.md', '--text', 'clobbered', '--expect-hash', '0'.repeat(64), '--json'])
    )
    expect(code).toBe(3)
    expect(ErrorOut.parse(JSON.parse(out)).code).toBe('conflict')
    const after = await ohhi(inVault(v, ['read', 'Areas/CS/JSON.md', '--json']))
    expect(JSON.parse(after.out)).toEqual(JSON.parse(before.out))
  })

  it('1 — reading a note that is not there', async () => {
    const v = await fixture()
    const { code, out } = await ohhi(inVault(v, ['read', 'Nope.md', '--json']))
    expect(code).toBe(1)
    expect(ErrorOut.parse(JSON.parse(out)).code).toBe('not_found')
  })

  it('1 — a refused write (patch target is not unique)', async () => {
    const v = await fixture()
    const { code, out } = await ohhi(
      inVault(v, ['patch', 'Edible/Dev Notes/SnapMenu - Restaurant JSON Import.md', '--old', 'json', '--new', 'JSON', '--json'])
    )
    expect(code).toBe(1)
    expect(ErrorOut.parse(JSON.parse(out)).code).toBe('refused')
  })
})
