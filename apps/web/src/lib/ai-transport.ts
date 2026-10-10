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

/** No skills until builder C's source lands (`skills.svelte.ts`). */
export const NO_SKILLS: SkillSource = { list: async () => [], body: async () => null }

/** What a proposal lands on: the workspace's suggestions (D's facade). */
export interface ProposalSink {
  proposeEdit(input: ProposeEditInput): Promise<SuggestionRecord>
  acceptSuggestion(path: string, id: string): SuggestionRecord | null
}

/**
 * The host the agent runs over: the live workspace's backend, the shell's
 * clock, the network. With `proposals`, the agent's `write`/`patch`/`append`
 * land as suggestions in the note (B7, Fork 4-B); `direct()` true (Fork 4-A,
 * `aiConfig().directEdit`) accepts each one the moment it lands — the same
 * record, applied with the run's origin, so *Undo agent edit* still takes it
 * back as a unit.
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
    skills: opts.skills ?? NO_SKILLS,
    ...(opts.presence ? { presence: opts.presence } : {}),
    ...(sink
      ? {
          proposeEdit: async (input: ProposeEditInput): Promise<SuggestionRecord> => {
            const record = await sink.proposeEdit(input)
            if (!opts.direct?.()) return record
            return sink.acceptSuggestion(input.path, record.id) ?? record
          },
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
