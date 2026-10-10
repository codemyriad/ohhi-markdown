/**
 * The agent as a peer, in the shell (writing-harness-shaping B10).
 *
 * Two adapters between the harness and `@ohhi/workspace`'s
 * `agent-presence.ts`:
 *
 *  - `presenceStream` — what a run is doing, read off its UI-message stream
 *    and told to `AgentHost.presence`: `thinking` from the start and on each
 *    tool call (on the note the call names), `composing` while it writes
 *    text, and the range of every proposal it makes as `working`. When the
 *    stream ends the agent goes `idle` and stays visible for
 *    `AGENT_LINGER_MS`, so a peer sees who just proposed — then leaves.
 *  - `workingHost` — the editor's working highlight (`@ohhi/editor`) fed
 *    from a note's awareness: every agent state's `working` ranges, resolved
 *    against the doc whenever the awareness changes.
 *
 * Time is the shell's injected clock (the linger), so a test drives it.
 */
import type { UIMessageChunk } from 'ai'
import type { WorkingHost } from '@ohhi/editor'
import type { AgentPresenceSink, AgentPresenceState } from '@ohhi/workspace'
import type { Clock } from '@ohhi/vault'
import type { EngineDoc } from '@ohhi/sync'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { workingRangesOf } from './presence.js'

/** How long an agent that finished stays on the page (`idle`) before it leaves. */
export const AGENT_LINGER_MS = 15_000

/** The newest run's pending "leave", cancelled when another run starts. */
let cancelLinger: (() => void) | null = null

/** A proposal's tool output (`@ohhi/harness`'s `ProposalResult`), loosely. */
function proposalOf(output: unknown): { path: string; from: number; to: number } | null {
  const o = output as { schema?: unknown; path?: unknown; proposed?: unknown; from?: unknown; to?: unknown } | null
  if (!o || o.schema !== 'ohhi.proposal.v1' || o.proposed !== true || typeof o.path !== 'string') return null
  if (typeof o.from !== 'number' || typeof o.to !== 'number') return null
  return { path: o.path, from: o.from, to: o.to }
}

/**
 * Pass a run's chunks through unchanged, telling `sink` what the agent is
 * doing. `path` is where it starts (its first reference, or the focused
 * note); a tool call on another note moves it there.
 */
export function presenceStream(
  sink: AgentPresenceSink,
  opts: { name: string; path?: string; clock: Clock }
): TransformStream<UIMessageChunk, UIMessageChunk> {
  let state: AgentPresenceState = { name: opts.name, status: 'thinking', ...(opts.path ? { path: opts.path } : {}) }
  const tell = (next: Partial<AgentPresenceState>): void => {
    const merged = { ...state, ...next }
    if (
      merged.status === state.status &&
      merged.path === state.path &&
      JSON.stringify(merged.working) === JSON.stringify(state.working)
    ) {
      return
    }
    state = merged
    sink.set(state)
  }
  const end = (): void => {
    tell({ status: 'idle' })
    cancelLinger?.()
    const cancel = opts.clock.schedule(() => {
      if (cancelLinger === cancel) cancelLinger = null
      sink.set(null)
    }, AGENT_LINGER_MS)
    cancelLinger = cancel
  }
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    start() {
      cancelLinger?.()
      cancelLinger = null
      sink.set(state)
    },
    transform(chunk, controller) {
      try {
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
          tell({ status: 'composing' })
        } else if (chunk.type === 'tool-input-available') {
          const path = (chunk.input as { path?: unknown } | null)?.path
          tell({ status: 'thinking', ...(typeof path === 'string' && path ? { path } : {}) })
        } else if (chunk.type === 'tool-output-available') {
          const p = proposalOf(chunk.output)
          if (p) tell({ status: 'composing', path: p.path, working: [{ from: p.from, to: p.to }] })
        }
      } catch {
        // Presence is a courtesy; it must never break the run's stream.
      }
      controller.enqueue(chunk)
    },
    flush: end,
    cancel: end,
  } as Transformer<UIMessageChunk, UIMessageChunk>)
}

/**
 * The working highlight's host for one note: the agents' `working` ranges in
 * its awareness, re-read on every awareness change. Both getters are read at
 * the call (the pane hands one extension to every view it builds).
 */
export function workingHost(awareness: () => Awareness | null, doc: () => Y.Doc | EngineDoc | null): WorkingHost {
  const ydoc = (): Y.Doc | null => {
    const d = doc()
    return d && 'raw' in d && typeof d.raw === 'function' ? (d.raw() as Y.Doc) : (d as Y.Doc | null)
  }
  return {
    current: () => workingRangesOf(awareness()?.getStates() as Map<number, Record<string, unknown>> | undefined, ydoc()),
    subscribe(onChange) {
      const aw = awareness()
      if (!aw) return () => {}
      aw.on('change', onChange)
      return () => aw.off('change', onChange)
    },
  }
}

/** Forget a pending leave (tests). */
export function resetAgentPresence(): void {
  cancelLinger?.()
  cancelLinger = null
}

/**
 * A turn's stream with its presence told to `turn.host.presence` (B10) —
 * unchanged when the host has none. The agent starts on the turn's first
 * referenced note; a tool call moves it.
 */
export function withPresence(
  turn: { host: { presence?: AgentPresenceSink; clock: Clock }; origin: { name: string }; refs: { ref: { path: string } }[] },
  stream: ReadableStream<UIMessageChunk>
): ReadableStream<UIMessageChunk> {
  const sink = turn.host.presence
  if (!sink) return stream
  const path = turn.refs[0]?.ref.path
  return stream.pipeThrough(presenceStream(sink, { name: turn.origin.name, clock: turn.host.clock, ...(path ? { path } : {}) }))
}
