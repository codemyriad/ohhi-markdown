import { describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'
import type { AgentHost, HarnessAgent, ProposeEditInput, ProviderConfig, RunRecord, SuggestionRecord } from '@ohhi/harness'
import { MemoryIndex } from '@ohhi/index'
import { mockLlmFetch, SimClock } from '@ohhi/testkit'
import { createAppBackend } from './agent-backend.js'
import { createRunRegistry, finalText, type RunRegistryDeps } from './ai-runs.svelte.js'
import { appAgentHost, type AgentFactory } from './ai-transport.js'
import { createSessionStore, latestRuns } from './session-store.js'
import { memAppFiles } from './harness.fixture.js'

const PROVIDER: ProviderConfig = { id: 'p1', name: 'Local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', model: 'mock-model', apiKey: 'k' }

/** A stub agent whose stream plays `chunks`; `hold` keeps it open until aborted. */
function stubAgent(chunks: UIMessageChunk[], opts: { hold?: boolean; usage?: RunRecord['usage'] } = {}): AgentFactory {
  return (() => {
    const agent: HarnessAgent = {
      async stream(_messages, { signal }) {
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            for (const c of chunks) controller.enqueue(c)
            if (!opts.hold) controller.close()
            signal?.addEventListener('abort', () => controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          },
        })
      },
      lastUsage: () => opts.usage,
    }
    return agent
  }) as unknown as AgentFactory
}

const TEXT: UIMessageChunk[] = [
  { type: 'start' },
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Hello ' },
  { type: 'text-delta', id: 't1', delta: 'there' },
  { type: 'text-end', id: 't1' },
  { type: 'finish' },
]

function setup(over: Partial<RunRegistryDeps> = {}) {
  const clock = new SimClock()
  const files = memAppFiles()
  const store = createSessionStore(files, { clock, vault: 'v' })
  const host = (): AgentHost => ({ backend: {} as AgentHost['backend'], clock, fetch, skills: { list: async () => [], body: async () => null } })
  const deps: RunRegistryDeps = { store, clock, provider: () => PROVIDER, host, agentFactory: stubAgent(TEXT, { usage: { input: 10, output: 2 } }), ...over }
  return { clock, files, store, deps, registry: createRunRegistry(deps) }
}

async function statuses(store: ReturnType<typeof setup>['store'], id: string): Promise<string[]> {
  const loaded = await store.load(id)
  return loaded!.entries.flatMap((e) => (e.type === 'run' ? [e.run.status] : []))
}

describe('run registry', () => {
  it('walks scheduled → running → successful, recording each step and both messages', async () => {
    const { store, registry } = setup()
    await store.create({ id: 's1' })
    const handle = (await registry.start('s1', { instruction: 'Say hi' }))!
    expect(handle.sessionId).toBe('s1')

    const done = await handle.done
    expect(done).toMatchObject({ status: 'successful', usage: { input: 10, output: 2 }, provider: 'p1', model: 'mock-model', host: 'localhost:11434' })
    expect(await statuses(store, 's1')).toEqual(['scheduled', 'running', 'successful'])

    const chat = registry.loaded('s1')!
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(chat.messages[1].parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'Hello there' }))
    expect(registry.current('s1')?.status).toBe('successful')
    expect(registry.active()).toEqual([])

    // The file holds the turn: the person's message, then the agent's.
    const roles = (await store.load('s1'))!.entries.flatMap((e) => (e.type === 'message' ? [e.message.role] : []))
    expect(roles).toEqual(['user', 'assistant'])
  })

  it('a session file that refuses the first write starts nothing and leaves the session free', async () => {
    const { store, registry, files } = setup()
    await store.create({ id: 's1' })
    const write = files.writeAppFile
    files.writeAppFile = async () => {
      throw new Error('disk full')
    }
    expect(await registry.start('s1', { instruction: 'x' })).toBeNull()
    expect(registry.active()).toEqual([])
    expect(registry.current('s1')).toMatchObject({ status: 'failed', error: 'disk full' })
    files.writeAppFile = write
    expect((await (await registry.start('s1', { instruction: 'y' }))!.done).status).toBe('successful')
  })

  it('stamps start and end on the injected clock', async () => {
    const { store, registry, clock } = setup({ agentFactory: stubAgent(TEXT, { hold: true }) })
    await store.create({ id: 's1' })
    clock.advance(1_000)
    const handle = (await registry.start('s1', { instruction: 'x' }))!
    await new Promise((r) => setTimeout(r, 0))
    clock.advance(4_000)
    registry.stop('s1')
    const run = await handle.done
    expect(run.status).toBe('cancelled')
    expect(run.startedAt).toBe(1_000)
    expect(run.endedAt).toBe(5_000)
  })

  it('a stream error fails the run with the provider’s words', async () => {
    const { store, registry } = setup({ agentFactory: stubAgent([{ type: 'start' }, { type: 'error', errorText: 'bad key' }]) })
    await store.create({ id: 's1' })
    const run = await (await registry.start('s1', { instruction: 'x' }))!.done
    expect(run).toMatchObject({ status: 'failed', error: 'bad key' })
    expect(run.usage).toBeUndefined()
  })

  it('stop cancels a running turn and keeps it stoppable from outside the view', async () => {
    const { store, registry } = setup({ agentFactory: stubAgent(TEXT.slice(0, 3), { hold: true }) })
    await store.create({ id: 's1' })
    const handle = (await registry.start('s1', { instruction: 'x' }))!
    await new Promise((r) => setTimeout(r, 0))
    expect(registry.active()).toEqual(['s1'])
    expect(registry.stop('s1')).toBe(true)
    expect((await handle.done).status).toBe('cancelled')
    expect(registry.stop('s1')).toBe(false)
    expect(await statuses(store, 's1')).toEqual(['scheduled', 'running', 'cancelled'])
  })

  it('refuses a second turn while one is in flight, and a turn with no provider', async () => {
    const { store, registry } = setup({ agentFactory: stubAgent(TEXT, { hold: true }) })
    await store.create({ id: 's1' })
    expect(await registry.start('s1', { instruction: 'one' })).not.toBeNull()
    expect(await registry.start('s1', { instruction: 'two' })).toBeNull()
    registry.stopAll()

    const none = setup({ provider: () => null })
    await none.store.create({ id: 's2' })
    expect(await none.registry.start('s2', { instruction: 'x' })).toBeNull()
  })

  it('a reload resumes the transcript, and a run left in flight reads as stopped', async () => {
    const { store, deps, registry } = setup({ agentFactory: stubAgent(TEXT, { hold: true }) })
    await store.create({ id: 's1' })
    await registry.start('s1', { instruction: 'x' })
    await new Promise((r) => setTimeout(r, 0))
    // The app goes away mid-run: a fresh registry over the same file.
    const fresh = createRunRegistry(deps)
    store.invalidate()
    const chat = await fresh.chat('s1')
    expect(chat.messages.map((m) => m.role)).toEqual(['user'])
    expect(fresh.current('s1')?.status).toBe('cancelled')
    registry.stopAll()
  })

  it('runs a real harness agent over the app backend with the mock LLM', async () => {
    const clock = new SimClock()
    const store = createSessionStore(memAppFiles(), { clock, vault: 'v' })
    const index = new MemoryIndex()
    index.rebuild([{ guid: 'g1', path: 'plan.md', text: '# Plan\n\nShip the harness.\n' }])
    const backend = createAppBackend({
      root: 'v',
      clock,
      index,
      files: () => [{ path: 'plan.md', guid: 'g1', kind: 'text' }],
      liveText: () => '# Plan\n\nShip the harness.\n',
      readFileBytes: async () => null,
      journal: () => null,
    })
    const fetch = mockLlmFetch([{ toolCall: { name: 'ohhi_search', args: { query: 'harness' } } }, { text: 'It says ship it.' }])
    const registry = createRunRegistry({ store, clock, provider: () => PROVIDER, host: () => appAgentHost({ backend, clock, fetch }) })
    await store.create({ id: 's1' })

    const run = await (await registry.start('s1', { instruction: 'What does the plan say?' }))!.done
    expect(run.error).toBeUndefined()
    expect(run.status).toBe('successful')
    const reply = registry.loaded('s1')!.messages.at(-1)!
    const types = reply.parts.map((p) => p.type)
    expect(types).toContain('tool-ohhi_search')
    expect(reply.parts).toContainEqual(expect.objectContaining({ type: 'text', text: 'It says ship it.' }))
    // The model was handed the search's result.
    expect(fetch.requests[1].toolResults[0].output).toContain('plan.md')
    expect(latestRuns((await store.load('s1'))!.entries).map((r) => r.status)).toEqual(['successful'])
  })

  it('the agent’s patch lands as a suggestion on the run (mutating tools, ids on the record), and the answer is its reply', async () => {
    const { clock, store } = setup()
    const text = '# Plan\r\n\r\nShip the harness.\r\n'
    const live = '# Plan\n\nShip the harness soon.\n'
    const index = new MemoryIndex()
    index.rebuild([{ guid: 'g1', path: 'plan.md', text: live }])
    const backend = createAppBackend({
      root: 'v',
      clock,
      index,
      files: () => [{ path: 'plan.md', guid: 'g1', kind: 'text' }],
      liveText: () => live,
      readFileBytes: async () => new TextEncoder().encode(text),
      journal: () => null,
    })
    const proposed: ProposeEditInput[] = []
    const record = (input: ProposeEditInput, status: SuggestionRecord['status']): SuggestionRecord => ({
      id: `sg-${proposed.length}`, path: input.path, origin: input.origin, at: 0, range: { from: input.from, to: input.to },
      baseText: input.baseText, proposedText: input.proposedText, status, ...(input.origin.threadId ? { threadId: input.origin.threadId } : {}),
    })
    const proposals = {
      proposeEdit: async (input: ProposeEditInput) => (proposed.push(input), record(input, 'pending')),
      applyAgentEdit: async (input: ProposeEditInput) => record(input, 'accepted'),
    }
    const fetch = mockLlmFetch([
      { toolCall: { name: 'ohhi_patch', args: { path: 'plan.md', old: 'soon', new: 'this week' } } },
      { text: 'Proposed “this week”.' },
    ])
    const registry = createRunRegistry({ store, clock, provider: () => PROVIDER, host: () => appAgentHost({ backend, clock, fetch, proposals }) })
    await store.create({ id: 's1' })

    const run = await (await registry.start('s1', { instruction: 'Be specific', threadId: 'th-1' }))!.done
    expect(run.status).toBe('successful')
    expect(fetch.requests[0].tools).toContain('ohhi_patch')
    expect(proposed).toHaveLength(1)
    // Offsets into the LIVE text (LF), not the CRLF disk copy: the suggestion's doc is the Y.Text.
    const p = proposed[0]
    expect(live.slice(p.from, p.to)).toBe(p.baseText)
    expect(live.slice(0, p.from) + p.proposedText + live.slice(p.to)).toBe('# Plan\n\nShip the harness this week.\n')
    expect(p.origin).toMatchObject({ kind: 'agent', runId: run.runId, sessionId: 's1', threadId: 'th-1' })
    expect(run.suggestions).toEqual(['sg-1'])
    expect(latestRuns((await store.load('s1'))!.entries)[0].suggestions).toEqual(['sg-1'])
    expect(registry.reply(run.runId)).toBe('Proposed “this week”.')
  })

  it('direct mode applies each edit as it lands; off, it is proposed and stays pending', async () => {
    const calls: string[] = []
    const rec = (input: ProposeEditInput, status: SuggestionRecord['status']): SuggestionRecord => ({
      id: 'sg-1', path: input.path, origin: input.origin, at: 0, range: { from: 0, to: 0 }, baseText: '', proposedText: 'x', status,
    })
    const sink = {
      proposeEdit: async (input: ProposeEditInput): Promise<SuggestionRecord> => (calls.push(`propose ${input.path}`), rec(input, 'pending')),
      applyAgentEdit: async (input: ProposeEditInput): Promise<SuggestionRecord> => (calls.push(`apply ${input.path}`), rec(input, 'accepted')),
    }
    let direct = false
    const host = appAgentHost({ backend: {} as AgentHost['backend'], clock: new SimClock(), proposals: sink, direct: () => direct })
    const input: ProposeEditInput = { path: 'a.md', from: 0, to: 0, baseText: '', proposedText: 'x', origin: { kind: 'agent', runId: 'r', sessionId: 's', name: 'A' } }
    expect((await host.proposeEdit!(input)).status).toBe('pending')
    direct = true
    expect((await host.proposeEdit!(input)).status).toBe('accepted')
    expect(calls).toEqual(['propose a.md', 'apply a.md'])
    expect(appAgentHost({ backend: {} as AgentHost['backend'], clock: new SimClock() }).proposeEdit).toBeUndefined()
  })
})

describe('finalText', () => {
  it('is the text after the last tool call; every text part when the last step said nothing', () => {
    const parts = [
      { type: 'step-start' },
      { type: 'text', text: 'Let me look. ' },
      { type: 'tool-ohhi_search', state: 'output-available' },
      { type: 'step-start' },
      { type: 'text', text: 'It says ship it.' },
    ] as Parameters<typeof finalText>[0]['parts']
    expect(finalText({ parts })).toBe('It says ship it.')
    expect(finalText({ parts: parts.slice(0, 3) })).toBe('Let me look.')
  })
})
