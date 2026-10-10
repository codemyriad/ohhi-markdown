import { afterEach, describe, expect, it } from 'vitest'
import type { UIMessageChunk } from 'ai'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { SimClock } from '@ohhi/testkit'
import { DocAgentPresence, type AgentPresenceState } from '@ohhi/workspace'
import { AGENT_LINGER_MS, presenceStream, resetAgentPresence, workingHost } from './agent-presence.js'
import { initialsOf, workingRangesOf } from './presence.js'

afterEach(() => resetAgentPresence())

async function pipe(chunks: UIMessageChunk[], t: TransformStream<UIMessageChunk, UIMessageChunk>): Promise<UIMessageChunk[]> {
  const src = new ReadableStream<UIMessageChunk>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch)
      c.close()
    },
  })
  const out: UIMessageChunk[] = []
  const reader = src.pipeThrough(t).getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return out
    out.push(value)
  }
}

describe('presenceStream — what the run is doing, told to AgentHost.presence', () => {
  it('thinking → the note a tool names → composing with the proposal’s range → idle, then leaves', async () => {
    const clock = new SimClock()
    const seen: (AgentPresenceState | null)[] = []
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'tool-input-available', toolCallId: '1', toolName: 'ohhi_read', input: { path: 'b.md' } },
      { type: 'tool-output-available', toolCallId: '1', output: { schema: 'ohhi.read.v1' } },
      {
        type: 'tool-output-available',
        toolCallId: '2',
        output: { schema: 'ohhi.proposal.v1', path: 'b.md', proposed: true, suggestionId: 's', from: 3, to: 7, message: '' },
      },
      { type: 'text-start', id: 't' },
      { type: 'text-delta', id: 't', delta: 'Do' },
      { type: 'text-delta', id: 't', delta: 'ne' },
      { type: 'finish' },
    ] as UIMessageChunk[]
    const out = await pipe(chunks, presenceStream({ set: (s) => seen.push(s) }, { name: 'Agent', path: 'a.md', clock }))
    expect(out).toEqual(chunks) // unchanged
    expect(seen).toEqual([
      { name: 'Agent', status: 'thinking', path: 'a.md' },
      { name: 'Agent', status: 'thinking', path: 'b.md' },
      { name: 'Agent', status: 'composing', path: 'b.md', working: [{ from: 3, to: 7 }] },
      { name: 'Agent', status: 'idle', path: 'b.md', working: [{ from: 3, to: 7 }] },
    ])
    clock.advance(AGENT_LINGER_MS)
    expect(seen.at(-1)).toBeNull()
  })

  it('a new run cancels the last one’s pending leave', async () => {
    const clock = new SimClock()
    const seen: (AgentPresenceState | null)[] = []
    const sink = { set: (s: AgentPresenceState | null) => seen.push(s) }
    await pipe([{ type: 'finish' } as UIMessageChunk], presenceStream(sink, { name: 'Agent', path: 'a.md', clock }))
    clock.advance(AGENT_LINGER_MS / 2)
    await pipe([{ type: 'start' } as UIMessageChunk], presenceStream(sink, { name: 'Agent', path: 'a.md', clock }))
    const nulls = (): number => seen.filter((s) => s === null).length
    clock.advance(AGENT_LINGER_MS / 2 + 1)
    expect(nulls()).toBe(0) // the first run's leave was cancelled
    clock.advance(AGENT_LINGER_MS)
    expect(nulls()).toBe(1)
  })
})

describe('workingHost — the highlight fed from awareness', () => {
  it('resolves an agent’s working ranges in the doc, ignores people, and signals on change', () => {
    const clock = new SimClock()
    const ydoc = new Y.Doc()
    ydoc.getText('content').insert(0, 'alpha beta gamma')
    const awareness = new Awareness(ydoc)
    awareness.setLocalStateField('user', { name: 'Chris', color: '#000' })
    const agent = new DocAgentPresence(awareness, ydoc, clock)
    try {
      const host = workingHost(() => awareness, () => ydoc)
      let signals = 0
      const off = host.subscribe(() => signals++)
      agent.set({ name: 'Agent', status: 'composing', working: [{ from: 6, to: 10 }] })
      expect(signals).toBeGreaterThan(0)
      expect(host.current()).toEqual([{ from: 6, to: 10, name: 'Agent (agent)' }])
      ydoc.getText('content').insert(0, '>> ')
      expect(host.current()).toEqual([{ from: 9, to: 13, name: 'Agent (agent)' }])
      off()
      agent.set(null)
      expect(workingRangesOf(awareness.getStates() as Map<number, Record<string, unknown>>, ydoc)).toEqual([])
    } finally {
      agent.dispose()
      awareness.destroy()
    }
  })

  it('without an awareness there is nothing to draw', () => {
    const host = workingHost(() => null, () => null)
    expect(host.current()).toEqual([])
    host.subscribe(() => {})()
  })
})

describe('an agent’s initials', () => {
  it('drop the trailing qualifier', () => {
    expect(initialsOf('Agent (agent)')).toBe('A')
    expect(initialsOf('pitch editor (Chris)')).toBe('PE')
    expect(initialsOf('Cynthia Lee')).toBe('CL')
  })
})
