/**
 * The in-process `ChatTransport` (writing-harness-shaping B4, Fork 2): what
 * `@ai-sdk/svelte`'s `Chat` calls instead of an HTTP endpoint. There is no
 * server — `sendMessages` builds the harness agent over the app's own host
 * (`createAppBackend`, the shell's clock, `fetch`, the skills source) and
 * returns its UI-message stream straight to the `Chat`.
 *
 * The run registry (`ai-runs.svelte.ts`) owns what a turn IS — its
 * `RunRecord`, its provider, its references — and hands it over through
 * `prepare(chatId)`, which also records the run as `running`. This file only
 * turns a prepared turn into a stream. `reconnectToStream` is null: a run
 * lives in this process, and a reload re-runs from the session's leaf
 * (Fork 7-A).
 */
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import {
  createHarnessAgent,
  type AgentHost,
  type AgentOrigin,
  type HarnessAgent,
  type Mention,
  type ProviderConfig,
  type SkillMeta,
  type SkillSource,
  type UIMessageJson,
} from '@ohhi/harness'
import type { Clock } from '@ohhi/vault'
import type { VaultBackend } from './agent-backend.js'

/** One turn, as the registry prepared it. */
export interface PreparedTurn {
  provider: ProviderConfig
  refs: Mention[]
  skill?: { meta: SkillMeta; body: string }
  origin: AgentOrigin
  host: AgentHost
  /** Told the agent that runs this turn, so the registry can read its usage. */
  onAgent(agent: HarnessAgent): void
}

export type AgentFactory = typeof createHarnessAgent

/** No skills until builder C's source lands (`skills.svelte.ts`). */
export const NO_SKILLS: SkillSource = { list: async () => [], body: async () => null }

/** The host the agent runs over: the live workspace's backend, the shell's clock, the network. */
export function appAgentHost(opts: {
  backend: VaultBackend
  clock: Clock
  skills?: SkillSource
  fetch?: typeof fetch
}): AgentHost {
  return {
    backend: opts.backend,
    clock: opts.clock,
    fetch: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    skills: opts.skills ?? NO_SKILLS,
    // proposeEdit: F wires `workspace.proposeEdit` (H3). Absent → the agent is read-only.
  }
}

export function createHarnessTransport(opts: {
  /** The registry's pending turn for this chat (= session) id; throws when there is none. */
  prepare(chatId: string, messages: UIMessage[]): Promise<PreparedTurn>
  /** Injected for the tests; `createHarnessAgent` otherwise. */
  agentFactory?: AgentFactory
}): ChatTransport<UIMessage> {
  const factory = opts.agentFactory ?? createHarnessAgent
  return {
    async sendMessages({ chatId, messages, abortSignal }): Promise<ReadableStream<UIMessageChunk>> {
      const turn = await opts.prepare(chatId, messages)
      const agent = factory(turn.host, {
        provider: turn.provider,
        refs: turn.refs,
        mutates: false, // writes are proposals, and proposals are H3 (F)
        origin: turn.origin,
        ...(turn.skill ? { skill: turn.skill } : {}),
      })
      turn.onAgent(agent)
      return agent.stream(messages as unknown as UIMessageJson[], abortSignal ? { signal: abortSignal } : {})
    },
    reconnectToStream: async () => null,
  }
}
