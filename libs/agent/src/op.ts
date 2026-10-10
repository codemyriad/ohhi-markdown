/**
 * What an op IS: its schemas and description straight from the contract, plus
 * the one function that does the work. Nothing else — no flags, no rendering,
 * no transport. `apps/cli` and `ohhi mcp` are adapters over this shape.
 */
import type { OpInput, OpName, OpOutput, OP_SCHEMAS } from './contract.js'
import type { VaultBackend } from './read.js'

export type OpDef<N extends OpName> = (typeof OP_SCHEMAS)[N] & {
  run(backend: VaultBackend, input: OpInput<N>): Promise<OpOutput<N>>
}
