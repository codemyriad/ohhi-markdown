/**
 * The shell's harness state without a view: the provider a run resolves to,
 * what a Retry sends, and presence counted per note across runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentPresenceState } from '@ohhi/workspace'
import type { SkillMeta } from '@ohhi/harness'
import { MemoryIndex } from '@ohhi/index'
import { SimClock } from '@ohhi/testkit'
import { setAiConfig } from './ai-config.svelte.js'
import { dropStorage, useMemStorage } from './storage.fixture.js'
import { attachHarness, countedPresence, resolveProvider, retryInput, startRun } from './sessions.svelte.js'
import type { Workspace } from './workspace.svelte.js'
import { memAppFiles } from './harness.fixture.js'

const P = (id: string) => ({ id, name: id, kind: 'openai' as const, baseUrl: '', model: 'm', apiKey: 'k' })

beforeEach(() => useMemStorage())
afterEach(() => {
  attachHarness(null)
  dropStorage()
})

describe('resolveProvider', () => {
  it('an asked-for provider that is gone resolves to nothing — never another host', () => {
    setAiConfig({ providers: [P('a'), P('b')], defaultProvider: 'b' })
    expect(resolveProvider()?.id).toBe('b')
    expect(resolveProvider('a')?.id).toBe('a')
    expect(resolveProvider('deleted')).toBeNull()
  })

  it('startRun on a deleted provider starts nothing and says so', async () => {
    setAiConfig({ providers: [P('a')] })
    const flash = vi.fn()
    const workspace = { room: 'r', ...memAppFiles(), onAppFileChange: () => () => {} } as unknown as Workspace
    attachHarness({ workspace: () => workspace, index: new MemoryIndex(), clock: new SimClock(), openView: vi.fn(), flash })
    expect(await startRun({ instruction: 'x', providerId: 'deleted' })).toBeNull()
    expect(flash).toHaveBeenCalledWith(expect.objectContaining({ level: 'error' }))
  })
})

describe('retryInput', () => {
  const meta: SkillMeta = { name: 'tighten', description: 'd', dir: '.agents/skills/tighten', metadata: {}, hasScripts: false, problems: [] }

  it('keeps the skill (re-read, so still trusted) and the thread', async () => {
    attachHarness({
      workspace: () => null,
      index: new MemoryIndex(),
      clock: new SimClock(),
      openView: vi.fn(),
      skills: () => ({ list: async () => [meta], body: async () => 'Tighten it.' }),
    })
    const input = await retryInput({ input: { instruction: 'go', refs: [], skill: 'tighten' }, threadId: 'th-1' })
    expect(input).toEqual({ instruction: 'go', refs: [], skill: { meta, body: 'Tighten it.' }, threadId: 'th-1' })
  })

  it('leaves a skill out that is no longer offered', async () => {
    attachHarness({ workspace: () => null, index: new MemoryIndex(), clock: new SimClock(), openView: vi.fn() })
    expect(await retryInput({ input: { instruction: 'go', refs: [], skill: 'tighten' } })).toEqual({ instruction: 'go', refs: [] })
  })
})

describe('countedPresence', () => {
  it('two runs on one note: the first to finish leaves the presence to the second', () => {
    const told: (AgentPresenceState | null)[] = []
    const sink = { set: (s: AgentPresenceState | null) => void told.push(s) }
    const live = new Map<string, number>()
    const a = countedPresence(sink, live)
    const b = countedPresence(sink, live)
    a.set({ name: 'A', status: 'thinking', path: 'n.md' })
    b.set({ name: 'B', status: 'composing', path: 'n.md' })
    a.set({ name: 'A', status: 'idle', path: 'n.md' })
    a.set(null)
    expect(told.at(-1)).toMatchObject({ name: 'B', status: 'composing' })
    b.set({ name: 'B', status: 'idle', path: 'n.md' })
    b.set(null)
    expect(told.slice(-2)).toEqual([{ name: 'B', status: 'idle', path: 'n.md' }, null])
    expect(live.size).toBe(0)
  })

  it('a run on another note is counted on its own', () => {
    const told: (AgentPresenceState | null)[] = []
    const live = new Map<string, number>()
    const a = countedPresence({ set: (s) => void told.push(s) }, live)
    const b = countedPresence({ set: (s) => void told.push(s) }, live)
    a.set({ name: 'A', status: 'thinking', path: 'one.md' })
    b.set({ name: 'B', status: 'thinking', path: 'two.md' })
    a.set(null)
    expect(told.at(-1)).toBeNull()
  })
})
