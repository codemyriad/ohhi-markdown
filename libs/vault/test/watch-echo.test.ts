/**
 * A watcher that reports reads as events (the Linux backend reports a file
 * being opened) must not turn the session's own quiesce reads into more
 * events: one quiesce in flight per path, an event meanwhile buys one more
 * round, and then the path is quiet. Pre-fix, every event started another
 * read pair, so a burst grew without bound.
 */
import { describe, expect, it } from 'vitest'
import { createYjsEngine } from '@ohhi/sync'
import { SimClock } from '@ohhi/testkit'
import { enrollFolder } from '../src/enrollment.js'
import { MemVaultAdapter } from '../src/mem-adapter.js'
import { MemJournal, MemLcaStore } from '../src/stores.js'
import { VaultSession } from '../src/session.js'

const enc = (s: string) => new TextEncoder().encode(s)
const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0))
}

/** Counts the reads of each path, the way an echoing watcher would see them. */
class CountingAdapter extends MemVaultAdapter {
  reads = new Map<string, number>()
  override async read(path: string) {
    this.reads.set(path, (this.reads.get(path) ?? 0) + 1)
    return super.read(path)
  }
}

async function sessionOverOneNote() {
  const engine = createYjsEngine()
  const adapter = new CountingAdapter()
  const lcaStore = new MemLcaStore()
  const clock = new SimClock()
  await adapter.writeAtomic('note.md', enc('hello'))
  const folderDoc = engine.createDoc('room/folder')
  const { docs } = await enrollFolder(engine, adapter, folderDoc, lcaStore)
  const errors: unknown[] = []
  const session = new VaultSession({
    engine,
    adapter,
    lcaStore,
    journal: new MemJournal(),
    clock,
    folderDoc,
    docs,
    quiesceMs: 30,
    events: { onError: (err) => errors.push(err) },
  })
  await session.start()
  adapter.reads.clear()
  return { adapter, clock, session, errors }
}

async function runOut(adapter: CountingAdapter, clock: SimClock): Promise<void> {
  // Enough quiesce windows for every round the session may still owe.
  for (let i = 0; i < 6; i++) {
    await settle()
    clock.advance(30)
  }
  await settle()
}

describe('watch events that echo reads', () => {
  it('a burst of events for one path costs at most two quiesce rounds, then the path is quiet', async () => {
    const { adapter, clock, errors } = await sessionOverOneNote()

    for (let i = 0; i < 40; i++) adapter.emitBatch(['note.md'])
    await runOut(adapter, clock)
    const afterBurst = adapter.reads.get('note.md') ?? 0
    // Two rounds (the burst, then the one the events meanwhile bought), each
    // two quiesce reads plus the reconcile's own: six, where a read pair per
    // event made it a hundred and twenty.
    expect(afterBurst).toBeGreaterThan(0)
    expect(afterBurst).toBeLessThanOrEqual(6)

    // Quiet: with no new event, nothing reads the file again.
    await runOut(adapter, clock)
    expect(adapter.reads.get('note.md')).toBe(afterBurst)
    expect(clock.pendingCount()).toBe(0)
    expect(errors).toEqual([])
  })

  it('an event that lands mid-quiesce buys exactly one more round', async () => {
    const { adapter, clock } = await sessionOverOneNote()

    adapter.emitBatch(['note.md'])
    await settle()
    expect(adapter.reads.get('note.md')).toBe(1) // first read done, second waits on the clock
    adapter.emitBatch(['note.md']) // lands inside the window
    adapter.emitBatch(['note.md'])
    await settle()
    expect(adapter.reads.get('note.md')).toBe(1) // no second quiesce started

    await runOut(adapter, clock)
    const total = adapter.reads.get('note.md') ?? 0
    expect(total).toBeLessThanOrEqual(6)
    await runOut(adapter, clock)
    expect(adapter.reads.get('note.md')).toBe(total)
  })

  it('a path still being written is retried, as before', async () => {
    const { adapter, clock, session } = await sessionOverOneNote()

    adapter.externalWrite('note.md', enc('hello wor'))
    await settle()
    adapter.externalWrite('note.md', enc('hello world')) // changed inside the window
    await runOut(adapter, clock)
    expect(session.pendingReviews()).toEqual([])
    expect(new TextDecoder().decode((await adapter.read('note.md'))!)).toBe('hello world')
  })
})
