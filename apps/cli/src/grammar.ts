/**
 * THE CLI GRAMMAR — one declarative table, derived from the contract.
 *
 * Every op's flags and positionals are declared once here; `parseArgs`
 * options, the usage text, the "unknown flag for this op" check and the
 * input object handed to `OPS[op].run` all come out of this table. Adding a
 * flag is one row, not four edits — which is how the CLI stays a thin
 * adapter over `libs/agent` (shaping R3) instead of a second vocabulary.
 *
 * The input object is then validated by the op's zod input schema
 * (`OP_SCHEMAS[op].input`), so the CLI never hand-checks a field the
 * contract already describes.
 */
import { parseArgs } from 'node:util'
import { isOpName, OpError, type OpName } from '@editor/agent'

type FlagKind =
  | 'string'
  | 'number'
  /** `--lines 12-40` → `{ from: 12, to: 40 }` */
  | 'range'
  | 'boolean'
  /** A boolean that sets a fixed value on another key, e.g. `--exact` → `mode: 'exact'`. */
  | 'const'

interface FlagSpec {
  /** Key in the op's input object. */
  key: string
  kind: FlagKind
  /** Placeholder in the usage line; omitted for booleans. */
  arg?: string
  /** Value written when a `const` flag is present. */
  value?: string
  /** The op refuses to run without it (`changes --since`). */
  required?: boolean
  help: string
}

interface PositionalSpec {
  key: string
  label: string
  required: boolean
}

export interface OpGrammar {
  positionals: PositionalSpec[]
  flags: Record<string, FlagSpec>
  /** Input key filled from stdin when the corresponding flag is absent. */
  stdin?: string
}

const limit = (max: string): Record<string, FlagSpec> => ({
  limit: { key: 'limit', kind: 'number', arg: 'N', help: `max results (default 10, cap ${max})` },
  cursor: { key: 'cursor', kind: 'string', arg: 'C', help: 'continue from a previous nextCursor' },
})

const writeFlags: Record<string, FlagSpec> = {
  'expect-hash': { key: 'expectHash', kind: 'string', arg: 'H', help: "refuse unless the note's hash is H (exit 3 on mismatch)" },
  'dry-run': { key: 'dryRun', kind: 'boolean', help: 'compute and report, write nothing' },
}

/** The grammar, in the order `ohhi help` prints it (contract order). */
export const GRAMMAR: Record<OpName, OpGrammar> = {
  ls: {
    positionals: [{ key: 'dir', label: 'dir', required: false }],
    flags: {
      depth: { key: 'depth', kind: 'number', arg: 'N', help: '1 = direct children (default), 0 = whole subtree' },
      kind: { key: 'kind', kind: 'string', arg: 'text|binary|dir|all', help: 'filter by kind' },
      ...limit('1000'),
    },
  },
  read: {
    positionals: [{ key: 'path', label: 'path', required: true }],
    flags: {
      outline: { key: 'outline', kind: 'boolean', help: 'headings, line numbers and per-section sizes — no body' },
      section: { key: 'section', kind: 'string', arg: '"A/B"', help: 'one section by heading path' },
      lines: { key: 'lines', kind: 'range', arg: 'A-B', help: '1-based inclusive line range' },
      frontmatter: { key: 'frontmatter', kind: 'boolean', help: 'the frontmatter block only' },
      'max-chars': { key: 'maxChars', kind: 'number', arg: 'N', help: 'character budget (default 20000)' },
    },
  },
  search: {
    positionals: [{ key: 'query', label: 'query', required: true }],
    flags: {
      path: { key: 'path', kind: 'string', arg: 'DIR', help: 'restrict to a subtree' },
      tag: { key: 'tag', kind: 'string', arg: 'TAG', help: 'restrict to notes carrying a tag' },
      mode: { key: 'mode', kind: 'string', arg: 'ranked|exact|regex', help: 'ranked (default), literal substring, or regex' },
      exact: { key: 'mode', kind: 'const', value: 'exact', help: 'shorthand for --mode exact' },
      regex: { key: 'mode', kind: 'const', value: 'regex', help: 'shorthand for --mode regex' },
      'case-sensitive': { key: 'caseSensitive', kind: 'boolean', help: 'do not fold case (exact/regex modes)' },
      explain: { key: 'explain', kind: 'boolean', help: 'per-hit ranking contributions' },
      ...limit('100'),
    },
  },
  links: { positionals: [{ key: 'path', label: 'path', required: true }], flags: { ...limit('1000') } },
  backlinks: { positionals: [{ key: 'target', label: 'target', required: true }], flags: { ...limit('1000') } },
  unresolved: { positionals: [], flags: { ...limit('1000') } },
  tags: { positionals: [], flags: { ...limit('1000') } },
  resolve: {
    positionals: [{ key: 'target', label: 'target', required: true }],
    flags: { from: { key: 'from', kind: 'string', arg: 'PATH', help: 'the note the link is written in (proximity tie-break)' } },
  },
  stats: { positionals: [], flags: {} },
  changes: {
    positionals: [],
    flags: {
      since: { key: 'since', kind: 'string', arg: 'ISO|jN', required: true, help: 'an instant, or a journal sequence from a previous answer' },
      ...limit('1000'),
    },
  },
  write: {
    positionals: [{ key: 'path', label: 'path', required: true }],
    flags: {
      text: { key: 'text', kind: 'string', arg: 'TEXT', help: 'the new content (default: read stdin)' },
      'create-only': { key: 'createOnly', kind: 'boolean', help: 'refuse when the note already exists' },
      ...writeFlags,
    },
    stdin: 'text',
  },
  patch: {
    positionals: [{ key: 'path', label: 'path', required: true }],
    flags: {
      old: { key: 'old', kind: 'string', arg: 'TEXT', required: true, help: 'the string to replace (must be unique unless --all)' },
      new: { key: 'new', kind: 'string', arg: 'TEXT', required: true, help: 'the replacement' },
      all: { key: 'all', kind: 'boolean', help: 'replace every occurrence' },
      ...writeFlags,
    },
  },
  append: {
    positionals: [{ key: 'path', label: 'path', required: true }],
    flags: {
      text: { key: 'text', kind: 'string', arg: 'TEXT', help: 'the text to append (default: read stdin)' },
      section: { key: 'section', kind: 'string', arg: '"A/B"', help: 'append at the end of this section' },
      ...writeFlags,
    },
    stdin: 'text',
  },
  fm: { positionals: [{ key: 'path', label: 'path', required: true }], flags: {} },
  mv: {
    positionals: [
      { key: 'from', label: 'from', required: true },
      { key: 'to', label: 'to', required: true },
    ],
    flags: {
      yes: { key: 'yes', kind: 'boolean', help: 'confirm a folder move of more than 20 files' },
      'dry-run': { key: 'dryRun', kind: 'boolean', help: 'compute and report, move nothing' },
    },
  },
  rm: {
    positionals: [{ key: 'path', label: 'path', required: true }],
    flags: {
      yes: { key: 'yes', kind: 'boolean', help: 'confirm a folder of more than 20 files' },
      'dry-run': { key: 'dryRun', kind: 'boolean', help: 'compute and report, trash nothing' },
    },
  },
  restore: {
    positionals: [{ key: 'path', label: 'path', required: true }],
    flags: {
      list: { key: 'list', kind: 'boolean', help: 'list available pre-images instead of restoring' },
      seq: { key: 'seq', kind: 'number', arg: 'N', help: 'restore this pre-image (default: the latest)' },
      'dry-run': { key: 'dryRun', kind: 'boolean', help: 'report which pre-image would be restored' },
    },
  },
}

/** Flags understood before the op name, on every op. */
export const GLOBAL_FLAGS: Record<string, FlagSpec & { multiple?: boolean }> = {
  vault: { key: 'vault', kind: 'string', arg: 'PATH', help: 'the vault root (else $OHHI_VAULT, else walk up from cwd)' },
  json: { key: 'json', kind: 'boolean', help: 'print the ohhi.<op>.v1 document and nothing else on stdout' },
  'data-dir': { key: 'dataDir', kind: 'string', arg: 'PATH', help: "the CLI's own data dir (journal); else $OHHI_DATA_DIR" },
  'app-store': { key: 'appStore', kind: 'string', arg: 'DIR', multiple: true, help: "a desktop app store dir, for restore's journal union (repeatable)" },
  help: { key: 'help', kind: 'boolean', help: 'print this usage' },
}

export interface Globals {
  vault?: string
  json: boolean
  dataDir?: string
  appStore: string[]
  help: boolean
}

export interface OpCommand {
  kind: 'op'
  op: OpName
  input: Record<string, unknown>
  globals: Globals
  /** True when the op wants text and neither `--text` nor a positional supplied it. */
  needsStdin: boolean
}

/** `ohhi` with no command, `ohhi help`, `ohhi --help`. */
export interface HelpCommand {
  kind: 'help'
  globals: Globals
}

/** `ohhi mcp` — the same vocabulary over stdio MCP, not a contract op. */
export interface McpCommand {
  kind: 'mcp'
  globals: Globals
}

export type Command = OpCommand | HelpCommand | McpCommand

const usageError = (message: string, details?: Record<string, unknown>): never => {
  throw new OpError('usage', message, details)
}

/** parseArgs options: the union of every op's flags plus the globals. */
function parseArgsOptions(): Record<string, { type: 'string' | 'boolean'; multiple?: boolean; short?: string }> {
  const opts: Record<string, { type: 'string' | 'boolean'; multiple?: boolean; short?: string }> = {}
  const add = (name: string, spec: FlagSpec & { multiple?: boolean }): void => {
    const type = spec.kind === 'boolean' || spec.kind === 'const' ? 'boolean' : 'string'
    const existing = opts[name]
    if (existing && existing.type !== type) {
      // A programming error in the table above, not a user error.
      throw new Error(`flag --${name} is declared with two types`)
    }
    // `multiple: undefined` is a TypeError in parseArgs — omit the key instead.
    opts[name] = spec.multiple === true ? { type, multiple: true } : { type }
  }
  for (const [name, spec] of Object.entries(GLOBAL_FLAGS)) add(name, spec)
  for (const grammar of Object.values(GRAMMAR)) for (const [name, spec] of Object.entries(grammar.flags)) add(name, spec)
  opts.help.short = 'h'
  return opts
}

const OPTIONS = parseArgsOptions()

function toNumber(flag: string, raw: string): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n)) usageError(`--${flag} expects an integer, got ${JSON.stringify(raw)}`)
  return n
}

function toRange(flag: string, raw: string): { from: number; to: number } {
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(raw.trim())
  if (!m) usageError(`--${flag} expects a range like 12-40, got ${JSON.stringify(raw)}`)
  return { from: Number(m![1]), to: Number(m![2]) }
}

/**
 * argv (without node/script) → an op, its input object and the globals.
 * Throws `OpError('usage')` — exit 2 — for anything malformed.
 */
export function parseCommand(argv: string[]): Command {
  let values: Record<string, unknown>
  let positionals: string[]
  try {
    const parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
    values = parsed.values as Record<string, unknown>
    positionals = parsed.positionals
  } catch (err) {
    return usageError(err instanceof Error ? err.message : String(err))
  }

  const globals: Globals = {
    vault: values.vault as string | undefined,
    json: values.json === true,
    dataDir: values['data-dir'] as string | undefined,
    appStore: (values['app-store'] as string[] | undefined) ?? [],
    help: values.help === true,
  }

  const [name, ...rest] = positionals
  if (globals.help || name === undefined || name === 'help') return { kind: 'help', globals }
  if (name === 'mcp') {
    if (rest.length > 0) usageError('`ohhi mcp` takes no positional arguments', { command: 'mcp', extra: rest })
    return { kind: 'mcp', globals }
  }

  if (!isOpName(name)) return usageError(`unknown command ${JSON.stringify(name)}`, { command: name })
  const op: OpName = name
  const grammar = GRAMMAR[op]

  // Only this op's flags (plus the globals) are legal after it.
  const allowed = new Set([...Object.keys(GLOBAL_FLAGS), ...Object.keys(grammar.flags)])
  for (const supplied of Object.keys(values)) {
    if (!allowed.has(supplied)) return usageError(`--${supplied} is not a flag of \`ohhi ${op}\``, { op, flag: supplied })
  }

  // Positionals.
  const input: Record<string, unknown> = {}
  grammar.positionals.forEach((p, i) => {
    const given = rest[i]
    if (given === undefined) {
      if (p.required) usageError(`\`ohhi ${op}\` needs a <${p.label}>`, { op, missing: p.label })
      return
    }
    input[p.key] = given
  })
  if (rest.length > grammar.positionals.length) {
    return usageError(
      `\`ohhi ${op}\` takes ${grammar.positionals.length} positional argument(s); got ${rest.length}. Quote arguments containing spaces.`,
      { op, extra: rest.slice(grammar.positionals.length) }
    )
  }

  // Flags.
  for (const [flag, spec] of Object.entries(grammar.flags)) {
    const raw = values[flag]
    if (raw === undefined || raw === false) continue
    switch (spec.kind) {
      case 'boolean':
        input[spec.key] = true
        break
      case 'const':
        input[spec.key] = spec.value
        break
      case 'number':
        input[spec.key] = toNumber(flag, raw as string)
        break
      case 'range':
        input[spec.key] = toRange(flag, raw as string)
        break
      default:
        input[spec.key] = raw as string
    }
  }

  for (const [flag, spec] of Object.entries(grammar.flags)) {
    if (spec.required === true && input[spec.key] === undefined) {
      usageError(`\`ohhi ${op}\` needs --${flag} ${spec.arg ?? ''}`.trim(), { op, missing: flag })
    }
  }

  const needsStdin = grammar.stdin !== undefined && input[grammar.stdin] === undefined
  return { kind: 'op', op, input, globals, needsStdin }
}

/** `ls [dir] [--depth N] …` — the one-line grammar shown in `ohhi help`. */
export function usageLine(op: OpName): string {
  const grammar = GRAMMAR[op]
  const parts: string[] = [op]
  for (const p of grammar.positionals) parts.push(p.required ? `<${p.label}>` : `[${p.label}]`)
  for (const [flag, spec] of Object.entries(grammar.flags)) {
    const body = spec.kind === 'boolean' || spec.kind === 'const' ? `--${flag}` : `--${flag} ${spec.arg ?? 'V'}`
    parts.push(spec.required === true ? body : `[${body}]`)
  }
  return parts.join(' ')
}

export { type FlagSpec }
