/**
 * L0: model-based convergence over the TestNetwork.
 * Random interleavings of edits, partial delivery, partitions, and heals must
 * always end in convergence once all frames are delivered. fast-check prints
 * a replayable seed and shrinks failures to a minimal command script.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { TestNetwork } from '../src/network.js'
import { mulberry32 } from '../src/prng.js'

const PEERS = ['p0', 'p1', 'p2'] as const

type Cmd =
  | { kind: 'insert'; peer: number; pos: number; text: string }
  | { kind: 'delete'; peer: number; pos: number; len: number }
  | { kind: 'deliverSome'; count: number }
  | { kind: 'partition' } // p0 | p1+p2
  | { kind: 'heal' }

const cmdArb: fc.Arbitrary<Cmd> = fc.oneof(
  { weight: 5, arbitrary: fc.record({
      kind: fc.constant('insert' as const),
      peer: fc.integer({ min: 0, max: 2 }),
      pos: fc.nat({ max: 1000 }),
      text: fc.string({ minLength: 1, maxLength: 8 }),
    }) },
  { weight: 3, arbitrary: fc.record({
      kind: fc.constant('delete' as const),
      peer: fc.integer({ min: 0, max: 2 }),
      pos: fc.nat({ max: 1000 }),
      len: fc.integer({ min: 1, max: 10 }),
    }) },
  { weight: 4, arbitrary: fc.record({
      kind: fc.constant('deliverSome' as const),
      count: fc.integer({ min: 1, max: 5 }),
    }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'partition' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'heal' as const }) }
)

function runScript(cmds: Cmd[], seed: number): TestNetwork {
  const engine = createYjsEngine()
  const net = new TestNetwork(engine)
  const docs = PEERS.map(() => engine.createDoc('shared-doc'))

  // Seed peer 0 and bootstrap the others from its full state (single-seeder rule).
  docs[0]!.transact((t) => t.insert(0, '# Shared note\n\nbase text\n'), 'seed')
  const full = engine.encodeUpdateSince(docs[0]!, null)
  for (let i = 1; i < docs.length; i++) engine.applyUpdate(docs[i]!, full, 'remote')
  PEERS.forEach((id, i) => net.addPeer(id, docs[i]!))

  const rng = mulberry32(seed)
  for (const cmd of cmds) {
    switch (cmd.kind) {
      case 'insert': {
        const doc = docs[cmd.peer]!
        const pos = cmd.pos % (doc.getText().length + 1)
        doc.transact((t) => t.insert(pos, cmd.text), 'local')
        break
      }
      case 'delete': {
        const doc = docs[cmd.peer]!
        const len = doc.getText().length
        if (len === 0) break
        const pos = cmd.pos % len
        doc.transact((t) => t.delete(pos, Math.min(cmd.len, len - pos)), 'local')
        break
      }
      case 'deliverSome':
        for (let i = 0; i < cmd.count; i++) if (!net.deliverOne(rng)) break
        break
      case 'partition':
        net.partition([['p0'], ['p1', 'p2']])
        break
      case 'heal':
        net.heal()
        break
    }
  }
  return net
}

describe('L0 convergence (model-based)', () => {
  it('any command script converges after heal + full delivery', () => {
    fc.assert(
      fc.property(
        fc.array(cmdArb, { minLength: 1, maxLength: 60 }),
        fc.integer({ min: 1, max: 2 ** 30 }),
        (cmds, seed) => {
          const net = runScript(cmds, seed)
          net.heal()
          net.deliverAll(mulberry32(seed ^ 0x5eed))
          if (!net.converged()) {
            throw new Error(
              `did not converge; texts: ${JSON.stringify(net.texts(), null, 2)}`
            )
          }
          expect(net.pendingFrames()).toBe(0)
          net.destroy()
        }
      ),
      { numRuns: 150 }
    )
  })

  it('offline rejoin via provider-style state exchange also converges', () => {
    fc.assert(
      fc.property(
        fc.array(cmdArb, { minLength: 1, maxLength: 40 }),
        fc.integer({ min: 1, max: 2 ** 30 }),
        (cmds, seed) => {
          const net = runScript(cmds, seed)
          // Simulate rejoin-by-state-diff instead of buffered frame delivery:
          net.heal()
          net.fullStateExchange()
          net.fullStateExchange() // second round: deltas created by round one
          if (!net.converged()) {
            throw new Error(`state-exchange rejoin did not converge`)
          }
          net.destroy()
        }
      ),
      { numRuns: 100 }
    )
  })
})
