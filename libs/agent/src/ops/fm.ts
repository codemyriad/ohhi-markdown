import { patchFrontmatter, type FmOp } from '@ohhi/frontmatter'
import { OP_SCHEMAS, OpError, schemaName, type OpInput } from '../contract.js'
import { openForRead } from '../read.js'
import type { OpDef } from '../op.js'
import { readFrontmatter } from '../frontmatter-read.js'
import { commit, openForWrite } from '../write-file.js'

/**
 * `fm` — read a note's frontmatter, or change it one key at a time.
 *
 * Writes go through the flat-subset patcher (`libs/frontmatter`, read-shaping
 * B4): an op moves ONE value's bytes — the key's spelling, the spacing, a
 * trailing comment, every other line and the body stay as they were (golden
 * rule 2). A block the subset refuses (nested, multi-line, anchors, a
 * duplicate key) is left alone with the reason, never "fixed": the note is
 * edited in the editor instead. Order: `rename`, then `unset`, then `set`,
 * each key in the order given; the text each step sees is the previous
 * step's. The whole batch then goes to disk as one journaled, atomic,
 * compare-and-swap write — or none at all when nothing changed.
 */
export const fm: OpDef<'fm'> = {
  ...OP_SCHEMAS.fm,
  async run(backend, input) {
    const ops = opsOf(input)
    if (ops.length === 0) {
      const { path, text, hash } = await openForRead(backend, input.path)
      return { schema: schemaName('fm'), path, frontmatter: readFrontmatter(text), changed: false, hash, journalSeq: null, dryRun: false }
    }
    const note = await openForWrite(backend, input.path, input.expectHash)
    if (!note.exists) throw new OpError('not_found', `no such note: ${note.path}`, { path: note.path })
    let text = note.text
    for (const op of ops) {
      const result = patchFrontmatter(text, op)
      if (!result.ok) {
        throw new OpError('refused', `${note.path}: frontmatter ${REASONS[result.reason] ?? result.reason} — edit it in the note instead`, {
          path: note.path,
          reason: result.reason,
          op,
        })
      }
      text = result.text
    }
    const changed = text !== note.text
    const dryRun = input.dryRun ?? false
    const done = changed
      ? await commit(backend, note, text, dryRun)
      : { created: false, bytes: note.bytes?.length ?? 0, hash: note.hash ?? '', journalSeq: null }
    return { schema: schemaName('fm'), path: note.path, frontmatter: readFrontmatter(text), changed, hash: done.hash, journalSeq: done.journalSeq, dryRun }
  },
}

/** The words the refusal uses for the patcher's reasons. */
const REASONS: Record<string, string> = {
  nested: 'is nested YAML (outside the flat subset)',
  multiline: 'has a multi-line value (outside the flat subset)',
  anchor: 'uses anchors (outside the flat subset)',
  invalid: 'is not valid YAML',
  'duplicate-key': 'has a duplicate key',
  'missing-key': 'has no such key to rename',
  'invalid-key': 'was given an empty key',
  'invalid-value': 'was given a value it cannot write',
}

/** `rename` → `remove` → `set`, in the order the input lists each. */
function opsOf(input: OpInput<'fm'>): FmOp[] {
  const ops: FmOp[] = []
  for (const [key, to] of Object.entries(input.rename ?? {})) ops.push({ op: 'rename', key, to })
  for (const key of input.unset ?? []) ops.push({ op: 'remove', key })
  for (const [key, value] of Object.entries(input.set ?? {})) ops.push({ op: 'set', key, value })
  return ops
}
