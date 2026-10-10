/**
 * The run registry (writing-harness-shaping B4 *Run status*, Fork 7-A): the
 * shell's — not a view's — record of every turn in flight, so closing the
 * Session tab does not stop a run, and `ai.stop-run` can stop one from
 * anywhere.
 *
 * Per session it holds the `@ai-sdk/svelte` `Chat` (whose messages ARE the
 * transcript the view renders) and the session's current `RunRecord`, both
 * reactive. A turn walks the TaskProcessing vocabulary on the injected clock
 * (golden rule 5): `scheduled` when asked → `running` when the transport
 * takes it → `successful` | `failed` | `cancelled` when the stream ends.
 * Every step is APPENDED to the session file as a `run` entry (the file is
 * the record; this map is the live view of it), and the turn's two messages
 * — the person's when it starts, the agent's when it ends — as `message`
 * entries, so a reload resumes from the leaf.
 */
import { Chat } from '@ai-sdk/svelte'
import type { UIMessage } from 'ai'
import type { AgentHost, AgentOrigin, HarnessAgent, Mention, ProviderConfig, RunRecord, SkillMeta, UIMessageJson } from '@ohhi/harness'
import type { Clock } from '@ohhi/vault'
import { createHarnessTransport, type AgentFactory } from './ai-transport.js'
import { mintId, type SessionStore } from './session-store.js'

/** What a caller asks for: one turn in a session (C's `ai.run-skill`, F's send-to-agent, the composer). */
export interface RunInput {
  instruction: string
  refs?: Mention[]
  skill?: { meta: SkillMeta; body: string }
  /** The provider to run on; absent → the default (re-resolved from settings at run time). */
  providerId?: string
  /** When a comment thread asked (F). */
  threadId?: string
}

/** A started turn: where it runs, and a promise of how it ended. */
export interface RunHandle {
  sessionId: string
  runId: string
  /** Settles with the final record (`successful` | `failed` | `cancelled`); never rejects. */
  done: Promise<RunRecord>
}

/** Message metadata the composer's turn carries: the references it sent. */
export interface TurnMetadata {
  refs?: Mention[]
  runId?: string
}

export interface RunRegistryDeps {
  store: SessionStore
  clock: Clock
  /** The provider to run on (with its key), re-read from settings for every run. Null → none configured. */
  provider(id?: string): ProviderConfig | null
  /** The host a run's agent works over (the live workspace backend, the skills source). */
  host(origin: AgentOrigin): AgentHost
  /** Injected for the tests; `createHarnessAgent` otherwise. */
  agentFactory?: AgentFactory
  /** The agent's name in the event log and on its origin; the skill's when there is one. */
  agentName?: string
}

export interface RunRegistry {
  /** The session's chat, its history loaded from the file once. */
  chat(sessionId: string): Promise<Chat<UIMessage>>
  /** The chat if it is already loaded — for a view that must not await. */
  loaded(sessionId: string): Chat<UIMessage> | undefined
  /** Start a turn; null when the session already has one in flight or no provider exists. */
  start(sessionId: string, input: RunInput): Promise<RunHandle | null>
  /** Cancel the session's run; false when nothing was running. */
  stop(sessionId: string): boolean
  /** The session's latest run, live. */
  current(sessionId: string): RunRecord | null
  /** Sessions with a run scheduled or running. */
  active(): string[]
  /** Cancel everything (the vault closed). */
  stopAll(): void
}

const LIVE: ReadonlySet<RunRecord['status']> = new Set(['scheduled', 'running'])

export function isLive(run: RunRecord | null | undefined): boolean {
  return !!run && LIVE.has(run.status)
}

interface Pending {
  run: RunRecord
  input: RunInput
  provider: ProviderConfig
  origin: AgentOrigin
  agent?: HarnessAgent
  error?: string
  settled: boolean
  resolve(run: RunRecord): void
}

export function createRunRegistry(deps: RunRegistryDeps): RunRegistry {
  const chats = new Map<string, Chat<UIMessage>>()
  const loading = new Map<string, Promise<Chat<UIMessage>>>()
  /** The turn each session is on, keyed by session id (= the chat id). */
  const pending = new Map<string, Pending>()
  const runs = $state<Record<string, RunRecord>>({})

  const record = async (sessionId: string, run: RunRecord): Promise<void> => {
    runs[sessionId] = run
    await deps.store.append(sessionId, [{ type: 'run', run }])
  }

  /** Close a turn exactly once, however it ended. */
  const settle = async (sessionId: string, p: Pending, outcome: 'successful' | 'failed' | 'cancelled', message?: UIMessage): Promise<void> => {
    if (p.settled) return
    p.settled = true
    pending.delete(sessionId)
    const usage = outcome === 'successful' ? p.agent?.lastUsage() : undefined
    const run: RunRecord = {
      ...p.run,
      status: outcome,
      endedAt: deps.clock.now(),
      ...(usage ? { usage } : {}),
      ...(outcome === 'failed' && p.error ? { error: p.error } : {}),
    }
    // The agent's reply, as far as it got (a cancelled turn keeps its partial text).
    const reply = message && message.role === 'assistant' && message.parts.length > 0 ? message : null
    runs[sessionId] = run
    await deps.store.append(sessionId, [
      ...(reply ? [{ type: 'message' as const, message: { ...(reply as unknown as UIMessageJson), metadata: { runId: run.runId } } }] : []),
      { type: 'run', run },
    ])
    p.resolve(run)
  }

  const transport = createHarnessTransport({
    agentFactory: deps.agentFactory,
    async prepare(sessionId, messages) {
      const p = pending.get(sessionId)
      if (!p) {
        // Stopped while still scheduled: the Chat reads an AbortError as a cancel, not a failure.
        const cancelled = new Error(`run cancelled before it started (${sessionId})`)
        cancelled.name = 'AbortError'
        throw cancelled
      }
      p.run = { ...p.run, status: 'running', startedAt: deps.clock.now() }
      const asked = messages.at(-1)
      await deps.store.append(sessionId, [
        ...(asked && asked.role === 'user' ? [{ type: 'message' as const, message: asked as unknown as UIMessageJson }] : []),
        { type: 'run', run: p.run },
      ])
      runs[sessionId] = p.run
      return {
        provider: p.provider,
        refs: p.input.refs ?? [],
        ...(p.input.skill ? { skill: p.input.skill } : {}),
        origin: p.origin,
        host: deps.host(p.origin),
        onAgent: (agent) => (p.agent = agent),
      }
    },
  })

  const chatOf = (sessionId: string, messages: UIMessage[]): Chat<UIMessage> => {
    const chat: Chat<UIMessage> = new Chat<UIMessage>({
      id: sessionId,
      messages,
      transport,
      onError: (err) => {
        const p = pending.get(sessionId)
        if (p) p.error = err.message
      },
      onFinish: ({ message, isAbort, isError }) => {
        const p = pending.get(sessionId)
        if (!p) return
        void settle(sessionId, p, isAbort ? 'cancelled' : isError ? 'failed' : 'successful', message)
      },
    })
    chats.set(sessionId, chat)
    return chat
  }

  const chat = (sessionId: string): Promise<Chat<UIMessage>> => {
    const hit = chats.get(sessionId)
    if (hit) return Promise.resolve(hit)
    let wait = loading.get(sessionId)
    if (!wait) {
      wait = (async () => {
        const loaded = await deps.store.load(sessionId)
        const messages = (loaded?.entries ?? []).flatMap((e) => (e.type === 'message' ? [e.message as unknown as UIMessage] : []))
        const last = loaded ? [...loaded.entries].reverse().find((e) => e.type === 'run') : undefined
        if (last?.type === 'run' && !runs[sessionId]) {
          // A run the file says was in flight when the app went away did not finish.
          runs[sessionId] = isLive(last.run) ? { ...last.run, status: 'cancelled' } : last.run
        }
        return chats.get(sessionId) ?? chatOf(sessionId, messages)
      })()
      loading.set(sessionId, wait)
      const clear = (): void => void loading.delete(sessionId)
      wait.then(clear, clear)
    }
    return wait
  }

  return {
    chat,
    loaded: (sessionId) => chats.get(sessionId),
    async start(sessionId, input) {
      if (pending.has(sessionId)) return null
      const provider = deps.provider(input.providerId)
      if (!provider) return null
      const c = await chat(sessionId)
      if (pending.has(sessionId)) return null
      const runId = mintId(deps.clock.now())
      const run: RunRecord = {
        runId,
        status: 'scheduled',
        input: {
          refs: input.refs ?? [],
          instruction: input.instruction,
          ...(input.skill ? { skill: input.skill.meta.name } : {}),
        },
        provider: provider.id,
        model: provider.model,
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }
      const origin: AgentOrigin = {
        kind: 'agent',
        runId,
        sessionId,
        name: input.skill?.meta.name ?? deps.agentName ?? 'Agent',
        ...(input.threadId ? { threadId: input.threadId } : {}),
      }
      let resolve!: (run: RunRecord) => void
      const done = new Promise<RunRecord>((r) => (resolve = r))
      const p: Pending = { run, input, provider, origin, settled: false, resolve }
      pending.set(sessionId, p)
      await record(sessionId, run)
      const metadata: TurnMetadata = { runId, ...(input.refs?.length ? { refs: input.refs } : {}) }
      // `sendMessage` resolves when the turn is over; `onFinish` has settled it
      // by then — unless the transport threw before a response existed.
      void c
        .sendMessage({ text: input.instruction, metadata })
        .catch((err: unknown) => {
          p.error ??= err instanceof Error ? err.message : String(err)
        })
        .finally(() => void settle(sessionId, p, p.error ? 'failed' : 'cancelled'))
      return { sessionId, runId, done }
    },
    stop(sessionId) {
      const p = pending.get(sessionId)
      if (!p) return false
      const c = chats.get(sessionId)
      if (p.run.status === 'scheduled' || !c) {
        void settle(sessionId, p, 'cancelled')
      } else {
        void c.stop()
      }
      return true
    },
    current: (sessionId) => runs[sessionId] ?? null,
    active: () => [...pending.keys()],
    stopAll() {
      for (const id of [...pending.keys()]) this.stop(id)
    },
  }
}
