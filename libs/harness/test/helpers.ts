/**
 * Shared test plumbing: the fixture vault (libs/agent's — one vault for the
 * workspace), a provider per kind pointed at the mock, and a reader that
 * drains a UI message stream into what a test asserts on.
 */
import type { UIMessageChunk } from 'ai'
import type { AgentHost, AgentOrigin, ProviderConfig, ProviderKind } from '../src/index.js'
import { PROVIDER_KINDS } from '../src/config.js'
import { emptySkillSource } from '../src/skills/index.js'
import { harness, type Harness } from '../../agent/test/harness.js'

export { harness, type Harness }

export const KINDS: readonly ProviderKind[] = PROVIDER_KINDS

/** A provider of `kind` whose endpoint the mock answers (any host works: the mock routes by path). */
export function providerOf(kind: ProviderKind, extra: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: `p-${kind}`,
    name: `Mock ${kind}`,
    kind,
    baseUrl: kind === 'openai-compatible' ? 'http://localhost:11434/v1' : '',
    apiKey: 'sk-test',
    model: 'mock-model',
    ...extra,
  }
}

export const ORIGIN: AgentOrigin = { kind: 'agent', runId: 'run-1', sessionId: 'sess-1', name: 'Assistant' }

export function hostOf(h: Harness, fetchImpl: typeof fetch, extra: Partial<AgentHost> = {}): AgentHost {
  return { backend: h.backend, clock: h.clock, fetch: fetchImpl, skills: emptySkillSource, ...extra }
}

export interface Drained {
  chunks: UIMessageChunk[]
  text: string
  tools: Array<{ name: string; input: unknown; output?: unknown; error?: string }>
  errors: string[]
}

/** Read a UI message stream to the end. */
export async function drain(stream: ReadableStream<UIMessageChunk>): Promise<Drained> {
  const out: Drained = { chunks: [], text: '', tools: [], errors: [] }
  const byId = new Map<string, Drained['tools'][number]>()
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out.chunks.push(value)
    if (value.type === 'text-delta') out.text += value.delta
    if (value.type === 'tool-input-available') {
      const call = { name: value.toolName, input: value.input }
      byId.set(value.toolCallId, call)
      out.tools.push(call)
    }
    if (value.type === 'tool-output-available') {
      const call = byId.get(value.toolCallId)
      if (call) call.output = value.output
    }
    if (value.type === 'tool-output-error') {
      const call = byId.get(value.toolCallId)
      if (call) call.error = value.errorText
    }
    if (value.type === 'error') out.errors.push(value.errorText)
  }
  return out
}

/** A one-message conversation, as the session would hand it over. */
export const ask = (text: string) => [{ id: 'm1', role: 'user' as const, parts: [{ type: 'text', text }] }]
