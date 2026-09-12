/**
 * `run(argv, io) => exit code` — the whole CLI, with the process held at
 * arm's length (shaping A2). Every test in this package calls this function;
 * `main.ts` is the only file that knows `process` exists.
 *
 * Contract (shaping A9, build brief A2.1):
 *   stdout  the answer — a rendered view, or with `--json` exactly one
 *           `ohhi.<op>.v1` document and nothing else
 *   stderr  provenance: counters, coverage, truncation, hints, errors
 *   exit    0 success (empty results included) · 1 runtime/not_found/refused
 *           · 2 usage and vault selection · 3 `--expect-hash` mismatch
 */
import { ErrorOut, OpError, exitCodeFor, runOp, type OpName } from '@editor/agent'
import { openVault } from './backend.js'
import { parseCommand } from './grammar.js'
import { Sink, type Io } from './io.js'
import { jsonModeNotes, renderText } from './render/index.js'
import { usageDetails, usageHint, usageText } from './usage.js'

export async function run(argv: string[], io: Io): Promise<number> {
  const sink = new Sink(io)
  let json = false
  let vaultRoot: string | undefined
  try {
    const command = parseCommand(argv)
    json = command.globals.json

    if (command.kind === 'help') {
      sink.raw(usageText())
      return 0
    }
    if (command.kind === 'mcp') {
      // Imported lazily: the MCP SDK is ~200 KB of transport the read path
      // must not pay for on a cold `ohhi search` (R6).
      const { serveMcp } = await import('./mcp.js')
      await serveMcp(command.globals, io)
      return 0
    }

    const { op, input, globals, needsStdin } = command
    if (needsStdin) input.text = await readStdin(op, io)

    const backend = await openVault(globals, io, (selection) => {
      // Honesty about a vault nobody named explicitly (R8).
      if (selection.source === 'marker') sink.err(`vault=${selection.root} (found by ${selection.marker ?? 'marker'} above the working directory)`)
    })
    vaultRoot = backend.root
    // `runOp` validates the input through the op's own zod schema and runs it:
    // one validator for the CLI, `ohhi mcp` and the core's own tests (R3).
    const output = await runOp(backend, op, input)

    if (json) {
      sink.raw(JSON.stringify(output) + '\n')
      jsonModeNotes(output, sink)
    } else {
      renderText(op, output, sink)
    }
    return 0
  } catch (err) {
    return fail(err, { sink, json, vaultRoot })
  }
}

async function readStdin(op: OpName, io: Io): Promise<string> {
  if (!io.stdin) {
    throw new OpError('usage', `\`ohhi ${op}\` needs --text, or the text piped on stdin`, { op })
  }
  return io.stdin()
}

function fail(err: unknown, ctx: { sink: Sink; json: boolean; vaultRoot: string | undefined }): number {
  const opError =
    err instanceof OpError
      ? err
      : new OpError('runtime', redact(err instanceof Error ? err.message : String(err), ctx.vaultRoot))

  if (ctx.json) {
    // The error document is the answer in --json mode: a harness parses one
    // shape whether the call worked or not.
    ctx.sink.raw(JSON.stringify(ErrorOut.parse(opError.toJSON())) + '\n')
  }
  ctx.sink.err(`ohhi: ${opError.code}: ${opError.message}`)
  for (const line of usageDetails(opError.details)) ctx.sink.err(line)

  if (opError.code === 'usage') {
    const d = opError.details ?? {}
    // An unknown command or an unknown flag gets the whole usage; a bad value
    // for a known flag gets the one-line pointer.
    if ('command' in d || 'flag' in d || looksLikeParseError(opError.message)) ctx.sink.err(usageText())
    else ctx.sink.err(usageHint())
  }
  if (opError.code === 'conflict') {
    ctx.sink.err('the note changed since you read it — re-read it and pass the new --expect-hash')
  }
  return exitCodeFor(opError.code)
}

/** parseArgs' own messages ("Unknown option '--nope'", "Option '--x' argument missing"). */
function looksLikeParseError(message: string): boolean {
  return /^(Unknown option|Option '|Unexpected argument)/.test(message)
}

/**
 * Build brief A2.7: never print a path outside the vault. Absolute paths in
 * an unexpected error (an fs errno, say) are replaced unless they are inside
 * the vault the user named.
 */
export function redact(message: string, vaultRoot: string | undefined): string {
  return message.replace(/\/(?:[^\s'"`:,)]+\/?)+/g, (match) => {
    if (vaultRoot && (match === vaultRoot || match.startsWith(vaultRoot + '/'))) return match
    return '<path>'
  })
}
