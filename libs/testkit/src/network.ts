/**
 * In-memory multi-peer network for L0 model tests, in the spirit of the
 * simulation harnesses CRDT libraries use internally: every local update is
 * queued per recipient; tests control delivery order, partitions, and healing.
 * Frames are buffered, never dropped — a partition delays delivery, like a
 * relay holding updates for an offline peer.
 */
import type { EngineDoc, SyncEngine } from '@editor/sync'
import { type Rng, randInt } from './prng.js'

interface Frame {
  from: string
  update: Uint8Array
}

interface Peer {
  id: string
  doc: EngineDoc
  inbox: Frame[]
  group: number
  offUpdate: () => void
}

export class TestNetwork {
  private peers = new Map<string, Peer>()

  constructor(private engine: SyncEngine) {}

  addPeer(id: string, doc: EngineDoc): void {
    if (this.peers.has(id)) throw new Error(`duplicate peer ${id}`)
    const offUpdate = this.engine.onUpdate(doc, (update, origin) => {
      // Updates we applied from the network must not echo back out.
      if (origin === 'remote') return
      for (const other of this.peers.values()) {
        if (other.id !== id) other.inbox.push({ from: id, update })
      }
    })
    this.peers.set(id, { id, doc, inbox: [], group: 0, offUpdate })
  }

  /** Split peers into groups; frames only deliver within a group. */
  partition(groups: string[][]): void {
    groups.forEach((ids, g) => {
      for (const id of ids) {
        const peer = this.peers.get(id)
        if (!peer) throw new Error(`unknown peer ${id}`)
        peer.group = g
      }
    })
  }

  heal(): void {
    for (const peer of this.peers.values()) peer.group = 0
  }

  private deliverable(): Peer[] {
    return [...this.peers.values()].filter((p) =>
      p.inbox.some((f) => this.sameGroup(f.from, p.id))
    )
  }

  private sameGroup(a: string, b: string): boolean {
    return this.peers.get(a)!.group === this.peers.get(b)!.group
  }

  /** Deliver one deliverable frame (random recipient if rng given). */
  deliverOne(rng?: Rng): boolean {
    const candidates = this.deliverable()
    if (candidates.length === 0) return false
    const peer = rng ? candidates[randInt(rng, 0, candidates.length)]! : candidates[0]!
    const idx = peer.inbox.findIndex((f) => this.sameGroup(f.from, peer.id))
    const frame = peer.inbox.splice(idx, 1)[0]!
    this.engine.applyUpdate(peer.doc, frame.update, 'remote')
    return true
  }

  /** Deliver until quiescent (within current partition groups). */
  deliverAll(rng?: Rng): void {
    let guard = 0
    while (this.deliverOne(rng)) {
      if (++guard > 100_000) throw new Error('deliverAll did not quiesce')
    }
  }

  /**
   * Provider-style state exchange between every pair (sync step 1/2),
   * for tests modelling rejoin-by-state-diff rather than buffered frames.
   */
  fullStateExchange(): void {
    const list = [...this.peers.values()]
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue
        const delta = this.engine.encodeUpdateSince(a.doc, this.engine.heads(b.doc))
        this.engine.applyUpdate(b.doc, delta, 'remote')
      }
    }
  }

  /** True if every pair of peers has equal text AND equal heads. */
  converged(): boolean {
    const list = [...this.peers.values()]
    for (let i = 1; i < list.length; i++) {
      const a = list[0]!, b = list[i]!
      if (a.doc.getText() !== b.doc.getText()) return false
      if (!this.engine.headsEqual(this.engine.heads(a.doc), this.engine.heads(b.doc)))
        return false
    }
    return true
  }

  pendingFrames(): number {
    return [...this.peers.values()].reduce((n, p) => n + p.inbox.length, 0)
  }

  texts(): Record<string, string> {
    return Object.fromEntries([...this.peers.values()].map((p) => [p.id, p.doc.getText()]))
  }

  destroy(): void {
    for (const p of this.peers.values()) p.offUpdate()
  }
}
