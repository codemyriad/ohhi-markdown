/**
 * The vault's own contract as AI SDK tools (writing-harness-shaping B2,
 * golden rule 9): one `tool()` per `libs/agent` op, named `ohhi_<op>`, with
 * the contract's zod input schema and description — the same list `ohhi mcp`
 * serves, so the in-app agent and an external one speak one vocabulary.
 *
 * Two policies sit on top of the contract, and only here:
 *  - `mv`/`rm`/`restore` are never exposed to the in-app agent: moving,
 *    trashing and restoring are the person's gestures.
 *  - With `proposeEdit`, `write`/`patch`/`append` never reach the backend's
 *    writer. The op runs for real (its validation, its uniqueness rule, its
 *    section placement) over a backend whose writer only CAPTURES the bytes;
 *    the changed span becomes one suggestion the person reviews (B7).
 */
import { tool, type ToolSet } from 'ai'
import type { ZodType } from 'zod'
import { OP_NAMES, OP_SCHEMAS, OpError, runOp, type OpName, type VaultBackend } from '@ohhi/agent/core'
import { decodeFile, type PreImageJournal, type VaultAdapter } from '@ohhi/vault'
import { editSpan } from './edit-span.js'
import type { AgentHost, AgentOrigin } from './types.js'

/** Tool name for an op: the prefix keeps them apart from any other tool set a host merges in. */
export const toolName = (op: string): string => `ohhi_${op}`

/** Never offered to the in-app agent, whatever `mutates` says. */
const PERSON_ONLY: ReadonlySet<string> = new Set(['mv', 'rm', 'restore'])
/** The writes a proposal can stand in for: each changes one note's text. */
const PROPOSABLE: ReadonlySet<string> = new Set(['write', 'patch', 'append'])

/** What a proposing tool returns to the model instead of the op's own output. */
export interface ProposalResult {
  schema: 'ohhi.proposal.v1'
  path: string
  /** False when the edit would change nothing. */
  proposed: boolean
  suggestionId?: string
  /** True when the host applied it as it landed (direct mode, Fork 4-A). */
  applied?: boolean
  from?: number
  to?: number
  message: string
}

/** One AI SDK tool per `libs/agent` op, named `ohhi_<op>`; read ops only unless `mutates`. */
export function toolsFromContract(
  backend: VaultBackend,
  opts: { mutates: boolean; proposeEdit?: AgentHost['proposeEdit']; origin?: AgentOrigin },
): ToolSet {
  const tools: ToolSet = {}
  for (const op of OP_NAMES as readonly OpName[]) {
    const def: { input: ZodType; mutates: boolean; description: string } = OP_SCHEMAS[op]
    if (def.mutates && (!opts.mutates || PERSON_ONLY.has(op))) continue
    const proposing = opts.proposeEdit !== undefined && PROPOSABLE.has(op)
    tools[toolName(op)] = tool({
      description: proposing
        ? `${def.description} In this app the change is PROPOSED as a suggestion the person reviews; the note is unchanged until they accept it.`
        : def.description,
      inputSchema: def.input,
      execute: async (input: unknown) => {
        try {
          if (proposing) return await propose(backend, op, input, opts.proposeEdit!, opts.origin)
          return await runOp(backend, op, input)
        } catch (err) {
          // The model sees the contract's code with the message — `conflict`
          // means re-read, `refused` means change approach.
          if (err instanceof OpError) throw new Error(`${err.code}: ${err.message}`)
          throw err
        }
      },
    })
  }
  return tools
}

/**
 * Run a write op over a capturing backend, then propose the changed span.
 * `dryRun` answers as the op would, proposing nothing.
 */
async function propose(
  backend: VaultBackend,
  op: OpName,
  input: unknown,
  proposeEdit: NonNullable<AgentHost['proposeEdit']>,
  origin: AgentOrigin | undefined,
): Promise<ProposalResult | unknown> {
  if (!origin) throw new Error('a proposing tool needs the run’s AgentOrigin')
  const captured: { bytes?: Uint8Array } = {}
  const output = (await runOp(capturing(backend, captured), op, input)) as { path: string; dryRun?: boolean }
  if (output.dryRun || !captured.bytes) return output
  const current = await backend.adapter.read(output.path)
  const before = current ? decodeFile(current).text : ''
  const span = editSpan(before, decodeFile(captured.bytes).text)
  if (!span) return { schema: 'ohhi.proposal.v1', path: output.path, proposed: false, message: 'The note already says that; nothing to propose.' }
  const record = await proposeEdit({ path: output.path, ...span, origin })
  return {
    schema: 'ohhi.proposal.v1',
    path: output.path,
    proposed: true,
    suggestionId: record.id,
    ...(record.status === 'accepted' ? { applied: true } : {}),
    from: span.from,
    to: span.to,
    // Direct mode (Fork 4-A): the host accepted it as it landed.
    message:
      record.status === 'accepted'
        ? 'Applied directly (the person allows direct edits); they can undo it as one step.'
        : 'Proposed as a suggestion. It awaits the person’s review; the note is unchanged until they accept it.',
  } satisfies ProposalResult
}

/**
 * The same backend, except that its writer captures the bytes instead of
 * writing them and its journal records nothing — so an op's whole write path
 * runs, and nothing reaches the note or the journal.
 */
function capturing(backend: VaultBackend, captured: { bytes?: Uint8Array }): VaultBackend {
  const adapter = override<VaultAdapter>(backend.adapter, {
    writeAtomic: async (_path: string, bytes: Uint8Array) => {
      captured.bytes = bytes
    },
  })
  const journal = override<PreImageJournal>(backend.journal, {
    record: async () => {},
    list: async () => [],
  })
  return override<VaultBackend>(backend, { adapter, journal })
}

/** A view of `target` with some members replaced; everything else bound to the original. */
function override<T extends object>(target: T, members: Partial<Record<keyof T, unknown>>): T {
  return new Proxy(target, {
    get(t, key) {
      if (Object.prototype.hasOwnProperty.call(members, key)) return members[key as keyof T]
      const value = Reflect.get(t, key, t)
      return typeof value === 'function' ? value.bind(t) : value
    },
  })
}
