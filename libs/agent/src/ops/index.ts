/**
 * THE REGISTRY. Nineteen ops, one per file, keyed by the contract's own op
 * names — so "is every op implemented?" is a type error, not a review comment.
 *
 * `apps/cli` walks this to build its usage text and its MCP tool list; nothing
 * downstream may keep its own list of ops (shaping R3).
 */
import { OP_NAMES, OpError, type OpInput, type OpName, type OpOutput } from '../contract.js'
import type { VaultBackend } from '../backend.js'
import type { OpDef } from '../op.js'
import { append } from './append.js'
import { backlinks } from './backlinks.js'
import { changes } from './changes.js'
import { fm } from './fm.js'
import { links } from './links.js'
import { ls } from './ls.js'
import { mv } from './mv.js'
import { patch } from './patch.js'
import { read } from './read.js'
import { resolve } from './resolve.js'
import { restore } from './restore.js'
import { rm } from './rm.js'
import { search } from './search.js'
import { skill } from './skill.js'
import { skills } from './skills.js'
import { stats } from './stats.js'
import { tags } from './tags.js'
import { unresolved } from './unresolved.js'
import { write } from './write.js'

export const OPS: { [N in OpName]: OpDef<N> } = {
  ls,
  read,
  search,
  links,
  backlinks,
  unresolved,
  tags,
  resolve,
  stats,
  changes,
  skills,
  skill,
  write,
  patch,
  append,
  fm,
  mv,
  rm,
  restore,
}

/** Is this string one of ours? The CLI's "unknown op" check. */
export const isOpName = (name: string): name is OpName => (OP_NAMES as readonly string[]).includes(name)

/**
 * Validate raw input through the op's own zod schema, then run it.
 *
 * Every host — the CLI, `ohhi mcp`, a test — comes through here, so a bad
 * field is refused with the SAME message and the same `usage` code wherever
 * it was typed, and no host re-checks something the contract already says.
 */
export async function runOp<N extends OpName>(
  backend: VaultBackend,
  name: N,
  raw: unknown
): Promise<OpOutput<N>> {
  const op = OPS[name]
  const parsed = op.input.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
    throw new OpError('usage', `${name}: ${where}${issue.message}`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  return op.run(backend, parsed.data as OpInput<N>) as Promise<OpOutput<N>>
}
