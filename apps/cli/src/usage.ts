/**
 * `ohhi help` — generated from the contract and the grammar table, so a new
 * op appears in the usage the moment it appears in `OP_SCHEMAS`. There is no
 * hand-maintained list of commands anywhere in this package.
 */
import { OP_NAMES, OP_SCHEMAS } from '@ohhi/agent'
import { ASK_USAGE, GLOBAL_FLAGS, usageLine } from './grammar.js'

const WRITE_MARK = '*'

export function usageText(): string {
  const lines: string[] = []
  lines.push('ohhi — an Editor vault on the command line (files-direct; the app need not be running).')
  lines.push('')
  lines.push('USAGE')
  lines.push('  ohhi [global flags] <command> [args] [flags]')
  lines.push('')
  lines.push('COMMANDS' + `  (${WRITE_MARK} = writes to disk: journaled, atomic, --dry-run available)`)
  const width = Math.max(...OP_NAMES.map((op) => op.length))
  for (const op of OP_NAMES) {
    const mark = OP_SCHEMAS[op].mutates ? WRITE_MARK : ' '
    lines.push(`  ${mark} ${op.padEnd(width)}  ${OP_SCHEMAS[op].description}`)
  }
  lines.push('')
  lines.push('GLOBAL FLAGS')
  for (const [flag, spec] of Object.entries(GLOBAL_FLAGS)) {
    const arg = spec.kind === 'boolean' ? '' : ` ${spec.arg ?? 'V'}`
    lines.push(`  --${(flag + arg).padEnd(18)}  ${spec.help}`)
  }
  lines.push('')
  lines.push('NAMING A VAULT (in order; an ambiguous walk-up is refused, never guessed)')
  lines.push('  1. --vault <path>')
  lines.push('  2. $OHHI_VAULT')
  lines.push('  3. walk up from the working directory for a folder holding .ohhi/ or .obsidian/')
  lines.push('')
  lines.push('OUTPUT')
  lines.push('  Text output is for humans and is NOT a parsing contract.')
  lines.push('  --json prints one ohhi.<command>.v1 document on stdout and nothing else;')
  lines.push('  counters, warnings and errors always go to stderr. Schemas live in spec/.')
  lines.push('')
  lines.push('EXIT CODES')
  lines.push('  0 success (including an empty result)   2 usage / vault selection')
  lines.push('  1 runtime, not found, refused           3 --expect-hash mismatch')
  lines.push('')
  lines.push('COMMAND GRAMMAR')
  for (const op of OP_NAMES) lines.push(`  ohhi ${usageLine(op)}`)
  lines.push('')
  lines.push('  ohhi mcp [--vault PATH]   serve the same commands as MCP tools over stdio')
  lines.push('    claude mcp add ohhi -- ohhi mcp --vault <path>')
  lines.push('')
  lines.push(`  ohhi ${ASK_USAGE}`)
  lines.push('    ask a model about the vault: it searches and reads (never writes) through the')
  lines.push('    commands above; the answer streams to stdout, each tool call to stderr.')
  lines.push('    Providers: $XDG_CONFIG_HOME/ohhi/providers.json (else ~/.config/ohhi/); $OHHI_API_KEY')
  lines.push("    overrides the chosen provider's key. --json prints one ohhi.ask.v1 document.")
  lines.push('')
  lines.push('EXAMPLES')
  lines.push('  ohhi search "connection pooling" --limit 5')
  lines.push('  ohhi read Areas/CS/Postgres.md --outline')
  lines.push('  ohhi read Areas/CS/Postgres.md --section "Pooling/Decisions"')
  lines.push('  ohhi patch Areas/CS/Postgres.md --old "pgbouncer" --new "PgBouncer" --expect-hash <hash>')
  lines.push('  ohhi changes --since j17 --json')
  lines.push('  ohhi ask "what did I decide about pooling?" --ref Areas/CS/Postgres.md#Decisions')
  return lines.join('\n') + '\n'
}

/** The one-line pointer printed under a usage error. */
export function usageHint(): string {
  return 'run `ohhi help` for the command list'
}

/** Detail lines a usage error adds under its message (candidate vaults, issue paths). */
export function usageDetails(details: Record<string, unknown> | undefined): string[] {
  if (!details) return []
  const out: string[] = []
  const candidates = details.candidates
  if (Array.isArray(candidates)) {
    out.push('candidate vaults (name one with --vault):')
    for (const c of candidates) out.push(`  ${String(c)}`)
  }
  return out
}
