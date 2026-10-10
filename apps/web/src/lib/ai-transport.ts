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
  type ProposeEditInput,
  type ProviderConfig,
  type SkillMeta,
  type SkillSource,
  type SuggestionRecord,
  type UIMessageJson,
} from '@ohhi/harness'
import { emptySkillSource } from '@ohhi/harness/skills'
import type { Clock } from '@ohhi/vault'
import { withPresence } from './agent-presence.js'
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

/** What an agent edit lands on: the workspace facade's suggestions. */
export interface ProposalSink {
  /** Pin it as a pending suggestion the person reviews. */
  proposeEdit(input: ProposeEditInput): Promise<SuggestionRecord>
  /** Direct mode: propose and apply at once, through the agent's throttle. */
  applyAgentEdit(input: ProposeEditInput): Promise<SuggestionRecord>
}

/**
 * The host the agent runs over: the live workspace's backend, the shell's
 * clock, the network. With `proposals`, the agent's `write`/`patch`/`append`
 * land as suggestions in the note; `direct()` true (`aiConfig().directEdit`)
 * applies each one as it lands instead (`applyAgentEdit`: the same record,
 * accepted with the run's origin in one throttled slot), so *Undo agent
 * edit* still takes it back as a unit.
 */
export function appAgentHost(opts: {
  backend: VaultBackend
  clock: Clock
  skills?: SkillSource
  fetch?: typeof fetch
  proposals?: ProposalSink
  direct?: () => boolean
  presence?: AgentHost['presence'] // the agent as a peer in shared notes (B10, G)
}): AgentHost {
  const sink = opts.proposals
  return {
    backend: opts.backend,
    clock: opts.clock,
    fetch: opts.fetch ?? ((input, init) => globalThis.fetch(input, init)),
    skills: opts.skills ?? emptySkillSource,
    ...(opts.presence ? { presence: opts.presence } : {}),
    ...(sink
      ? {
          proposeEdit: (input: ProposeEditInput): Promise<SuggestionRecord> =>
            opts.direct?.() ? sink.applyAgentEdit(input) : sink.proposeEdit(input),
        }
      : {}),
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
        // Writes are proposals when the host can take them (B7); without a
        // `proposeEdit` the agent stays read-only.
        mutates: turn.host.proposeEdit !== undefined,
        origin: turn.origin,
        ...(turn.skill ? { skill: turn.skill } : {}),
      })
      turn.onAgent(agent)
      return withPresence(turn, await agent.stream(messages as unknown as UIMessageJson[], abortSignal ? { signal: abortSignal } : {}))
    },
    reconnectToStream: async () => null,
  }
}
