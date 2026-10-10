/**
 * The agent-speed writer (writing-harness-shaping B10, R8 — a blocking L1
 * case): an in-app agent on device A writes into a shared note at 4,000
 * words a minute, in bursts, while a person on device B types into the same
 * note — over the simulated relay (`RoomNet`, via `bootDuo`), every timer on
 * the injected clocks.
 *
 * The agent works the way a run does: one tool call at a time, each reading
 * the text it edits right before it asks (`from`/`to` are offsets into the
 * text now). Two in three words are direct-mode writes
 * (`applyAgentEdit`: proposal + accept in one throttle slot); every third
 * is a proposal the PERSON on B accepts, as they would from the margin.
 *
 * What has to hold:
 *  - no character the person typed is lost, and they stay in order;
 *  - every agent word lands exactly once (direct, or accepted by B);
 *  - the agent's transactions on A never exceed the token bucket's bound
 *    (2 × 10 in any 100 ms) — the bursts are smoothed, not dropped;
 *  - both replicas converge, both disks hold the converged text, and the
 *    mount invariants the L1 fixture checks still hold.
 */
import { describe, expect, it } from 'vitest'
import { isAgentOrigin } from '../src/agent-origin.js'
import { AGENT_OPS_PER_WINDOW, AGENT_WINDOW_MS } from '../src/agent-throttle.js'
import { bootDuo, checkInvariants, dec, yieldMacro } from './fixture.js'

const NOTE = 'note.md'
const BASE = 'Agent:\nHuman:\n'
/** 4,000 words a minute, bursty: 20 words every 300 ms. */
const BURST_WORDS = 20
const BURST_EVERY_MS = 300
const BURSTS = 12
/** The person: a character every 40 ms (~300 wpm — a fast typist). */
const TYPE_EVERY_MS = 40
const STEP_MS = 10

const origin = { kind: 'agent' as const, runId: 'speed-1', sessionId: 's-1', name: 'Agent' }
const token = (i: number): string => ` [a${i}]`

describe('L1: the agent-speed writer (R8)', () => {
  it('a 4k-wpm agent on A and a person typing on B: nothing lost, every word once, the bucket holds', async () => {
    const duo = await bootDuo({ files: { [NOTE]: BASE } })
    try {
      const a = duo.a.root
      const b = duo.b.root
      a.setOpenPaths(new Set([NOTE]))
      b.setOpenPaths(new Set([NOTE]))
      await duo.deliver()
      const docA = a.docForPath(NOTE)!
      const docB = b.docForPath(NOTE)!

      // Every agent transaction on A, stamped on A's clock.
      const agentTxns: number[] = []
      duo.engine.onUpdate(docA, (_u, o) => {
        if (isAgentOrigin(o)) agentTxns.push(duo.a.clock.now())
      })

      // ---- the agent: a queue of words, written one tool call at a time ----
      const queue: number[] = []
      let issued = 0
      let agentDone = false
      const failures: unknown[] = []
      const agent = (async () => {
        for (;;) {
          const i = queue.shift()
          if (i === undefined) {
            if (issued >= BURSTS * BURST_WORDS) break
            await yieldMacro()
            continue
          }
          // Read the text now; write at the end of the agent's line.
          const at = docA.getText().indexOf('\n')
          const edit = { path: NOTE, from: at, to: at, baseText: '', proposedText: token(i), origin }
          try {
            if (i % 3 === 2) await a.proposeEdit(edit)
            else await a.applyAgentEdit(edit)
          } catch (err) {
            failures.push(err)
          }
        }
        agentDone = true
      })()

      // ---- the world: bursts, typing, B accepting, the relay ----
      let typed = ''
      const letters = 'abcdefghijklmnopqrstuvwxyz'
      const acceptOnB = (): void => {
        for (const r of b.suggestionsFor(NOTE)) if (r.status === 'pending') b.acceptSuggestion(NOTE, r.id)
      }
      for (let t = 0; !agentDone || t < BURSTS * BURST_EVERY_MS; t += STEP_MS) {
        if (t % BURST_EVERY_MS === 0 && issued < BURSTS * BURST_WORDS) {
          for (let k = 0; k < BURST_WORDS; k++) queue.push(issued++)
        }
        if (t % TYPE_EVERY_MS === 0 && typed.length < 200) {
          const ch = letters[typed.length % letters.length]!
          // The person types at the end of their line (before the final newline).
          docB.transact((x) => x.insert(docB.getText().length - 1, ch), 'local')
          typed += ch
        }
        if (t % 200 === 0) acceptOnB()
        if (t % 30 === 0) duo.net.deliverAll()
        await duo.tick(STEP_MS)
        if (t > 60_000) throw new Error('the agent never finished')
      }
      // Drain: everything delivered, B accepts what is left, flushes settle.
      for (let i = 0; i < 3; i++) {
        await duo.deliver()
        acceptOnB()
      }
      await duo.deliver()
      await duo.tick(2_000)
      await duo.deliver()
      await agent

      expect(failures).toEqual([])
      const textA = docA.getText()
      const textB = docB.getText()
      expect(textA).toBe(textB)

      // No human character lost, in order.
      expect(textA.replace(/ \[a\d+\]/g, '')).toBe(`Agent:\nHuman:${typed}\n`)
      // Every agent word exactly once.
      const total = BURSTS * BURST_WORDS
      for (let i = 0; i < total; i++) expect(textA.split(token(i)).length - 1, token(i)).toBe(1)
      expect(b.suggestionsFor(NOTE).filter((r) => r.status !== 'accepted')).toEqual([])

      // The bucket: never more than a full bucket plus one window's refill in any window …
      const bound = 2 * AGENT_OPS_PER_WINDOW
      for (const start of agentTxns) {
        expect(agentTxns.filter((x) => x >= start && x < start + AGENT_WINDOW_MS).length).toBeLessThanOrEqual(bound)
      }
      // … and the bursts were smoothed, not passed through: 2 txns per direct
      // word, 1 per proposal, at 10 per 100 ms.
      const direct = Math.ceil((total * 2) / 3)
      expect(agentTxns.length).toBe(direct * 2 + (total - direct))
      const minSpan = ((agentTxns.length - AGENT_OPS_PER_WINDOW) * AGENT_WINDOW_MS) / AGENT_OPS_PER_WINDOW
      expect(agentTxns.at(-1)! - agentTxns[0]!).toBeGreaterThanOrEqual(minSpan - AGENT_WINDOW_MS)

      // Both disks hold the converged text; the mount invariants hold.
      expect(dec.decode((await duo.a.adapter.read(NOTE))!)).toBe(textA)
      expect(dec.decode((await duo.b.adapter.read(NOTE))!)).toBe(textA)
      await checkInvariants(duo.a)
      await checkInvariants(duo.b)
      expect(duo.a.events.errors).toEqual([])
      expect(duo.b.events.errors).toEqual([])
      expect(duo.a.events.reviews).toEqual([])
      expect(duo.b.events.reviews).toEqual([])
    } finally {
      duo.dispose()
    }
  }, 60_000)
})
