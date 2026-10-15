/**
 * The vault's own contract as AI SDK tools (writing-harness-shaping B2,
 * golden rule 9): one `tool()` per `libs/agent` op, named `ohhi_<op>`, with
 * the contract's zod input schema and description — the same list `ohhi mcp`
 * serves, so the in-app agent and an external one speak one vocabulary.
 *
 * Three policies sit on top of the contract, and only here:
 *  - `mv`/`rm`/`restore` are never exposed to the in-app agent: moving,
 *    trashing and restoring are the person's gestures.
 *  - `skills`/`skill` are never exposed either: they list and read EVERY
 *    skill in the vault, trusted or not. The model gets one `ohhi_skill`
 *    tool instead, backed by the host's `SkillSource` — only the skills the
 *    host offers (in the app: trusted, enabled, unchanged since review).
 *  - With `proposeEdit`, `write`/`patch`/`append` never reach the backend's
 *    writer. The op runs for real (its validation, its uniqueness rule, its
 *    section placement) over a backend whose writer only CAPTURES the bytes;
 *    the changed span becomes one suggestion the person reviews (B7).
 */
import { tool, type ToolSet } from 'ai'
import { z, type ZodType } from 'zod'
import { OP_NAMES, OP_SCHEMAS, OpError, runOp, type OpName, type VaultBackend } from '@ohhi/agent/core'
import { decodeFile, type PreImageJournal, type VaultAdapter } from '@ohhi/vault'
import { editSpan } from './edit-span.js'
import type { AgentHost, AgentOrigin, SkillSource } from './types.js'

/** Tool name for an op: the prefix keeps them apart from any other tool set a host merges in. */
export const toolName = (op: string): string => `ohhi_${op}`

/** Never offered to the in-app agent, whatever `mutates` says. */
const PERSON_ONLY: ReadonlySet<string> = new Set(['mv', 'rm', 'restore'])
/** Ops that see every skill, trusted or not: replaced by the host-backed `ohhi_skill`. */
const SKILL_OPS: ReadonlySet<string> = new Set(['skills', 'skill'])
/** The writes a proposal can stand in for: each changes one note's text. */
const PROPOSABLE: ReadonlySet<string> = new Set(['write', 'patch', 'append', 'fm'])
/**
 * Mutating ops whose plain call is a read: `fm` reads a note's frontmatter
 * unless it is given `set`/`unset`/`rename` (collections DB fm writes). A
 * read-only run keeps the read and refuses the write.
 */
const READS_UNLESS: Readonly<Record<string, readonly string[]>> = { fm: ['set', 'unset', 'rename'] }

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

/** Is a tool's output a proposal (`ohhi.proposal.v1`)? The one parser every view uses. */
export function isProposalResult(output: unknown): output is ProposalResult {
  if (!output || typeof output !== 'object') return false
  const o = output as Partial<ProposalResult>
  return o.schema === 'ohhi.proposal.v1' && typeof o.path === 'string' && typeof o.proposed === 'boolean'
}

/** One AI SDK tool per `libs/agent` op, named `ohhi_<op>`; read ops only unless `mutates`. */
export function toolsFromContract(
  backend: VaultBackend,
  opts: { mutates: boolean; proposeEdit?: AgentHost['proposeEdit']; origin?: AgentOrigin; skills?: SkillSource },
): ToolSet {
  const tools: ToolSet = {}
  for (const op of OP_NAMES as readonly OpName[]) {
    const def: { input: ZodType; mutates: boolean; description: string } = OP_SCHEMAS[op]
    if (SKILL_OPS.has(op)) continue
    const readOnlyUse = def.mutates && !opts.mutates && op in READS_UNLESS
    if (def.mutates && !readOnlyUse && (!opts.mutates || PERSON_ONLY.has(op))) continue
    const proposing = opts.proposeEdit !== undefined && PROPOSABLE.has(op)
    tools[toolName(op)] = tool({
      description: proposing
        ? `${def.description} In this app the change is PROPOSED as a suggestion the person reviews; the note is unchanged until they accept it.`
        : def.description,
      inputSchema: def.input,
      execute: async (input: unknown) => {
        try {
          if (readOnlyUse && writesIn(op, input)) {
            throw new OpError('refused', `this run reads only; ${op} can read here but not change the note`)
          }
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
  if (opts.skills) tools[toolName('skill')] = skillTool(opts.skills)
  return tools
}

/** Does a call of a `READS_UNLESS` op carry any of its writing inputs? */
function writesIn(op: string, input: unknown): boolean {
  if (!input || typeof input !== 'object') return false
  return (READS_UNLESS[op] ?? []).some((key) => (input as Record<string, unknown>)[key] !== undefined)
}

/**
 * `ohhi_skill`: one skill's instructions, through the host's source — so a
 * skill the host does not offer (untrusted, disabled, changed since review,
 * invalid) cannot be loaded, whatever name the model asks for.
 */
function skillTool(skills: SkillSource) {
  return tool({
    description:
      'Load one skill’s instructions (its SKILL.md body) by name. Only the skills in the catalog of your instructions can be loaded; follow the body once loaded.',
    inputSchema: z.object({ name: z.string().min(1).describe('The skill’s name, as the catalog lists it') }),
    execute: async ({ name }: { name: string }) => {
      const body = await skills.body(name)
      if (body === null) throw new Error(`not_found: no skill ${JSON.stringify(name)} is offered here — load only a skill the catalog lists`)
      return { name, body }
    },
  })
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
  const captured: Captured = {}
  const output = (await runOp(capturing(backend, captured), op, input)) as { path: string; dryRun?: boolean }
  if (output.dryRun || !captured.bytes) return output
  // The span is computed against the bytes the op ITSELF read, never a second
  // read: text typed between the op's read and now must make the proposal a
  // conflict (its base no longer matches), never be folded into `baseText`
  // and so reverted when the person accepts.
  const before = captured.base ? decodeFile(captured.base).text : ''
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

/** What a capturing backend saw: the bytes the op wrote, and the bytes it read for that path. */
interface Captured {
  bytes?: Uint8Array
  /** The op's own last read of the written path before the write (null: no file there). */
  base?: Uint8Array | null
}

/**
 * The same backend, except that its writer captures the bytes instead of
 * writing them and its journal records nothing — so an op's whole write path
 * runs, and nothing reaches the note or the journal. Its reads are recorded
 * per path, so the proposal's base is exactly what the op edited.
 */
function capturing(backend: VaultBackend, captured: Captured): VaultBackend {
  const reads = new Map<string, Uint8Array | null>()
  const adapter = override<VaultAdapter>(backend.adapter, {
    read: async (path: string) => {
      const bytes = await backend.adapter.read(path)
      reads.set(path, bytes)
      return bytes
    },
    writeAtomic: async (path: string, bytes: Uint8Array) => {
      captured.bytes = bytes
      captured.base = reads.get(path) ?? null
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
