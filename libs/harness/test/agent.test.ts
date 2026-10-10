import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mockLlmFetch } from '@ohhi/testkit'
import { createHarnessAgent, MAX_STEPS } from '../src/agent.js'
import type { SkillMeta } from '../src/types.js'
import { ask, drain, harness, hostOf, KINDS, ORIGIN, providerOf, type Harness } from './helpers.js'

let h: Harness
beforeEach(async () => {
  h = await harness()
})
afterEach(() => h.cleanup())

const base = { refs: [], mutates: false, origin: ORIGIN }

describe('createHarnessAgent over the fixture vault', () => {
  it.each(KINDS)('%s: a text turn streams the answer and records usage', async (kind) => {
    const mock = mockLlmFetch([{ text: 'Your vault has notes about JSON.', usage: { input: 42, output: 7 } }])
    const agent = createHarnessAgent(hostOf(h, mock), { ...base, provider: providerOf(kind) })
    const out = await drain(await agent.stream(ask('What is in my vault?'), {}))
    expect(out.errors).toEqual([])
    expect(out.text).toBe('Your vault has notes about JSON.')
    expect(agent.lastUsage()).toEqual({ input: 42, output: 7 })
    const [req] = mock.requests
    expect(req.system).toContain('## Working with the vault')
    expect(req.tools).toContain('ohhi_search')
    expect(req.tools).not.toContain('ohhi_write')
  })

  it.each(KINDS)('%s: a tool-call turn runs the tool on the vault, and the result reaches the next turn', async (kind) => {
    const mock = mockLlmFetch([
      { toolCall: { name: 'ohhi_search', args: { query: 'canonical', limit: 5 } } },
      { text: 'Projects/Editor.md says files are canonical.' },
    ])
    const agent = createHarnessAgent(hostOf(h, mock), { ...base, provider: providerOf(kind) })
    const out = await drain(await agent.stream(ask('Where do I say files are canonical?'), {}))
    expect(out.errors).toEqual([])
    expect(out.tools).toHaveLength(1)
    expect(out.tools[0]).toMatchObject({ name: 'ohhi_search', input: { query: 'canonical', limit: 5 } })
    expect(JSON.stringify(out.tools[0].output)).toContain('Projects/Editor.md')
    expect(out.text).toBe('Projects/Editor.md says files are canonical.')
    expect(mock.requests).toHaveLength(2)
    const [result] = mock.requests[1].toolResults
    expect(result.name).toBe('ohhi_search')
    expect(result.output).toContain('Projects/Editor.md')
    expect(agent.lastUsage()?.input).toBe(20)
  })

  it('puts the active skill, the catalog and the references into the prompt', async () => {
    const meta: SkillMeta = { name: 'line-edit', description: 'Tighten prose.', dir: '.agents/skills/line-edit', metadata: {}, hasScripts: false, problems: [] }
    const mock = mockLlmFetch([{ text: 'ok' }])
    const host = hostOf(h, mock, { skills: { list: async () => [meta], body: async () => 'Tighten.' } })
    const agent = createHarnessAgent(host, {
      ...base,
      provider: providerOf('openai'),
      skill: { meta, body: 'Cut every adverb.' },
      refs: [{ id: 'r', ref: { kind: 'lines', path: 'Areas/CS/JSON.md', lines: { from: 3, to: 3 } }, label: 'JSON.md (3–3)', snapshot: 'A tiny note.' }],
    })
    await drain(await agent.stream(ask('Tighten this.'), {}))
    const { system } = mock.requests[0]
    expect(system).toContain('<name>line-edit</name>')
    expect(system).toContain('## Active skill: line-edit\n\nThe person ran this skill. Follow it.\n\nCut every adverb.')
    expect(system).toContain('### Areas/CS/JSON.md (3–3)')
  })

  it('a turn a comment thread asked carries the thread rule; any other turn does not', async () => {
    const mock = mockLlmFetch([{ text: 'one' }, { text: 'two' }])
    await drain(await createHarnessAgent(hostOf(h, mock), { ...base, provider: providerOf('openai') }).stream(ask('Hi'), {}))
    const threaded = createHarnessAgent(hostOf(h, mock), { ...base, provider: providerOf('openai'), origin: { ...ORIGIN, threadId: 't-1' } })
    await drain(await threaded.stream(ask('Is this clear?'), {}))
    expect(mock.requests[0].system).not.toContain('## A comment asked')
    expect(mock.requests[1].system).toContain('## A comment asked')
  })

  it('a provider error is the stream’s error part, with the provider’s message, and leaves no usage', async () => {
    const mock = mockLlmFetch([{ error: { status: 401, message: 'invalid x-api-key' } }])
    const agent = createHarnessAgent(hostOf(h, mock), { ...base, provider: providerOf('anthropic') })
    const out = await drain(await agent.stream(ask('hi'), {}))
    expect(out.errors.join(' ')).toMatch(/invalid x-api-key/)
    expect(agent.lastUsage()).toBeUndefined()
  })

  it('a proposal from the loop lands through host.proposeEdit, never on disk', async () => {
    const before = await h.text('Areas/CS/JSON.md')
    const proposed: string[] = []
    const host = hostOf(h, mockLlmFetch([
      { toolCall: { name: 'ohhi_patch', args: { path: 'Areas/CS/JSON.md', old: 'tiny', new: 'small' } } },
      { text: 'Proposed: tiny → small in JSON.md.' },
    ]), {
      proposeEdit: async (input) => {
        proposed.push(`${input.baseText}→${input.proposedText}`)
        return { id: 'sg-1', path: input.path, origin: input.origin, at: 0, range: { from: input.from, to: input.to }, baseText: input.baseText, proposedText: input.proposedText, status: 'pending' }
      },
    })
    const agent = createHarnessAgent(host, { ...base, mutates: true, provider: providerOf('openai') })
    const out = await drain(await agent.stream(ask('Say small, not tiny.'), {}))
    expect(proposed).toEqual(['tiny→small'])
    expect(out.tools[0].output).toMatchObject({ proposed: true, suggestionId: 'sg-1' })
    expect(await h.text('Areas/CS/JSON.md')).toBe(before)
  })

  it('stops after MAX_STEPS tool calls', async () => {
    const loop = Array.from({ length: MAX_STEPS + 3 }, () => ({ toolCall: { name: 'ohhi_stats', args: {} } }))
    const mock = mockLlmFetch(loop)
    const agent = createHarnessAgent(hostOf(h, mock), { ...base, provider: providerOf('openai') })
    await drain(await agent.stream(ask('loop'), {}))
    expect(mock.requests).toHaveLength(MAX_STEPS)
  })

  it('the caller’s signal cancels the run', async () => {
    const controller = new AbortController()
    controller.abort()
    const agent = createHarnessAgent(hostOf(h, mockLlmFetch([{ text: 'never' }])), { ...base, provider: providerOf('openai') })
    const out = await drain(await agent.stream(ask('hi'), { signal: controller.signal })).catch((e: unknown) => ({ thrown: e }))
    if ('text' in out) expect(out.text).toBe('')
    expect(agent.lastUsage()).toBeUndefined()
  })

  it('timeoutSec aborts on the host’s clock — a SimClock test fires it', async () => {
    let release: () => void = () => {}
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        release = () => reject(new Error('released'))
      })
    const agent = createHarnessAgent(hostOf(h, hanging), { ...base, provider: providerOf('openai', { timeoutSec: 30 }) })
    const pending = agent.stream(ask('hi'), {}).then(drain)
    await new Promise((r) => setImmediate(r))
    h.clock.advance(30_000)
    const out = await pending
    release()
    expect(out.errors).toEqual(['the provider did not finish within 30s'])
    expect(out.chunks.some((c) => c.type === 'abort')).toBe(false)
    expect(agent.lastUsage()).toBeUndefined()
  })
})
