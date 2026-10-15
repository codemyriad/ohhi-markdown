import { parseFrontmatter, patchFrontmatter, type FmOp } from '@ohhi/frontmatter'
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
    const dryRun = input.dryRun ?? false
    if (ops.length === 0) {
      const { path, text, hash } = await openForRead(backend, input.path)
      if (input.expectHash !== undefined && hash !== input.expectHash) {
        throw new OpError('conflict', `${path} changed since you read it — read it again`, { path, expected: input.expectHash, actual: hash })
      }
      return { schema: schemaName('fm'), path, frontmatter: readFrontmatter(text), ops: 0, changed: false, hash, journalSeq: null, dryRun }
    }
    const note = await openForWrite(backend, input.path, input.expectHash)
    if (!note.exists) throw new OpError('not_found', `no such note: ${note.path}`, { path: note.path })

    // A block outside the flat subset is the NOTE's state, and the answer
    // is the editor; everything the loop below refuses is about the ops.
    const block = parseFrontmatter(note.text)
    if (block.present && !block.supported) {
      const reason = block.reason ?? 'invalid'
      throw new OpError('refused', `${note.path}: frontmatter ${BLOCK_REASONS[reason] ?? reason} — edit it in the note instead`, {
        path: note.path,
        reason,
      })
    }
    let text = note.text
    for (const op of ops) {
      const result = patchFrontmatter(text, op)
      if (!result.ok) {
        throw new OpError('refused', `${note.path}: ${opRefusal(op, result.reason)}`, { path: note.path, reason: result.reason, op })
      }
      text = result.text
    }
    const changed = text !== note.text
    const done = changed && !dryRun ? await commit(backend, note, text, false) : null
    return {
      schema: schemaName('fm'),
      path: note.path,
      frontmatter: readFrontmatter(text),
      ops: ops.length,
      changed,
      // The hash ON DISK: after the write, or unchanged on a dry run.
      hash: done ? done.hash : (note.hash ?? ''),
      journalSeq: done ? done.journalSeq : null,
      dryRun,
    }
  },
}

/** The words for a block the patcher cannot address at all. */
const BLOCK_REASONS: Record<string, string> = {
  nested: 'is nested YAML (outside the flat subset)',
  multiline: 'has a multi-line value (outside the flat subset)',
  anchor: 'uses anchors (outside the flat subset)',
  invalid: 'is not valid YAML',
  'duplicate-key': 'has a duplicate key',
}

/** The words for an op the block could not take. */
function opRefusal(op: FmOp, reason: string): string {
  if (op.op === 'rename' && reason === 'duplicate-key') return `\`${op.to}\` already exists — unset it first, or pick another name`
  if (op.op === 'rename' && reason === 'missing-key') return `no key \`${op.key}\` to rename`
  if (reason === 'multiline') return `the value for \`${op.key}\` spans lines — a value is one line`
  if (reason === 'invalid-key') return `\`${op.key}\` is not a key the subset writes`
  if (reason === 'invalid-value') return `the value for \`${op.key}\` is not one the subset writes`
  return `${op.op} \`${op.key}\`: ${reason}`
}

/** `rename` → `remove` → `set`, in the order the input lists each. */
function opsOf(input: OpInput<'fm'>): FmOp[] {
  const ops: FmOp[] = []
  for (const [key, to] of Object.entries(input.rename ?? {})) ops.push({ op: 'rename', key, to })
  for (const key of input.unset ?? []) ops.push({ op: 'remove', key })
  for (const [key, value] of Object.entries(input.set ?? {})) ops.push({ op: 'set', key, value })
  return ops
}
