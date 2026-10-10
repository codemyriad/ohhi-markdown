import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { SimClock } from '@ohhi/testkit'
import {
  AGENT_AWARENESS_ORIGIN,
  AGENT_PRESENCE_COALESCE_MS,
  AGENT_PRESENCE_RENEW_MS,
  DocAgentPresence,
  isAgentAwareness,
  routeAgentPresence,
  type AgentAwarenessState,
  type AgentPresenceSink,
  type AgentPresenceState,
} from '../src/agent-presence.js'
import { decodeRange } from '../src/anchors.js'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0)) fn()
})

function setup(text = 'alpha beta gamma') {
  const clock = new SimClock()
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  const awareness = new Awareness(doc)
  awareness.setLocalStateField('user', { name: 'Chris', color: '#000' })
  const presence = new DocAgentPresence(awareness, doc, clock, {
    label: (n) => `${n} (agent)`,
    color: () => '#123456',
  })
  cleanup.push(() => {
    presence.dispose()
    awareness.destroy()
  })
  const agentState = (): AgentAwarenessState | undefined =>
    awareness.getStates().get(presence.clientId) as AgentAwarenessState | undefined
  return { clock, doc, awareness, presence, agentState }
}

const thinking: AgentPresenceState = { name: 'Agent', status: 'thinking' }

describe('DocAgentPresence — a second awareness state for the agent', () => {
  it('publishes the agent under its own client id, beside the person, typed `agent`', () => {
    const { awareness, presence, agentState } = setup()
    presence.set(thinking)
    expect(presence.clientId).not.toBe(awareness.clientID)
    expect(agentState()).toEqual({
      user: { name: 'Agent (agent)', color: '#123456' },
      type: 'agent',
      status: 'thinking',
      here: true,
      working: [],
      cursor: null,
    })
    expect(isAgentAwareness(agentState())).toBe(true)
    // The person's own state is untouched.
    expect(awareness.getLocalState()).toEqual({ user: { name: 'Chris', color: '#000' } })
  })

  it('pins `working` ranges with relative positions, so they follow edits; the caret sits at the newest end', () => {
    const { doc, presence, agentState } = setup()
    presence.set({ ...thinking, status: 'composing', working: [{ from: 6, to: 10 }] })
    doc.getText('content').insert(0, '>> ')
    const w = agentState()!.working[0]!
    expect(decodeRange(doc, [w.anchor, w.head])).toEqual({ from: 9, to: 13 })
    expect(doc.getText('content').toString().slice(9, 13)).toBe('beta')
    expect(agentState()!.cursor).toEqual({ anchor: w.head, head: w.head })
  })

  it('coalesces `set` to one publish per 300 ms, newest wins; null clears at once', () => {
    const { clock, awareness, presence, agentState } = setup()
    const updates: number[] = []
    awareness.on('update', (_c: unknown, origin: unknown) => {
      if (origin === AGENT_AWARENESS_ORIGIN) updates.push(clock.now())
    })
    presence.set(thinking) // leading edge
    for (let i = 0; i < 20; i++) {
      clock.advance(20)
      presence.set({ ...thinking, status: i % 2 ? 'composing' : 'thinking', working: [{ from: i, to: i + 1 }] })
    }
    clock.advance(AGENT_PRESENCE_COALESCE_MS)
    expect(updates.length).toBeLessThanOrEqual(3) // 0, 300, 600 over 400 ms of calls
    for (let i = 1; i < updates.length; i++) expect(updates[i]! - updates[i - 1]!).toBeGreaterThanOrEqual(AGENT_PRESENCE_COALESCE_MS)
    expect(agentState()!.status).toBe('composing') // the last call (i = 19)
    presence.set(null)
    expect(agentState()).toBeUndefined()
  })

  it('renews a standing state before y-protocols would time it out, and stops when cleared', () => {
    const { clock, awareness, presence } = setup()
    let renewals = 0
    awareness.on('update', (_c: unknown, origin: unknown) => {
      if (origin === AGENT_AWARENESS_ORIGIN) renewals++
    })
    presence.set(thinking)
    clock.advance(AGENT_PRESENCE_RENEW_MS * 3)
    expect(renewals).toBe(4)
    presence.set(null)
    clock.advance(AGENT_PRESENCE_RENEW_MS * 3)
    expect(renewals).toBe(5)
    expect(clock.pendingCount()).toBe(0)
  })

  it('reaches a peer like any awareness update: a peer sees the agent arrive and leave', () => {
    const { awareness, presence } = setup()
    const peerDoc = new Y.Doc()
    const peer = new Awareness(peerDoc)
    cleanup.push(() => peer.destroy())
    // The relay: forward every update the device's awareness emits.
    awareness.on('update', ({ added, updated, removed }: Record<string, number[]>) => {
      const ids = [...added!, ...updated!, ...removed!]
      applyAwarenessUpdate(peer, encodeAwarenessUpdate(awareness, ids), 'relay')
    })
    presence.set(thinking)
    expect((peer.getStates().get(presence.clientId) as AgentAwarenessState).user.name).toBe('Agent (agent)')
    presence.set(null)
    expect(peer.getStates().has(presence.clientId)).toBe(false)
  })

  it('dispose clears the state and leaves no timer behind', () => {
    const { clock, presence, agentState } = setup()
    presence.set(thinking)
    presence.set({ ...thinking, status: 'composing' }) // queued behind the coalesce
    presence.dispose()
    expect(agentState()).toBeUndefined()
    expect(clock.pendingCount()).toBe(0)
    presence.set(thinking) // inert
    expect(agentState()).toBeUndefined()
  })
})

describe('routeAgentPresence — one run across notes', () => {
  function sinks() {
    const log: string[] = []
    const make = (path: string): AgentPresenceSink => ({
      set: (s) => log.push(`${path}:${s ? s.status : 'null'}`),
    })
    return { log, lookup: (path: string) => (path === 'none.md' ? null : make(path)) }
  }

  it('follows `state.path`, clearing the note it leaves; falls back to the run’s note', () => {
    const { log, lookup } = sinks()
    const r = routeAgentPresence(lookup, 'a.md')
    r.set(thinking)
    r.set({ ...thinking, status: 'composing' })
    r.set({ ...thinking, path: 'b.md' })
    r.set({ ...thinking, status: 'idle' }) // stays on b
    r.set(null)
    expect(log).toEqual(['a.md:thinking', 'a.md:composing', 'a.md:null', 'b.md:thinking', 'b.md:idle', 'b.md:null'])
  })

  it('shows nothing on a note with no awareness, and nothing without a path', () => {
    const { log, lookup } = sinks()
    routeAgentPresence(lookup).set(thinking)
    const r = routeAgentPresence(lookup)
    r.set({ ...thinking, path: 'none.md' })
    r.set(null)
    expect(log).toEqual([])
  })
})
