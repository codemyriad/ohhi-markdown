/**
 * `ohhi mcp` — the same vocabulary over stdio MCP (shaping A7, fork 2-B).
 *
 * It is schema plumbing over `libs/agent`, not a second surface: the tool
 * list is `OP_NAMES`, each `inputSchema` is `z.toJSONSchema` of the op's zod
 * input, each description is the contract's, and each result is byte-for-byte
 * the `--json` document `ohhi <op> --json` prints. Nothing here decides
 * anything (R3).
 *
 *   claude mcp add ohhi -- ohhi mcp --vault <path>
 *
 * The vault is resolved ONCE at start-up (A3: a long-lived server keeps the
 * index warm rather than rebuilding per call) and never from tool arguments —
 * a tool call cannot redirect the server at another folder.
 *
 * stdout belongs to the protocol here; every log goes to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { OP_NAMES, OP_SCHEMAS, OpError, runOp, type OpName } from '@editor/agent'
import { openVault, type Backend } from './backend.js'
import type { Globals } from './grammar.js'
import type { Io } from './io.js'

/** `ohhi_search`, `ohhi_read`, … — one tool per contract op, no more. */
export const toolName = (op: OpName): string => `ohhi_${op}`

const OP_BY_TOOL = new Map<string, OpName>(OP_NAMES.map((op) => [toolName(op), op]))

export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** The tool list, generated — never hand-written (slice G4's demo condition). */
export function mcpTools(): McpTool[] {
  return OP_NAMES.map((op) => {
    const { $schema, ...inputSchema } = z.toJSONSchema(OP_SCHEMAS[op].input, {
      target: 'draft-2020-12',
      io: 'input',
    }) as Record<string, unknown>
    void $schema
    const writes = OP_SCHEMAS[op].mutates
      ? ' Writes to disk: the previous bytes are journaled first and the write is atomic; pass dryRun to preview.'
      : ''
    return { name: toolName(op), description: OP_SCHEMAS[op].description + writes, inputSchema }
  })
}

interface ToolResult {
  content: { type: 'text'; text: string }[]
  isError?: boolean
}

/** Runs one tool call against an open backend. Exported so tests need no transport. */
export async function callTool(backend: Backend, name: string, args: unknown): Promise<ToolResult> {
  const op = OP_BY_TOOL.get(name)
  if (!op) {
    return errorResult(new OpError('usage', `unknown tool ${JSON.stringify(name)}`, { tool: name }))
  }
  try {
    const output = await runOp(backend, op, args ?? {})
    return { content: [{ type: 'text', text: JSON.stringify(output) }] }
  } catch (err) {
    return errorResult(err)
  }
}

function errorResult(err: unknown): ToolResult {
  const opError = err instanceof OpError ? err : new OpError('runtime', err instanceof Error ? err.message : String(err))
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify(opError.toJSON()) }],
  }
}

/** Serves until stdin closes. Resolves when the transport does. */
export async function serveMcp(globals: Globals, io: Io): Promise<void> {
  const backend = await openVault(globals, io)
  const server = new Server({ name: 'ohhi', version: '0.1.0' }, { capabilities: { tools: {} } })

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpTools() }))
  server.setRequestHandler(
    CallToolRequestSchema,
    // The SDK's result union is wider than a tool result; ours is a subset of it.
    async (request) => (await callTool(backend, request.params.name, request.params.arguments)) as unknown as Record<string, unknown>
  )

  const transport = new StdioServerTransport()
  const closed = new Promise<void>((resolve) => {
    server.onclose = () => resolve()
  })
  await server.connect(transport)
  io.stderr(`ohhi mcp: serving ${OP_NAMES.length} tools over stdio for ${backend.root}\n`)
  await closed
}
