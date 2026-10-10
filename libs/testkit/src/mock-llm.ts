/**
 * A scripted LLM at the fetch level (writing-harness-shaping B1, D7's rule:
 * CI never calls a real model). `mockLlmFetch(script)` returns a `fetch`
 * that answers the wire shapes the harness's providers speak:
 *
 *  - Anthropic Messages (`POST …/messages`): SSE `message_start` →
 *    `content_block_*` → `message_delta` → `message_stop`, or one JSON
 *    message when `stream` is false (*Test connection*'s one-token call);
 *  - OpenAI Chat Completions (`POST …/chat/completions`) — OpenAI,
 *    OpenRouter and every OpenAI-compatible server: SSE
 *    `data: {choices:[{delta}]}` … `data: [DONE]`, or one JSON completion;
 *  - `GET …/models`: `{ data: [{ id }] }`, consuming no turn.
 *
 * Each model request consumes ONE turn of the script, in order. Every
 * request is recorded, normalized across wire shapes, in `.requests` — the
 * system prompt, the tools offered, the tool results sent back — so a test
 * can assert what the model was shown. Browser-safe (fetch, streams, no
 * Node); the same handler behind `node:http` is `mock-llm-server.ts`.
 */

/** One model turn. `text` and `toolCall` may both be set (text first). */
export interface MockTurn {
  text?: string
  toolCall?: { name: string; args: unknown }
  /** Answer with this HTTP error instead (the turn is still consumed). */
  error?: { status: number; message: string }
  usage?: { input: number; output: number }
}

export type MockWire = 'anthropic' | 'openai'

/** One request the mock saw, normalized across wire shapes. */
export interface MockRequest {
  wire: MockWire | 'models'
  url: string
  method: string
  headers: Record<string, string>
  model?: string
  stream: boolean
  /** The system prompt as one string ('' when none was sent). */
  system: string
  /** Names of the tools offered. */
  tools: string[]
  /** Tool results carried by this request, in order. */
  toolResults: Array<{ id: string; name?: string; output: string }>
  /** The text of the last user message that is not a tool result. */
  lastUser: string
  body: unknown
}

export type MockLlmFetch = typeof fetch & {
  readonly requests: MockRequest[]
  /** Turns not yet consumed. */
  remaining(): number
}

export interface MockLlmOptions {
  /** What `GET /models` lists (default `['mock-model']`). */
  models?: string[]
}

/** A `fetch` answering from `script`, one turn per model request. */
export function mockLlmFetch(script: MockTurn[], opts: MockLlmOptions = {}): MockLlmFetch {
  const turns = [...script]
  const requests: MockRequest[] = []
  let calls = 0

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const headers = Object.fromEntries(req.headers.entries())
    if (req.method === 'GET' && /\/models\/?$/.test(url.pathname)) {
      requests.push({ wire: 'models', url: req.url, method: 'GET', headers, stream: false, system: '', tools: [], toolResults: [], lastUser: '', body: null })
      return json(200, { object: 'list', data: (opts.models ?? ['mock-model']).map((id) => ({ id, object: 'model', owned_by: 'mock' })) })
    }
    const wire: MockWire | null = /\/messages\/?$/.test(url.pathname)
      ? 'anthropic'
      : /\/chat\/completions\/?$/.test(url.pathname)
        ? 'openai'
        : null
    if (!wire) return json(404, { error: { message: `mock-llm: no route for ${req.method} ${url.pathname}` } })
    const body = (await req.json()) as Record<string, unknown>
    requests.push({ wire, url: req.url, method: req.method, headers, body, ...(wire === 'anthropic' ? readAnthropic(body) : readOpenAi(body)) })
    const turn = turns.shift()
    const n = ++calls
    if (!turn) return json(500, { error: { type: 'mock_exhausted', message: 'mock-llm: the script has no turn left' } })
    if (turn.error) return json(turn.error.status, { type: 'error', error: { type: 'mock_error', message: turn.error.message } })
    const model = typeof body.model === 'string' ? body.model : 'mock-model'
    const stream = body.stream === true
    if (wire === 'anthropic') return stream ? sse(anthropicEvents(turn, model, n)) : json(200, anthropicMessage(turn, model, n))
    return stream ? sse(openAiEvents(turn, model, n)) : json(200, openAiCompletion(turn, model, n))
  }

  return Object.assign(impl, { requests, remaining: () => turns.length }) as MockLlmFetch
}

// ---- reading what the model was sent ----

type Json = Record<string, unknown>

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (part && typeof part === 'object' && typeof (part as Json).text === 'string' ? ((part as Json).text as string) : ''))
    .join('')
}

function readAnthropic(body: Json): Pick<MockRequest, 'model' | 'stream' | 'system' | 'tools' | 'toolResults' | 'lastUser'> {
  const messages = (Array.isArray(body.messages) ? body.messages : []) as Json[]
  const names = new Map<string, string>()
  const toolResults: MockRequest['toolResults'] = []
  let lastUser = ''
  for (const m of messages) {
    const blocks = Array.isArray(m.content) ? (m.content as Json[]) : [{ type: 'text', text: m.content }]
    for (const b of blocks) {
      if (b.type === 'tool_use') names.set(String(b.id), String(b.name))
      if (b.type === 'tool_result') {
        const id = String(b.tool_use_id)
        toolResults.push({ id, name: names.get(id), output: textOf(b.content) })
      }
    }
    if (m.role === 'user') {
      const text = blocks.filter((b) => b.type === 'text').map((b) => String(b.text ?? '')).join('')
      if (text) lastUser = text
    }
  }
  return {
    model: typeof body.model === 'string' ? body.model : undefined,
    stream: body.stream === true,
    system: textOf(body.system),
    tools: (Array.isArray(body.tools) ? (body.tools as Json[]) : []).map((t) => String(t.name)),
    toolResults: toolResults.slice(lastAssistantResultsFrom(messages, 'anthropic', toolResults.length)),
    lastUser,
  }
}

function readOpenAi(body: Json): Pick<MockRequest, 'model' | 'stream' | 'system' | 'tools' | 'toolResults' | 'lastUser'> {
  const messages = (Array.isArray(body.messages) ? body.messages : []) as Json[]
  const names = new Map<string, string>()
  const toolResults: MockRequest['toolResults'] = []
  const system: string[] = []
  let lastUser = ''
  for (const m of messages) {
    if (m.role === 'system' || m.role === 'developer') system.push(textOf(m.content))
    if (m.role === 'user') lastUser = textOf(m.content) || lastUser
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const c of m.tool_calls as Json[]) names.set(String(c.id), String((c.function as Json)?.name))
    }
    if (m.role === 'tool') {
      const id = String(m.tool_call_id)
      toolResults.push({ id, name: names.get(id), output: textOf(m.content) })
    }
  }
  return {
    model: typeof body.model === 'string' ? body.model : undefined,
    stream: body.stream === true,
    system: system.join('\n'),
    tools: (Array.isArray(body.tools) ? (body.tools as Json[]) : []).map((t) => String((t.function as Json)?.name ?? t.name)),
    toolResults: toolResults.slice(lastAssistantResultsFrom(messages, 'openai', toolResults.length)),
    lastUser,
  }
}

/**
 * Index into `toolResults` where the results answering the LAST assistant
 * turn begin — "what this request is sending back", not the whole history.
 */
function lastAssistantResultsFrom(messages: Json[], wire: MockWire, total: number): number {
  let after = 0
  for (const m of messages) {
    if (m.role === 'assistant') after = 0
    else if (wire === 'openai' && m.role === 'tool') after++
    else if (wire === 'anthropic' && m.role === 'user' && Array.isArray(m.content)) {
      after += (m.content as Json[]).filter((b) => b.type === 'tool_result').length
    }
  }
  return total - after
}

// ---- answering ----

const words = (text: string): string[] => text.match(/\S+\s*|\s+/g) ?? []

const usageOf = (turn: MockTurn): { input: number; output: number } =>
  turn.usage ?? { input: 10, output: Math.max(1, words(turn.text ?? '').length + (turn.toolCall ? 5 : 0)) }

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function sse(events: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(e))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

const anthropicEvent = (type: string, data: Json): string => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`

function anthropicEvents(turn: MockTurn, model: string, n: number): string[] {
  const usage = usageOf(turn)
  const out = [
    anthropicEvent('message_start', {
      message: {
        id: `msg_mock_${n}`, type: 'message', role: 'assistant', model, content: [],
        stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input, output_tokens: 1 },
      },
    }),
  ]
  let index = 0
  if (turn.text) {
    out.push(anthropicEvent('content_block_start', { index, content_block: { type: 'text', text: '' } }))
    for (const w of words(turn.text)) out.push(anthropicEvent('content_block_delta', { index, delta: { type: 'text_delta', text: w } }))
    out.push(anthropicEvent('content_block_stop', { index }))
    index++
  }
  if (turn.toolCall) {
    out.push(anthropicEvent('content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_mock_${n}`, name: turn.toolCall.name, input: {} } }))
    out.push(anthropicEvent('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.toolCall.args ?? {}) } }))
    out.push(anthropicEvent('content_block_stop', { index }))
  }
  out.push(
    anthropicEvent('message_delta', {
      delta: { stop_reason: turn.toolCall ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.output },
    }),
    anthropicEvent('message_stop', {}),
  )
  return out
}

function anthropicMessage(turn: MockTurn, model: string, n: number): Json {
  const usage = usageOf(turn)
  const content: Json[] = []
  if (turn.text) content.push({ type: 'text', text: turn.text })
  if (turn.toolCall) content.push({ type: 'tool_use', id: `toolu_mock_${n}`, name: turn.toolCall.name, input: turn.toolCall.args ?? {} })
  return {
    id: `msg_mock_${n}`, type: 'message', role: 'assistant', model, content,
    stop_reason: turn.toolCall ? 'tool_use' : 'end_turn', stop_sequence: null,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
  }
}

function openAiEvents(turn: MockTurn, model: string, n: number): string[] {
  const usage = usageOf(turn)
  const chunk = (choices: Json[], extra: Json = {}): string =>
    `data: ${JSON.stringify({ id: `chatcmpl-mock-${n}`, object: 'chat.completion.chunk', created: 0, model, choices, ...extra })}\n\n`
  const out = [chunk([{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }])]
  for (const w of words(turn.text ?? '')) out.push(chunk([{ index: 0, delta: { content: w }, finish_reason: null }]))
  if (turn.toolCall) {
    out.push(
      chunk([{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: `call_mock_${n}`, type: 'function', function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.args ?? {}) } }] },
        finish_reason: null,
      }]),
    )
  }
  out.push(chunk([{ index: 0, delta: {}, finish_reason: turn.toolCall ? 'tool_calls' : 'stop' }]))
  out.push(chunk([], { usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output } }))
  out.push('data: [DONE]\n\n')
  return out
}

function openAiCompletion(turn: MockTurn, model: string, n: number): Json {
  const usage = usageOf(turn)
  const message: Json = { role: 'assistant', content: turn.text ?? null }
  if (turn.toolCall) {
    message.tool_calls = [{ id: `call_mock_${n}`, type: 'function', function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.args ?? {}) } }]
  }
  return {
    id: `chatcmpl-mock-${n}`, object: 'chat.completion', created: 0, model,
    choices: [{ index: 0, message, finish_reason: turn.toolCall ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: usage.input, completion_tokens: usage.output, total_tokens: usage.input + usage.output },
  }
}
